import * as gcp from "@google-cloud/compute";
import * as core from "@actions/core";
import { GoogleAuth } from "google-auth-library";
import { BenchmarkMetadata } from "../../types";

import { USER_NAME } from "../constants";

export async function setupComputeInstance({
  project,
  serviceAccount,
  sshKey,
  startupScript = `
  #!/bin/bash

  # Add Docker's official GPG key:
  sudo apt-get update -y
  sudo apt-get install ca-certificates curl gnupg -y
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  
  # Add the repository to Apt sources:
  echo \
	"deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
	"$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
	sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -y
  
  sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y

  # Add go to the path
  echo 'export GOPATH=$HOME/go' >> ~/.profile
  echo 'export PATH=$PATH:$GOROOT/bin:$GOPATH/bin' >> ~/.profile
  source ~/.profile

  echo 'export GOPATH=$HOME/go' >> ~/.bashrc
  echo 'export PATH=$PATH:$GOROOT/bin:$GOPATH/bin' >> ~/.bashrc
  source ~/.bashrc 

  sudo docker run -d --rm --name web-test -p 80:8000 crccheck/hello-world
  `,
  // Default zone europe-west1-b
  zone = "europe-west1-b",
}: {
  project: string;
  serviceAccount: string;
  startupScript?: string;
  zone?: string;
  sshKey: string;
}): Promise<BenchmarkMetadata> {
  // Auth with service account
  const authClient = new GoogleAuth({
    credentials: JSON.parse(serviceAccount),
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  // Create compute instance with new version of GCP client library
  const compute = new gcp.InstancesClient({
    auth: authClient,
  });
  const network = new gcp.NetworksClient({
    auth: authClient,
  });
  const firewall = new gcp.FirewallsClient({
    auth: authClient,
  });
  const ip = new gcp.AddressesClient({
    auth: authClient,
  });
  const zonesOperations = new gcp.ZoneOperationsClient({
    auth: authClient,
    projectId: project,
  });
  const regionOperations = new gcp.RegionOperationsClient({
    auth: authClient,
    projectId: project,
  });
  const globalOperations = new gcp.GlobalOperationsClient({
    auth: authClient,
    projectId: project,
  });

  console.log("Creating network");

  // Create network
  const [createNetworkOperation] = await network.insert({
    project,
    networkResource: {
      name: "empiris",
      autoCreateSubnetworks: true,
    },
  });

  if (!createNetworkOperation) {
    throw new Error("Network creation failed");
  }

  const operationId = createNetworkOperation.latestResponse?.name;

  // Wait for network to be created
  await globalOperations.wait({
    operation: operationId,
    project,
  });

  console.log("Creating firewall rule");

  // Create firewall rule
  const [createFirewallOperation] = await firewall.insert({
    project,
    firewallResource: {
      name: "empiris",
      network: `projects/${project}/global/networks/empiris`,
      direction: "INGRESS",
      priority: 1000,
      // Allow ssh from anywhere
      allowed: [
        {
          IPProtocol: "tcp",
          ports: ["22", "80", "443"],
        },
      ],
      sourceRanges: ["0.0.0.0/0"],
      targetTags: ["empiris"],
    },
  });

  if (!createFirewallOperation) {
    throw new Error("Firewall rule creation failed");
  }

  // Wait for firewall rule to be created
  await globalOperations.wait({
    operation: createFirewallOperation.latestResponse?.name,
    project,
  });

  console.log("Creating ip address");

  const [createIpOperation] = await ip.insert({
    project,
    region: "europe-west1",
    addressResource: {
      name: "empiris",
      addressType: "EXTERNAL",
    },
  });

  if (!createIpOperation) {
    throw new Error("Ip creation failed");
  }

  // Wait for ip address to be created
  await regionOperations.wait({
    operation: createIpOperation.latestResponse?.name,
    project,
    region: "europe-west1",
  });

  // Get ip address
  const [address] = await ip.get({
    project,
    region: "europe-west1",
    address: "empiris",
  });

  if (!address.address) {
    throw new Error("Ip address not found");
  }

  console.log("Creating compute instance");

  const [createInstanceOperation] = await compute.insert({
    project,
    zone,
    instanceResource: {
      name: "empiris",
      machineType: `zones/${zone}/machineTypes/e2-medium`,
      zone,
      tags: {
        items: ["empiris"],
      },
      // Boot disk ubuntu-os-cloud/ubuntu-2204-lts
      disks: [
        {
          boot: true,
          initializeParams: {
            sourceImage:
              "projects/ubuntu-os-cloud/global/images/ubuntu-2204-jammy-v20231030",
          },
        },
      ],
      metadata: {
        items: [
          {
            key: "startup-script",
            value: startupScript,
          },
          {
            key: "ssh-keys",
            value: `${USER_NAME}:${sshKey}`,
          },
        ],
      },
      networkInterfaces: [
        {
          network: `projects/${project}/global/networks/empiris`,
          accessConfigs: [
            {
              natIP: address.address,
            },
          ],
        },
      ],
    },
  });

  if (!createInstanceOperation) {
    throw new Error("Compute instance creation failed");
  }

  // Wait for compute instance to be created
  await zonesOperations.wait({
    operation: createInstanceOperation.latestResponse?.name,
    project,
    zone,
  });

  console.log("Adding ip to known hosts");
  // await addIpToKnownHosts(address.address);

  console.log("Compute instance ready at " + address.address);

  return {
    ip: address.address || undefined,
  };
}

export async function destroyComputeInstance({
  project,
  serviceAccount,
  zone = "europe-west1-b",
}: {
  project: string;
  serviceAccount: string;
  zone?: string;
  isCleanUp?: boolean;
}) {
  // Auth with service account
  const authClient = new GoogleAuth({
    credentials: JSON.parse(serviceAccount),
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  // Create compute instance with new version of GCP client library
  const compute = new gcp.InstancesClient({
    auth: authClient,
  });
  const network = new gcp.NetworksClient({
    auth: authClient,
  });
  const firewall = new gcp.FirewallsClient({
    auth: authClient,
  });
  const ip = new gcp.AddressesClient({
    auth: authClient,
  });
  new gcp.RegionOperationsClient({
    auth: authClient,
    projectId: project,
  });
  const globalOperations = new gcp.GlobalOperationsClient({
    auth: authClient,
    projectId: project,
  });
  const zonesOperations = new gcp.ZoneOperationsClient({
    auth: authClient,
    projectId: project,
  });

  try {
    core.info("Destroying firewall..");

    await firewall.delete({
      project,
      firewall: "empiris",
    });
  } catch (e) {}

  try {
    core.info("Destroying ip..");

    await ip.delete({
      project,
      region: "europe-west1",
      address: "empiris",
    });
  } catch (e) {}

  try {
    core.info("Destroying compute instance..");

    const [deleteComputeOperation] = await compute.delete({
      project,
      zone: "europe-west1-b",
      instance: "empiris",
    });

    if (!deleteComputeOperation) {
      throw new Error("Compute instance deletion failed");
    }

    await zonesOperations.wait({
      operation: deleteComputeOperation.latestResponse?.name,
      project,
      zone,
    });
  } catch (e) {}

  try {
    core.info("Destroying network..");

    const [networkResult] = await network.delete({
      project,
      network: "empiris",
    });

    // Wait for network to be deleted
    await globalOperations.wait({
      operation: networkResult.latestResponse?.name,
      project,
    });
  } catch (e) {}
}

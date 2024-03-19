import * as gcp from "@google-cloud/compute";
import * as core from "@actions/core";
import { GoogleAuth } from "google-auth-library";
import { BenchmarkMetadata } from "../../types";

import { SSH_USER_NAME } from "../constants";
import { getDependency } from "../../deps";

type SetupInstanceOptions = {
  project: string;
  serviceAccount: string;
  startupScript: string;
  region: string;
  machineType: string;
  runId: string;
  zone: string;
  sshKey: string;
};

export function createStartupScript(dependencies: ("go" | "node")[]) {
  const installDeps = dependencies
    .map((dep) => getDependency(dep).getInstallCMD())
    .join(" && ");

  return `
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

${installDeps}

sudo docker run -d --rm --name web-test -p 80:8000 crccheck/hello-world`;
}

export async function setupComputeInstance({
  project,
  serviceAccount,
  sshKey,
  startupScript,
  region,
  machineType,
  runId,
  zone,
}: SetupInstanceOptions): Promise<BenchmarkMetadata> {
  // Ensure unique names for each run
  const networkName = "empiris-network-" + runId;
  const firewallName = "empiris-firewall-" + runId;
  const ipName = "empiris-ip-" + runId;
  const instanceName = "empiris-instance-" + runId;

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
      name: networkName,
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
      name: firewallName,
      network: `projects/${project}/global/networks/${networkName}`,
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
    region,
    addressResource: {
      name: ipName,
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
    region,
  });

  // Get ip address
  const [address] = await ip.get({
    project,
    region,
    address: ipName,
  });

  if (!address.address) {
    throw new Error("Ip address not found");
  }

  console.log("Creating compute instance");

  const [createInstanceOperation] = await compute.insert({
    project,
    zone,
    instanceResource: {
      name: instanceName,
      machineType: `zones/${zone}/machineTypes/${machineType}`,
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
            value: `${SSH_USER_NAME}:${sshKey}`,
          },
        ],
      },
      networkInterfaces: [
        {
          network: `projects/${project}/global/networks/${networkName}`,
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

type DestoryInstanceOptions = {
  project: string;
  serviceAccount: string;
  region: string;
  runId: string;
  zone: string;
  isCleanUp: boolean;
};

export async function destroyComputeInstance({
  project,
  serviceAccount,
  region,
  runId,
  zone,
}: DestoryInstanceOptions) {
  const networkName = "empiris-network-" + runId;
  const firewallName = "empiris-firewall-" + runId;
  const ipName = "empiris-ip-" + runId;
  const instanceName = "empiris-instance-" + runId;

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
      firewall: firewallName,
    });
  } catch (e) {}

  try {
    core.info("Destroying ip..");

    await ip.delete({
      project,
      region: region,
      address: ipName,
    });
  } catch (e) {}

  try {
    core.info("Destroying compute instance..");

    const [deleteComputeOperation] = await compute.delete({
      project,
      zone,
      instance: instanceName,
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
      network: networkName,
    });

    // Wait for network to be deleted
    await globalOperations.wait({
      operation: networkResult.latestResponse?.name,
      project,
    });
  } catch (e) {}
}

import * as gcp from "@google-cloud/compute";
import { GoogleAuth } from "google-auth-library";
import { BenchmarkMetadata } from "../../types";

import { addIpToKnownHosts, createSSHKey } from "../setup-ssh";
import { SSH_KEY_NAME, USER_NAME } from "../constants";

export async function setupComputeInstance({
  project,
  serviceAccount,
  startupScript = `
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
  
  sudo docker run -d -p 8086:8086 -e DOCKER_INFLUXDB_INIT_MODE=setup -e DOCKER_INFLUXDB_INIT_USERNAME=admin -e DOCKER_INFLUXDB_INIT_PASSWORD=12345678 -e DOCKER_INFLUXDB_INIT_ORG=test -e DOCKER_INFLUXDB_INIT_BUCKET=test -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=PdomKtCYz_r7ym9yAcHMzxCA57lwyTkAWiwUbVk4sXePLU5eAckk9J-K6pygGWODRq3t_gFrcsGQNhmJ7Y9HNw== -v myInfluxVolume:/var/lib/influxdb2 influxdb:latest 
  `,
  // Default zone europe-west1-b
  zone = "europe-west1-b",
}: {
  project: string;
  serviceAccount: string;
  startupScript?: string;
  zone?: string;
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
          ports: ["22", "80", "443", "8086"],
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

  // Create SSH key
  console.log("Creating SSH key");

  // Get SSH key
  const sshKey = await createSSHKey(SSH_KEY_NAME, USER_NAME);

  console.log("SSH key created", sshKey);
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
  await addIpToKnownHosts(address.address);

  console.log("Compute instance ready at " + address.address);

  return {
    ip: address.address || undefined,
  };
}

export async function destroyComputeInstance({
  project,
  serviceAccount,
}: {
  project: string;
  serviceAccount: string;
  startupScript?: string;
  zone?: string;
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

  await firewall.delete({
    project,
    firewall: "empiris",
  });

  await ip.delete({
    project,
    region: "europe-west1",
    address: "empiris",
  });

  const [deleteComputeOperation] = await compute.delete({
    project,
    zone: "europe-west1-b",
    instance: "empiris",
  });

  if (!deleteComputeOperation) {
    throw new Error("Compute instance deletion failed");
  }

  await globalOperations.wait({
    operation: deleteComputeOperation.latestResponse?.name,
    project,
  });

  const [networkResult] = await network.delete({
    project,
    network: "empiris",
  });

  // Wait for network to be deleted
  await globalOperations.wait({
    operation: networkResult.latestResponse?.name,
    project,
  });
}

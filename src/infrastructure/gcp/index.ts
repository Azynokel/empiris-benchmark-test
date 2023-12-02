import * as gcp from "@google-cloud/compute";

// TODO: Setup benchmark client + manager
const startupScript = `
sudo apt-get update
`;

export async function setupComputeInstance({ project }: { project: string }) {
  // Create compute instance with new version of GCP client library
  const compute = new gcp.InstancesClient();
  const network = new gcp.NetworksClient();
  const firewall = new gcp.FirewallsClient();

  // Create firewall rule
  await firewall.insert({
    project,
    firewallResource: {
      name: "empiris",
      network: "empiris",
      allowed: [
        {
          IPProtocol: "tcp",
          ports: ["22"],
        },
      ],
      sourceRanges: ["0.0.0.0/0"],
      targetTags: ["empiris"],
    },
  });

  // Create network
  await network.insert({
    project: "empiris",
    networkResource: {
      name: "empiris",
      autoCreateSubnetworks: true,
    },
  });

  // TODO: Create static IP

  await compute.insert({
    project,
    zone: "us-central1-a",
    instanceResource: {
      metadata: {
        items: [
          {
            key: "startup-script",
            value: startupScript,
          },
        ],
      },
      networkInterfaces: [
        {
          network: "empiris",
          accessConfigs: [{}],
        },
      ],
    },
  });
}

export function destroyComputeInstance() {
  throw new Error("Not implemented");
}

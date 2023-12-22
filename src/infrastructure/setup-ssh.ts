import { join } from "path";
import { homedir } from "os";
import { exec } from "@actions/exec";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { waitOn } from "../utils";

export function getSSHPath() {
  const home = homedir();

  return join(home, ".ssh");
}

export function getSSHKeyPath(name: string) {
  const privateKeyPath = join(getSSHPath(), name);

  return {
    privateKeyPath,
    publicKeyPath: `${privateKeyPath}.pub`,
  };
}

async function setupSSH() {
  const sshFolder = getSSHPath();

  // Create the SSH folder if it doesn't exist yet
  await fs.mkdir(sshFolder, { recursive: true });

  // Give SSH key correct permissions
  await fs.chmod(sshFolder, 700);

  const knownHostsPath = join(sshFolder, "known_hosts");

  // Create the known_hosts file if it doesn't exist yet
  if (!existsSync(knownHostsPath)) {
    await fs.writeFile(knownHostsPath, "");
  }

  return sshFolder;
}

export async function readSSHPublicKey(name = "google_compute_engine") {
  await setupSSH();

  return await fs.readFile(getSSHKeyPath(name).publicKeyPath, "utf-8");
}

export async function createSSHKey(
  name = "google_compute_engine",
  userName: string
) {
  const sshFolder = await setupSSH();

  await exec(
    `ssh-keygen -t rsa -f ${join(sshFolder, name)} -C ${userName} -b 2048 -N ''`
  );

  return await readSSHPublicKey(name);
}

export async function addIpToKnownHosts(ip: string) {
  // Make sure the known_hosts file exists
  const sshFolder = await setupSSH();

  // Wait for ip to be available (max 2 minute)
  // TODO: Wait for something else
  await waitOn({
    ressources: [`http://${ip}:8086/health`],
    timeout: 120_000,
  });

  const knownHostsPath = join(sshFolder, "known_hosts");

  // Add the IP to the known_hosts file
  await exec(`ssh-keyscan -H ${ip} >> ${knownHostsPath}`);
}

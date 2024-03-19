import { BenchmarkDependency } from "../types";

export const nodeDependency: BenchmarkDependency<"node"> = {
  name: "node",
  getInstallCMD: () => "sudo apt-get install -y nodejs",
  getCheckIfInstalledCMD: () => "node --version",
};

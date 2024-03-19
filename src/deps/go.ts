import { BenchmarkDependency } from "../types";

export const goDependency: BenchmarkDependency<"go"> = {
  name: "go",
  getInstallCMD: () => "sudo apt-get install golang-go -y",
  getCheckIfInstalledCMD: () => "go version",
};

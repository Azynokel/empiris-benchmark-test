import { BenchmarkDependency } from "../types";

export const makeDependency: BenchmarkDependency<"make"> = {
  name: "make",
  getInstallCMD: () => "sudo apt-get install make -y",
  getCheckIfInstalledCMD: () => "make --version",
};

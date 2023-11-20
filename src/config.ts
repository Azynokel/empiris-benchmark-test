import * as core from "@actions/core";

export function getConfig() {
  // Name of the benchmark
  const name: string = core.getInput("name");
  const apiKey: string = core.getInput("apiKey");

  return {
    name,
    apiKey,
  };
}

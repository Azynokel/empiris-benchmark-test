import * as core from "@actions/core";
import { getConfig } from "./config";

async function main() {
  core.debug(`Benchmark Github Action`);

  const config = getConfig();

  console.log(config);
}

main().catch((e) => core.setFailed(e.message));

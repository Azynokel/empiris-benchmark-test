import * as core from "@actions/core";
import { Config, getConfig } from "./config";
import { adapters, Adapter } from "./adapters";
import { writeMetrics } from "./write-results";

function getAdapter<T extends Config["benchmark"]["name"]>(name: T) {
  const adapter = adapters.find((adapter) => adapter.name === name);

  if (!adapter) {
    throw new Error(`Adapter ${name} not found`);
  }

  return adapter as Adapter<T>;
}

async function main() {
  const {
    benchmark: { name, ...rest },
    visualization: { api_base_url, api_key },
  } = await getConfig();

  // Get the adapter
  const adapter = getAdapter(name);

  // Setup the Benchmark Client
  await adapter.setup();

  // Run the Benchmark
  // We assume here that the SUT is already running and available, we don't do the setup here
  const metrics = await adapter.run(rest);

  // const id = await createExperimentRun({ apiKey, basePath: apiBaseUrl });

  if (api_key) {
    // Write the results to the Empiris API
    await writeMetrics(metrics, {
      basePath: api_base_url,
      experimentRunId: 3,
      apiKey: api_key,
    });
  } else {
    core.info("No API key provided, skipping writing results");
  }
}

main().catch((e) => core.setFailed(e.message));

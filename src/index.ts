import * as core from "@actions/core";
import { Config, getConfig } from "./config";
import { adapters, Adapter } from "./adapters";
import { createExperimentRun, writeMetrics } from "./write-results";

function getAdapter<T extends Config["benchmark"]["tool"]>(tool: T) {
  const adapter = adapters.find((adapter) => adapter.tool === tool);

  if (!adapter) {
    throw new Error(`Adapter ${tool} not found`);
  }

  return adapter as Adapter<T>;
}

async function main() {
  const {
    benchmark: { tool, ...rest },
    visualization: { api_base_url, api_key },
  } = await getConfig();

  // Get the adapter
  const adapter = getAdapter(tool);

  // Setup the Benchmark Client
  await adapter.setup(rest);

  // Run the Benchmark
  // We assume here that the SUT is already running and available, we don't do the setup here
  const metrics = await adapter.run(rest);

  if (metrics.length === 0) {
    core.warning("No metrics were collected");
  } else if (api_key) {
    const id = await createExperimentRun({
      apiKey: api_key,
      basePath: api_base_url,
    });

    core.info("Experiment run id: " + id);

    core.info("Writing metrics to Empiris API: " + JSON.stringify(metrics));

    // Write the results to the Empiris API
    await writeMetrics(metrics, {
      basePath: api_base_url,
      experimentRunId: id,
      apiKey: api_key,
    });
  } else {
    core.info("No API key provided, skipping writing results");
  }
}

main().catch((e) => core.setFailed(e.message));

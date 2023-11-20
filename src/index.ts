import * as core from "@actions/core";
import { getConfig } from "./config";
import * as Adapters from "./adapters";
import { writeMetrics } from "./write-results";

function getAdapter(name: "inch") {
  const adapter = Object.values(Adapters).find(
    (adapter) => adapter.name === name
  );

  if (!adapter) {
    throw new Error(`Adapter ${name} not found`);
  }

  return adapter;
}

async function main() {
  const { benchmark, apiKey, visualizationApiBaseUrl, influx_token } =
    getConfig();

  // Get the adapter
  const adapter = getAdapter(benchmark);

  // Setup the Benchmark Client
  await adapter.setup();

  // Run the Benchmark
  // TODO: we assume here that the SUT is already running and available
  const metrics = await adapter.run([
    "-token",
    influx_token,
    "-db",
    "test",
    "-v2",
    "-v",
  ]);

  // Write the results to the Empiris API
  await writeMetrics(metrics, {
    basePath: visualizationApiBaseUrl,
    experimentRunId: 3,
    apiKey,
  });
}

main().catch((e) => core.setFailed(e.message));

import * as core from "@actions/core";
import { Config, getConfig } from "./config";
import { adapters, Adapter } from "./adapters";
import {
  destroyComputeInstance,
  setupComputeInstance,
} from "./infrastructure/gcp";
import { BenchmarkMetadata, Metric } from "./types";
import { writeFile } from "fs/promises";

import { NodeSSH } from "node-ssh";
import { waitOn } from "./utils";
import { exec } from "@actions/exec";
import { createExperimentRun, writeMetrics } from "./write-results";

const ssh = new NodeSSH();

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
    run,
    github_token,
    visualization: { api_base_url, api_key },
  } = await getConfig();

  let metadata: BenchmarkMetadata = {};

  if (run?.gcp) {
    try {
      // Clean up any previous instances
      await destroyComputeInstance({
        project: "empiris",
        serviceAccount: run?.gcp,
        isCleanUp: true,
      });

      metadata = await setupComputeInstance({
        project: "empiris",
        serviceAccount: run?.gcp,
        sshKey: run?.ssh.public_key,
      });
    } catch (e) {
      console.error("Failed to setup compute instance", e);
    }
  }

  metadata = { ...metadata, runConfig: run, githubToken: github_token };

  // Get the adapter
  const adapter = getAdapter(tool);

  let metrics: Metric[] = [];

  // Setup the Benchmark Client
  try {
    const commands = await adapter.setup({
      options: rest,
      metadata,
    });

    if (metadata.ip && metadata.runConfig) {
      const { ip, runConfig } = metadata;

      core.info(`Waiting for ${ip} to be ready...`);
      // Wait for ip to be ready
      await waitOn({
        ressources: [`http://${ip}`],
      });

      for (const command of commands) {
        core.info(`Running ${command} on ${ip}...`);
        await ssh.connect({
          host: ip,
          username: "empiris",
          privateKey: runConfig.ssh.private_key,
        });
        await ssh.execCommand(command);
      }
    } else {
      for (const command of commands) {
        core.info(`Running ${command}...`);
        await exec(command);
      }
    }

    // Run the Benchmark
    // We assume here that the SUT is already running and available, we don't do the setup here
    metrics = await adapter.run({ options: rest, metadata });

    // Teardown the Benchmark Client
    await adapter.teardown?.({ options: rest, metadata });
  } catch (e) {
    console.error("Failed to run benchmark", e);
  }

  if (run?.gcp) {
    try {
      await destroyComputeInstance({
        project: "empiris",
        serviceAccount: run?.gcp,
      });
    } catch (e) {
      console.error("Failed to destroy compute instance", e);
    }
  }

  const report = JSON.stringify(
    {
      metrics,
    },
    null,
    2
  );

  // Send the report to the server
  if (metrics.length === 0) {
    core.warning("No metrics were collected");
  }

  core.info("Writing report to report.json: " + report);

  await writeFile("report.json", report);

  if (api_key) {
    const id = await createExperimentRun({
      apiKey: api_key,
      basePath: api_base_url,
      metadata: {
        appName: "InfluxDB",
        commit: "master",
      },
    });

    core.info("Experiment run id: " + id);

    core.info("Writing metrics to Empiris API..");

    // Write the results to the Empiris API
    await writeMetrics(metrics, {
      basePath: api_base_url,
      experimentRunId: id,
      apiKey: api_key,
    });
  } else {
    core.info("No API key provided, skipping writing results to api");
  }

  core.info("Benchmark finished");
}

main()
  .catch((e) => core.setFailed(e.message))
  .then(() => process.exit(0));

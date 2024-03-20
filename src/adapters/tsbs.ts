import * as core from "@actions/core";
import { DataframeMetric, createAdapter } from "../types";
import { z } from "zod";
import { waitOn } from "../utils";

function parseTsbsOutput(output: string): DataframeMetric[] {
  // Define a regular expression to match the line with mean metrics/sec
  const regex =
    /loaded \d+ metrics in \d+(\.\d+)?sec with \d+ workers \(mean rate (\d+(\.\d+)?) metrics\/sec\)/;

  // Execute the regex on the summary text
  const match = output.match(regex);

  // Check if we have a match
  if (match && match[2]) {
    // Parse the mean metrics/sec as a floating point number and return it
    return [
      {
        type: "dataframe",
        metric: "throughput",
        specifier: "mean rate",
        unit: "metrics/sec",
        value: parseFloat(match[2]),
      },
    ];
  }

  return [];
}

/**
 * This is the adapter for the TSBS benchmarking tool. Works with many popular time series databases.
 */
export const tsbsAdapter = createAdapter({
  tool: "tsbs",
  dependsOn: ["go"],
  // TODO: Union schema for all supported databases
  config: z.object({
    database: z.object({
      type: z.literal("victoriametrics"),
      host: z.string(),
      password: z.string(),
      user: z.string(),
      name: z.string(),
    }),
    use_case: z
      .union([z.literal("cpu-only"), z.literal("devops"), z.literal("iot")])
      .default("cpu-only"),
    seed: z.number().default(123),
    scale: z.number().default(10),
    timestamp_start: z.string().default("2016-01-01T00:00:00Z"),
    timestamp_end: z.string().default("2016-01-02T00:00:00Z"),
    log_interval: z.string().optional().default("10s"),
    workers: z.number().optional().default(1),
    batch_size: z.number().optional().default(5),
  }),
  setup: async ({
    exec,
    options: {
      database: { type },
    },
  }) => {
    const commands = [
      `go install github.com/timescale/tsbs/cmd/tsbs_load_${type}@latest`,
      "go install github.com/timescale/tsbs/cmd/tsbs_generate_data@latest",
    ];

    for (const command of commands) {
      const result = await exec(command);

      if (!result.success) {
        return {
          success: false,
          error: `Failed to run: ${command}`,
        };
      }
    }

    return { success: true };
  },
  run: async ({
    exec,
    options: {
      database: { type, host },
      seed,
      scale,
      batch_size,
      workers,
      use_case,
      timestamp_start,
      timestamp_end,
      log_interval,
    },
  }) => {
    core.info(`Waiting for ${type} to be ready at ${host}`);
    // This only works for victoriametrics so far
    await waitOn({
      ressources: [`${host}/api/v1/status/tsdb`],
      // Timeout after 5 minutes
      timeout: 1000 * 60 * 5,
    });

    await exec(
      `export GOPATH=$HOME/go && export PATH=$PATH:$GOROOT/bin:$GOPATH/bin && tsbs_generate_data --use-case=${use_case} --seed=${seed} --scale=${scale} --timestamp-start="${timestamp_start}"  --timestamp-end="${timestamp_end}" --log-interval="${log_interval}" --format="${type}" | gzip > data.gz`
    );

    core.info("Running tsbs_load command");

    const result = await exec(
      `export GOPATH=$HOME/go && export PATH=$PATH:$GOROOT/bin:$GOPATH/bin && cat data.gz | gunzip | tsbs_load_${type} --workers=${workers} --batch-size=${batch_size} --urls="${host}/write"`
    );

    if (!result.success) {
      core.error("Failed to run tsbs: " + result.stderr);
      return [];
    }

    return parseTsbsOutput(result.stdout);
  },
});

export type TSBSAdapter = typeof tsbsAdapter;

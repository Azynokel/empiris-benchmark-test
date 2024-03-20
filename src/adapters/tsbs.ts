import * as core from "@actions/core";
import { createAdapter } from "../types";
import { z } from "zod";
import { waitOn } from "../utils";

/**
 * This is the adapter for the TSBS benchmarking tool. Works with many popular time series databases.
 */
export const tsbsAdapter = createAdapter({
  tool: "tsbs",
  dependsOn: ["go", "make"],
  // TODO: Union schema for all supported databases
  config: z.object({
    database: z.object({
      type: z.union([
        z.literal("influxdb"),
        z.literal("victoriametrics"),
        z.literal("timescaledb"),
      ]),
      host: z.string(),
      password: z.string(),
      user: z.string(),
      name: z.string(),
    }),
    use_case: z
      .union([z.literal("cpu-only"), z.literal("devops"), z.literal("iot")])
      .default("cpu-only"),
    seed: z.number().default(123),
    scale: z.number().default(100),
    timestamp_start: z.string().default("2020-01-01T00:00:00Z"),
    timestamp_end: z.string().default("2020-01-01T00:00:00Z"),
    log_interval: z.string().optional().default("1s"),
    workers: z.number().optional().default(1),
    batch_size: z.number().optional().default(10),
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
      //   "git clone https://github.com/timescale/tsbs.git",
      //   "cd tsbs",
      //   "make",
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
    },
  }) => {
    core.info(`Waiting for ${type} to be ready at ${host}`);
    // This only works for victoriametrics so far
    await waitOn({
      ressources: [`${host}/api/v1/status/tsdb`],
    });

    await exec(
      `tsbs_generate_data --use-case=cpu-only --seed=${seed} --scale=${scale} --timestamp-start="2016-01-01T00:00:00Z"  --timestamp-end="2016-01-02T00:00:00Z" --log-interval="10s" --format="victoriametrics" | gzip > data.gz`
    );

    core.info("Running tsbs_load command");

    const result = await exec(
      `export GOPATH=$HOME/go && export PATH=$PATH:$GOROOT/bin:$GOPATH/bin && cat data.gz | gunzip | tsbs_load_${type} --workers=${workers} --batch-size=${batch_size} --urls="${host}/write"`
    );

    if (!result.success) {
      core.error("Failed to run tsbs: " + result.stderr);
      return [];
    }

    // Parse the result and return the metrics
    core.info("" + result.stdout);

    return [];
  },
});

export type TSBSAdapter = typeof tsbsAdapter;

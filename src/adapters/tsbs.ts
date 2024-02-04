import { exec } from "@actions/exec";
import { createAdapter } from "../types";
import { z } from "zod";

/**
 * This is the adapter for the TSBS benchmarking tool. Works with many popular time series databases.
 */
export const tsbsAdapter = createAdapter({
  tool: "tsbs",
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
    scale: z.number(),
    timestamp_start: z.string(),
    timestamp_end: z.string(),
    log_interval: z.string(),
    workers: z.number(),
    batch_size: z.number(),
  }),
  setup: async ({
    options: {
      database: { type },
    },
  }) => {
    return [
      "go install github.com/timescale/tsbs/cmd/tsbs_generate_data@latest",
      `go install github.com/timescale/tsbs/cmd/tsbs_load_${type}@latest`,
    ];
  },
  run: async ({
    options: {
      database: { type, name, host, password },
      seed,
    },
  }) => {
    await exec(
      `tsbs_generate_data --use-case=cpu-only --seed=${seed} --scale=1 --timestamp-start=2020-01-01T00:00:00Z --timestamp-end=2020-01-01T00:00:00Z --log-interval=1s --format=influx | gzip > data.gz`
    );

    await exec(
      `tsbs_load_${type} --workers=1 --batch-size=1000 --reporting-period=1s --urls=${host} --admin-db-name=${name} --pass=${password} --file=data.gz`
    );

    return [];
  },
});

export type TSBSAdapter = typeof tsbsAdapter;

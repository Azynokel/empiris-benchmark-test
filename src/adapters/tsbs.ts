import { exec } from "@actions/exec";
import { createAdapter } from "../types";
import { z } from "zod";

/**
 * This is the adapter for the TSBS benchmarking tool. Works with many popular time series databases.
 */
export const tsbsAdapter = createAdapter({
  tool: "tsbs",
  config: z.object({
    sut: z.union([z.literal("victoriametrics"), z.literal("timescaledb")]),
    password: z.string().optional().default("tsbs"),
    username: z.string().optional().default("tsbs"),
    database: z.string().optional().default("tsbs"),
    host: z.string().min(1).optional().default("http://localhost:8086"),
  }),
  setup: async ({ options: { sut } }) => {
    await exec(
      "go install github.com/timescale/tsbs/cmd/tsbs_generate_data@latest"
    );
    await exec(
      `go install github.com/timescale/tsbs/cmd/tsbs_load_${sut}@latest`
    );
  },
  run: async ({ options: { database, host, password, sut } }) => {
    await exec(
      "tsbs_generate_data --use-case=cpu-only --seed=123 --scale=1 --timestamp-start=2020-01-01T00:00:00Z --timestamp-end=2020-01-01T00:00:00Z --log-interval=1s --format=influx | gzip > data.gz"
    );

    await exec(
      `tsbs_load_${sut} --workers=1 --batch-size=1000 --reporting-period=1s --urls=${host} --admin-db-name=${database} --pass=${password} --file=data.gz`
    );

    return [];
  },
});

export type TSBSAdapter = typeof tsbsAdapter;

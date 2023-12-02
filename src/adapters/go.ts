import { exec } from "@actions/exec";
import { GoConfig } from "../config";
import { BenchmarkAdapter } from "../types";

export type GoAdapter = BenchmarkAdapter<"go", GoConfig>;

/**
 * This is the adapter for the integrated Go benchmarking tool.
 */
export const goAdapter: GoAdapter = {
  tool: "go",
  setup: async () => {
    // TODO: Setup gcp compute instance to run benchmarks on
    // setupComputeInstance();
  },
  run: async ({ workdir }) => {
    // TODO: Run go benchmark
    await exec(`go test -bench=${workdir} > ${workdir}/results.txt`);

    return [];
  },
};

import { exec } from "@actions/exec";
import { createAdapter } from "../types";
import { randomizedInterleavedExecution } from "../utils";
import { z } from "zod";
import {
  getBenchmarkstoRun,
  buildCallGraph,
  retrievePreviousCallGraph,
} from "../optimization/call-graph";

// import { getSSHKeyPath } from "../infrastructure/setup-ssh";
// import { SSH_KEY_NAME, USER_NAME } from "../infrastructure/constants";

async function getAllBenchmarks(workdir: string) {
  let out: string = "";

  const currentDir = process.cwd();

  // Change directory to workdir with code
  process.chdir(workdir);

  // Get all benchmarks from the go test command in the workdir
  await exec(`go test -list Benchmark*`, [], {
    ignoreReturnCode: true,
    listeners: {
      stdout: (data: Buffer) => {
        out += data.toString();
      },
    },
  });

  // All benchmarks are separated by a newline and start with Benchmark
  const benchmarksList = out
    .split("\n")
    .filter((benchmark) => benchmark.trim().startsWith("Benchmark"));

  // Change directory back to the original directory
  process.chdir(currentDir);

  return benchmarksList;
}

/**
 * This is the adapter for the integrated Go benchmarking tool.
 */
export const goAdapter = createAdapter({
  tool: "go",
  config: z.object({
    workdir: z.string().optional().default("."),
    iterations: z.number().optional().default(1),
    package: z.string().optional().default("."),
  }),
  setup: async () => {
    return [];
  },

  run: async ({
    options: { workdir, iterations, package: packageName },
    metadata: { ip: _ip },
  }) => {
    const currentDir = process.cwd();
    // Change directory to workdir with code
    process.chdir(workdir);

    // Get all benchmarks
    const allBenchmarks = await getAllBenchmarks(packageName);

    const currentCallGraph = await buildCallGraph(packageName);
    const previousCallGraph = await retrievePreviousCallGraph();

    const benchmarks = getBenchmarkstoRun(
      previousCallGraph,
      currentCallGraph,
      allBenchmarks.map((benchmark) => [packageName, benchmark])
    );

    console.log("Benchmarks to run", benchmarks);

    await randomizedInterleavedExecution(
      benchmarks.map(
        ([_, benchmark]) =>
          async () => {
            await exec(`go test -bench=${benchmark} ./${packageName}`);
          },
        iterations
      )
    );

    // Change directory back to the original directory
    process.chdir(currentDir);

    return [];
  },
});

export type GoAdapter = typeof goAdapter;

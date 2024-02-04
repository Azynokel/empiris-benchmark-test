import { exec } from "@actions/exec";
import core from "@actions/core";
import { createAdapter } from "../types";
import { randomizedInterleavedExecution } from "../utils";
import { z } from "zod";
import {
  getBenchmarkstoRun,
  buildCallGraph,
  retrievePreviousCallGraph,
  getLastChanges,
} from "../optimization/call-graph";

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
    metadata: { ip: _ip, githubToken },
  }) => {
    if (!githubToken) {
      core.error(
        "No github token provided, this adapter only works with a github token"
      );
      return [];
    }

    const currentDir = process.cwd();
    // Change directory to workdir with code
    process.chdir(workdir);

    // Get all benchmarks
    const allBenchmarks = await getAllBenchmarks(packageName);

    const previousCallGraph = await retrievePreviousCallGraph(githubToken);
    // Note: Also uploads a new call graph
    const currentCallGraph = await buildCallGraph(packageName);
    const lastChanges = await getLastChanges(workdir);

    // Filter out all non .go files
    const goFiles = Object.fromEntries(
      Object.entries(lastChanges).filter(([file, _]) => file.endsWith(".go"))
    );

    const benchmarks = getBenchmarkstoRun({
      previousCallGraph,
      currentCallGraph,
      changedFiles: goFiles,
      allBenchmarks: allBenchmarks.map((benchmark) => [packageName, benchmark]),
    });

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

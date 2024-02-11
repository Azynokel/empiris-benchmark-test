import { exec } from "@actions/exec";
import * as core from "@actions/core";
import { Metric, createAdapter } from "../types";
import { randomizedInterleavedExecution } from "../utils";
import { z } from "zod";
import {
  getBenchmarkstoRun,
  buildCallGraph,
  retrievePreviousCallGraph,
  getLastChanges,
} from "../optimization/call-graph";
import { Graph } from "ts-graphviz";

function parseGoBenchmarkOutput(output: string): Metric[] {
  const lines = output.split("\n");
  const benchmarks = lines
    .filter((line) => line.startsWith("Benchmark"))
    .map((line) => {
      const [name, ops, nsPerOp, b, _allocs] = line.split(/\s+/);
      return {
        name,
        ops,
        nsPerOp,
        b,
      };
    });

  console.log(benchmarks);

  return [];
}

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
    const currentDir = process.cwd();
    // Change directory to workdir with code
    process.chdir(workdir);

    // Get all benchmarks
    const allBenchmarks = await getAllBenchmarks(packageName);

    if (!githubToken) {
      core.warning(
        "No github token provided, optimizing the benchmarks is only possible with a github token"
      );
    }

    const previousCallGraph =
      typeof githubToken === "undefined"
        ? new Graph()
        : await retrievePreviousCallGraph(githubToken);
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

    let outputs: string[] = [];

    await randomizedInterleavedExecution(
      benchmarks.map(
        ([_, benchmark]) =>
          async () => {
            let out = "";
            await exec(`go test -bench=${benchmark} ./${packageName}`, [], {
              listeners: {
                stdout: (data: Buffer) => {
                  out += data.toString();
                },
              },
            });

            outputs.push(out);
          },
        iterations
      )
    );

    // Change directory back to the original directory
    process.chdir(currentDir);

    // TODO
    outputs.map(parseGoBenchmarkOutput);

    // Average the metrics

    return [];
  },
});

export type GoAdapter = typeof goAdapter;

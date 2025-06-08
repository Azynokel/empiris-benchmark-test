import * as core from "@actions/core";
import { DataframeMetric, ExecFn, createAdapter } from "../types";
import { randomizedInterleavedExecution } from "../utils";
import { z } from "zod";
import {
  getBenchmarkstoRun,
  buildCallGraph,
  retrievePreviousCallGraph,
  getLastChanges,
} from "../optimization/call-graph";
import { Graph } from "ts-graphviz";
import { join } from "path";

function parseGoBenchmarkOutput(output: string): DataframeMetric[] {
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

  // Turn the benchmarks into metrics
  return benchmarks.map((benchmark) => {
    return {
      type: "dataframe",
      metric: "latency",
      value: parseFloat(benchmark.nsPerOp),
      unit: "ns/op",
      specifier: benchmark.name,
    };
  });
}

async function getAllBenchmarks(
  workdir: string,
  exec: ExecFn,
  isLocal: boolean
) {
  let out: string = "";

  if (isLocal) {
    try {
      // Change directory to workdir with code
      process.chdir(workdir);
    } catch (err) {
      core.error(
        `Failed to change directory to workdir.\n` +
        `workdir: ${workdir}\n` +
        `isLocal: ${isLocal}\n` +
        `cwd before chdir: ${process.cwd()}\n` +
        `Error: ${err instanceof Error ? err.message : err}`
      );
      return [];
    }
  }

  // Get all benchmarks from the go test command in the workdir
  const command = isLocal
    ? `go test -list Benchmark*`
    : `cd ${workdir} && go test -list Benchmark*`;

  const result = await exec(command);

  if (!result.success) {
    const lsResult = await exec(`ls -la`);
    core.error(
      `Failed to list benchmarks.\n` +
      `isLocal: ${isLocal}\n` +
      `cwd: ${process.cwd()}\n` +
      `workdir: ${workdir}\n` +
      `executed command: ${command}\n` +
      `stderr: ${result.stderr}\n` +
      `Directory listing (ls -la):\n${lsResult.stdout || lsResult.stderr}`
    );
    return [];
  }

  out = result.stdout;

  // All benchmarks are separated by a newline and start with Benchmark
  const benchmarksList = out
    .split("\n")
    .filter((benchmark) => benchmark.trim().startsWith("Benchmark"));

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
    optimization: z.boolean().optional().default(false),
  }),
  dependsOn: ["go"],
  setup: async () => {
    // No setup needed
    return { success: true };
  },

  run: async ({
    exec,
    isLocal,
    options: { workdir, iterations, package: packageName, optimization },
    metadata: { ip: _ip, githubToken },
  }) => {
    const currentDir = process.cwd();

    // Get all benchmarks
    const allBenchmarks = await getAllBenchmarks(
      join(workdir, packageName),
      exec,
      isLocal
    );

    process.chdir(join(currentDir, workdir));

    let benchmarks = allBenchmarks.map((benchmark) => [packageName, benchmark]);

    if (optimization) {
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
      const lastChanges = await getLastChanges(".");

      // Filter out all non .go files
      const goFiles = Object.fromEntries(
        Object.entries(lastChanges).filter(([file, _]) => file.endsWith(".go"))
      );

      benchmarks = getBenchmarkstoRun({
        previousCallGraph,
        currentCallGraph,
        changedFiles: goFiles,
        allBenchmarks: allBenchmarks.map((benchmark) => [
          packageName,
          benchmark,
        ]),
      });
    }

    core.info(`Running benchmarks: ${benchmarks.map((b) => b[1]).join(", ")}`);

    let outputs: string[] = [];

    await randomizedInterleavedExecution(
      benchmarks.map(([_, benchmark]) => async () => {
        const result = await exec(
          isLocal
            ? `go test -bench=${benchmark} ./${packageName}`
            : `cd ${workdir} && go test -bench=${benchmark} ./${packageName}`
        );

        if (!result.success) {
          core.error(`Failed to run benchmark ${benchmark}`);
          return;
        }

        outputs.push(result.stdout);
      }),
      iterations
    );

    // Change directory back to the original directory
    process.chdir(currentDir);

    const allMetrics = outputs.map(parseGoBenchmarkOutput);

    // Find the same benchmarks by the specifier
    const allMetricsMap = allMetrics.flat().reduce((acc, metric) => {
      if (!metric.specifier) {
        return acc;
      }
      if (acc[metric.specifier]) {
        acc[metric.specifier].push(metric);
      } else {
        acc[metric.specifier] = [metric];
      }
      return acc;
    }, {} as Record<string, DataframeMetric[]>);

    // Average the metrics
    const averagedMetrics = Object.values(allMetricsMap).map((metrics) => {
      const total = metrics.reduce((acc, metric) => {
        return acc + metric.value;
      }, 0);

      const average = total / metrics.length;
      return {
        ...metrics[0],
        value: average,
      };
    });

    return averagedMetrics;
  },
});

export type GoAdapter = typeof goAdapter;

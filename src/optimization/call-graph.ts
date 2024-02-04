import { exec } from "@actions/exec";
import { DefaultArtifactClient } from "@actions/artifact";
import { readFile, unlink, writeFile } from "fs/promises";
import { fromDot, Node, RootGraphModel, Graph } from "ts-graphviz";

const artifactClient = new DefaultArtifactClient();

const CALL_GRAPH_ARTIFACT_NAME = "call-graph";

export async function retrievePreviousCallGraph() {
  if (process.env.ENV === "dev") {
    return new Graph();
  }

  const {
    artifact: { id },
  } = await artifactClient.getArtifact(CALL_GRAPH_ARTIFACT_NAME);

  // Get last known dot file
  const { downloadPath } = await artifactClient.downloadArtifact(id, {
    path: "call-graph.dot",
  });

  if (!downloadPath) {
    // Empty graph
    return new Graph();
  }

  const dotModel = await readFile(downloadPath, "utf-8");

  return fromDot(dotModel);
}

export async function buildCallGraph(workdir: string) {
  const profilePath = "profile.out";
  const dotPath = "output.dot";

  // TODO: Increase cpu profiling rate to get more accurate results
  await exec(
    `go test -bench=Benchmark -cpuprofile ${profilePath} ./${workdir}`,
    [],
    { silent: true }
  );

  // TODO: The -ignore='runtime.|sync.|syscall.' flag could be used to ignore the standard library
  await exec(`go tool pprof -dot ${profilePath}`, [], {
    listeners: {
      async stdout(data) {
        // Append to the output file
        await writeFile(dotPath, data, { flag: "a" });
      },
    },
  });

  const dotModel = await readFile(dotPath, "utf-8");

  const graph = fromDot(dotModel.replaceAll("\n", " "));

  if (process.env.ENV !== "dev") {
    await artifactClient.uploadArtifact(
      CALL_GRAPH_ARTIFACT_NAME,
      [dotPath],
      "."
    );
  }

  // Clean up
  await unlink(dotPath);
  await unlink(profilePath);

  return graph;
}

function getDependencies(callGraph: RootGraphModel, nodeId: string) {
  const dependencies: Node[] = [];

  for (const edge of callGraph.edges) {
    const [fromNode, toNode] = edge.targets as [Node, Node];
    if (toNode.id === nodeId) {
      dependencies.push(fromNode);
      dependencies.push(...getDependencies(callGraph, fromNode.id));
    }
  }

  return dependencies;
}

export function getBenchmarkstoRun({
  allBenchmarks,
  currentCallGraph,
  previousCallGraph,
}: {
  previousCallGraph: RootGraphModel;
  currentCallGraph: RootGraphModel;
  changedFiles: Record<string, string>;
  // Tuples of package name and benchmark name
  allBenchmarks: [string, string][];
}) {
  // Check for each benchmark if the dependencies have changed
  // If so, run the benchmark
  const benchmarksToRun: [string, string][] = [];

  for (const benchmark of allBenchmarks) {
    const [_packageName, benchmarkName] = benchmark;
    const previousNode = previousCallGraph.nodes.find((node) =>
      node.attributes.get("label")?.includes(benchmarkName)
    );

    if (!previousNode) {
      // Benchmark is new, run it
      benchmarksToRun.push(benchmark);
      continue;
    }

    const currentNode = currentCallGraph.nodes.find((node) =>
      node.attributes.get("label")?.includes(benchmarkName)
    );

    if (!currentNode) {
      // Benchmark was removed, don't run it
      continue;
    }

    // Check if the dependencies have changed by traversing both graphs
    const previousDependencies = getDependencies(
      previousCallGraph,
      previousNode.id
    );
    const currentDependencies = getDependencies(
      currentCallGraph,
      currentNode.id
    );

    if (
      previousDependencies.some(
        (dependency, index) => dependency !== currentDependencies[index]
      )
    ) {
      // Dependencies have changed, run the benchmark
      benchmarksToRun.push(benchmark);
      continue;
    }

    // Check if the code of the benchmark has changed, here the previous and current dependencies are the same
    for (const dependency of previousDependencies) {
      console.log(dependency);
    }
  }

  return benchmarksToRun;
}

/**
 * Function to get the content of a file n commits ago
 */
export async function getFileContentNCommitsAgo(
  filePath: string,
  travelBack = 1
) {
  let content = "";

  await exec(`git show HEAD~${travelBack}:${filePath}`, [], {
    listeners: {
      stdout(data) {
        content += data.toString();
      },
    },
  });

  return content;
}

/**
 * Function to get the last relevant changes in the files of the workdir
 */
export async function getLastChanges(workdir: string) {
  let changedFiles = "";

  await exec(`git diff --name-only HEAD~1 HEAD -- ${workdir}`, [], {
    listeners: {
      stdout(data) {
        changedFiles += data.toString();
      },
    },
  });

  const files = changedFiles.split("\n").filter(Boolean);

  const changes: Record<string, string> = {};

  for (const file of files) {
    changes[file] = await getFileContentNCommitsAgo(file, 1);
  }

  return changes;
}

import { exec } from "@actions/exec";
import { DefaultArtifactClient } from "@actions/artifact";
import { readFile, unlink } from "fs/promises";
import { fromDot, Node, RootGraphModel, Graph } from "ts-graphviz";

const artifactClient = new DefaultArtifactClient();

const CALL_GRAPH_ARTIFACT_NAME = "call-graph";

export async function retrievePreviousCallGraph() {
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

  // TODO: The -benchtime flag is used to run the benchmark for 1000ms, this might be too short
  await exec(
    `go test -bench=Benchmark -cpuprofile ${profilePath} -benchtime=1000ms ./${workdir}`
  );

  // TODO: The -ignore='runtime.|sync.|syscall.' flag could be used to ignore the standard library
  await exec(`go tool pprof -dot ${profilePath} > ${dotPath}`);

  const dotModel = await readFile(dotPath, "utf-8");

  const graph = fromDot(dotModel.replaceAll("\n", " "));

  await artifactClient.uploadArtifact(CALL_GRAPH_ARTIFACT_NAME, [dotPath], ".");

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

export function getBenchmarkstoRun(
  previousCallGraph: RootGraphModel,
  currentCallGraph: RootGraphModel,
  // Tuples of package name and benchmark name
  allBenchmarks: [string, string][]
) {
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
  }

  return benchmarksToRun;
}

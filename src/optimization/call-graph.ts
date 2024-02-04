import * as core from "@actions/core";
import { exec } from "@actions/exec";
import * as github from "@actions/github";
import { DefaultArtifactClient } from "@actions/artifact";
import { readFile, unlink, writeFile } from "fs/promises";
import { fromDot, Node, RootGraphModel, Graph } from "ts-graphviz";
import path from "path";

const artifactClient = new DefaultArtifactClient();

const CALL_GRAPH_ARTIFACT_NAME = "call-graph";
const DOT_FILE = "output.dot";

export async function retrievePreviousCallGraph(token: string) {
  core.info("Retrieving previous call graph");

  // Get last run id
  const octokit = github.getOctokit(token);

  core.info(
    `Getting the last run for the workflow ${process.env.GITHUB_WORKFLOW_ID}`
  );
  const repo = process.env.GITHUB_REPOSITORY?.split("/");

  core.info(`Owner: ${repo?.[0]}`);
  core.info(`Repo: ${repo?.[1]}`);

  const { data: runs } = await octokit.rest.actions.listWorkflowRuns({
    owner: repo?.[0] as string,
    repo: repo?.[1] as string,
    workflow_id: process.env.GITHUB_WORKFLOW_ID as string,
    status: "completed",
  });

  if (runs.total_count === 0) {
    core.info("No previous runs found");
    return new Graph();
  }

  const lastRunId = runs.workflow_runs.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0].id;

  core.info(`Last run id: ${lastRunId}`);

  if (process.env.ENV === "dev") {
    return new Graph();
  }

  try {
    const {
      artifact: { id },
    } = await artifactClient.getArtifact(CALL_GRAPH_ARTIFACT_NAME, {
      findBy: {
        repositoryName: repo?.[1] as string,
        repositoryOwner: repo?.[0] as string,
        token,
        workflowRunId: lastRunId,
      },
    });

    // Get last known dot file
    const { downloadPath } = await artifactClient.downloadArtifact(id);

    if (!downloadPath) {
      // Empty graph
      return new Graph();
    }

    const dotModel = await readFile(path.join(downloadPath, DOT_FILE), "utf-8");

    return fromDot(dotModel);
  } catch (error) {
    core.warning(
      "Could not retrieve previous call graph, resume with empty graph: " +
        error
    );
    return new Graph();
  }
}

export async function buildCallGraph(workdir: string) {
  const profilePath = "profile.out";

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
        await writeFile(DOT_FILE, data, { flag: "a" });
      },
    },
  });

  const dotModel = await readFile(DOT_FILE, "utf-8");

  const graph = fromDot(dotModel.replaceAll("\n", " "));

  if (process.env.ENV !== "dev") {
    await artifactClient.uploadArtifact(
      CALL_GRAPH_ARTIFACT_NAME,
      [DOT_FILE],
      "."
    );
  }

  // Clean up
  await unlink(DOT_FILE);
  await unlink(profilePath);

  return graph;
}

function getDependencies(callGraph: RootGraphModel, nodeId: string) {
  const dependencies: Node[] = [];

  for (const edge of callGraph.edges) {
    const [fromNode, toNode] = edge.targets as [Node, Node];
    if (fromNode.id === nodeId) {
      dependencies.push(toNode);
      dependencies.push(...getDependencies(callGraph, toNode.id));
    }
  }

  return dependencies;
}

export function getBenchmarkstoRun({
  allBenchmarks,
  currentCallGraph,
  previousCallGraph,
  changedFiles,
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
        (dependency, index) =>
          previousCallGraph.getNode(dependency.id)?.attributes?.get("label") !==
          currentCallGraph
            .getNode(currentDependencies[index]?.id)
            ?.attributes?.get("label")
      )
    ) {
      // Dependencies have changed, run the benchmark
      benchmarksToRun.push(benchmark);
      continue;
    }

    // Check if the code of the benchmark has changed, here the previous and current dependencies are the same
    for (const dependency of previousDependencies) {
      const label = previousCallGraph
        .getNode(dependency.id)
        ?.attributes?.get("label");

      if (!label) {
        continue;
      }

      const [packageName, methodName] = label.split("\n");

      core.info(
        `Checking if ${packageName} and ${methodName} are present in the changed files`
      );
      core.info(`Changed files: ${JSON.stringify(changedFiles)}`);

      // Check if in some changed file the packageName and methodName is present
      if (
        Object.values(changedFiles).some(
          (file) =>
            file.trimStart().startsWith(`package ${packageName}`) &&
            file.includes(`func ${methodName}(`)
        )
      ) {
        benchmarksToRun.push(benchmark);
        break;
      }
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

import * as core from "@actions/core";
import { DataframeMetric, ExecFn, createAdapter } from "../types";
import { z } from "zod";
import { waitOn } from "../utils";
import { parse, stringify } from "yaml";
import { writeFile } from "fs/promises";
import { getMetricsWithAI } from "../ai-result-parser";

type ArtilleryHistogramData = {
  min: number;
  max: number;
  median: number;
  p95: number;
  p99: number;
};

async function runArtillery({
  exec,
  configPath,
  dependsOn,
  host,
  report,
}: {
  exec: ExecFn;
  configPath: string;
  dependsOn: { url: string }[];
  host: string;
  report: string[];
}): Promise<DataframeMetric[]> {
  // If there is a package.json file, install the dependencies
  const packageJson = await exec("cat package.json");
  if (packageJson.success) {
    await exec("npm install");
  }

  if (dependsOn.length > 0) {
    core.info(`Waiting for dependencies to be ready`);
  }

  await waitOn({
    ressources: dependsOn.map((dep) => dep.url),
    // Wait for 10 minutes
    timeout: 10 * 60 * 1000,
  });

  core.info("Host " + host);

  core.info(`Running Artillery with config ${configPath}`);
  // const result = await exec(
  //   `export host=${host} && artillery run ${configPath} --output report.json`
  // );

  const result = await exec(`artillery run ${configPath} --output report.json`);

  if (!result.success) {
    core.error("Failed to run artillery: " + result.stderr);
    return [];
  }

  // Print the last lines of the std out
  const lastLines = result.stdout.split("\n").slice(-50);
  core.info("Last 50 lines of stdout: " + lastLines.join("\n"));

  // Read the report
  const allDataRaw = await exec("cat report.json");

  if (!allDataRaw.success) {
    core.error("Failed to read report");
    return [];
  }

  const allData = JSON.parse(allDataRaw.stdout);

  await getMetricsWithAI(lastLines.join("\n"));

  // Under aggregate.summary we have the keys we want to report
  const data: Record<string, ArtilleryHistogramData> = {};
  report.forEach((key) => {
    // TODO: This is weird but needed for some reason
    const joinedKey = Object.values(
      key as unknown as Record<string, string>
    ).join("");
    if (allData.aggregate.summaries[joinedKey] === undefined) {
      core.error("Key not found in report: " + joinedKey);
      return;
    }
    data[joinedKey] = allData.aggregate.summaries[
      joinedKey
    ] as ArtilleryHistogramData;
  });

  core.info("Data: " + JSON.stringify(data, null, 2));

  // Transform the data into dataframe metrics
  return Object.entries(data).map(
    ([key, { median }]) =>
      ({
        type: "dataframe",
        metric: "latency",
        specifier: `${key} - median`,
        unit: "ms",
        value: median,
      } as DataframeMetric)
  );
}

const artilleryConfigSchema = z.object({
  config: z.object({
    target: z.string(),
    phases: z.array(
      z.object({
        duration: z.number(),
        arrivalRate: z.number(),
      })
    ),
  }),
  scenarios: z.array(
    z.object({
      flow: z.array(
        z
          .object({
            get: z.object({
              url: z.string(),
            }),
          })
          .or(
            z.object({
              post: z.object({
                url: z.string(),
                json: z.record(z.any()),
              }),
            })
          )
      ),
    })
  ),
});

export const artilleryAdapter = createAdapter({
  tool: "artillery",
  dependsOn: ["node"],
  config: z.object({
    config_path: z.string().optional().default("artillery.yaml"),
    // Host to run test against
    hosts: z.array(z.object({ url: z.string() })),
    // List of keys to report
    report: z.array(z.string()).optional().default([]),
    depends_on: z
      .array(
        z.object({
          url: z.string(),
        })
      )
      .optional()
      .default([]),
    extensions: z
      .array(
        z.object({
          name: z.literal("ai-generated-telemetry"),
        })
      )
      .optional()
      .default([]),
  }),
  setup: async ({ exec }) => {
    const result = await exec("npm install -g artillery@latest");

    if (!result.success) {
      return {
        success: false,
        error: "Failed to install artillery: " + result.stderr,
      };
    }

    return { success: true };
  },
  run: async ({
    exec,
    options: { config_path: configPath, depends_on: dependsOn, hosts, report },
  }) => {
    if (hosts.length !== 1) {
      throw new Error("Only one host is supported in traditional mode");
    }

    const [host] = hosts;

    const metrics = await runArtillery({
      exec,
      configPath,
      dependsOn,
      host: host.url,
      report,
    });

    return metrics;
  },
  runDuet: async ({
    options: { config_path, hosts, depends_on, report, extensions },
    metadata: { api, experimentRunId },
    exec,
  }) => {
    if (hosts.length !== 2) {
      throw new Error("Only two hosts are supported in duet mode");
    }

    const isAiGeneratedTelemetryEnabled = extensions.some(
      (ext) => ext.name === "ai-generated-telemetry"
    );

    if (isAiGeneratedTelemetryEnabled && (typeof experimentRunId === "undefined" || typeof api === "undefined")) {
      throw new Error(
        "The ai-generated-telemetry extension requires the API to be defined"
      );
    }

    // We take the original config and augment it to support the duet mode
    try {
      const config = await exec(`cat ${config_path}`);

      if (!config.success) {
        throw new Error("Failed to read config: " + config.stderr);
      }

      // The config looks like this https://www.artillery.io/docs/reference/engines/http
      const parsedConfig = artilleryConfigSchema.safeParse(
        parse(config.stdout)
      );

      if (!parsedConfig.success) {
        throw new Error(
          "Invalid config: " + JSON.stringify(parsedConfig.error, null, 2)
        );
      }

      // For the purpose of Duet Benchmarking, we use parallel requests https://www.artillery.io/docs/reference/engines/http#parallel-requests

      // Potentially helpful issue: https://github.com/artilleryio/artillery/issues/303
      // We expand each stage in a flow to have a parallel request
      const expandedScenarios = parsedConfig.data.scenarios.map((scenario) => {
        const expandedFlow = scenario.flow.map((flow) => {
          if ("get" in flow) {
            return {
              parallel: [
                {
                  get: {
                    url: hosts[0].url + flow.get.url,
                  },
                },
                {
                  get: {
                    url: hosts[1].url + flow.get.url,
                  },
                },
              ],
            };
          } else {
            // TODO: Handle POST requests
          }

          return flow;
        });

        return { flow: expandedFlow };
      });

      const expandedConfig = {
        config: {
          ...parsedConfig.data.config,
          ...(isAiGeneratedTelemetryEnabled
            ? {
                http: {
                  defaults: {
                    headers: {
                      "X-EMPIRIS-Experiment-Id": experimentRunId,
                      "X-EMPIRIS-Api-Key": api?.key,
                    },
                  },
                },
              }
            : {}),
        },
        scenarios: expandedScenarios,
      };

      const expandedConfigPath = config_path.replace(".yml", "-duet.yml");

      // TODO: Make this independent of the environment
      await writeFile(expandedConfigPath, stringify(expandedConfig));

      // Check if artillery is installed
      const artilleryInstalled = await exec("which artillery");

      if (!artilleryInstalled.success) {
        throw new Error(
          "Artillery is not installed: " + artilleryInstalled.stderr
        );
      }

      const metrics = await runArtillery({
        exec,
        configPath: expandedConfigPath,
        dependsOn: depends_on,
        host: "",
        report,
      });

      return {
        metrics,
        samples: []
      }
    } catch (e) {
      throw new Error("Failed to read config: " + e);
    }
  },
});

export type ArtilleryAdapter = typeof artilleryAdapter;

import { exec } from "@actions/exec";
import * as core from "@actions/core";
import { Metric, TimeSeriesMetric, createAdapter } from "../types";
import { z } from "zod";
import { NodeSSH } from "node-ssh";
import { waitOn } from "../utils";

const ssh = new NodeSSH();

/**
 * Parse the output of inch and return a list of metrics
 * @param _out The output of inch
 * @returns A list of metrics
 */
export function parseOutput(_out: string): Metric[] {
  // Initialize metrics
  const metrics: TimeSeriesMetric[] = [];
  // Split the output into lines
  const lines = _out.split("\n");

  // Initialize metrics
  const currentThroughputs: number[] = [];
  const errors: number[] = [];
  const avgLatencies: number[] = [];

  // Process each line
  for (const line of lines) {
    // Check if the line contains metrics
    if (line.startsWith("T=")) {
      // Extract the metrics
      const match = line.match(
        /T=\d+ (\d+) points written.*Total throughput: (\d+\.\d+).*Current throughput: (\d+(?:\.\d+)?).*Errors: (\d+)(?: \| μ: (\d+\.\d+)ms, 90%: (\d+\.\d+)ms, 95%: (\d+\.\d+)ms, 99%: (\d+\.\d+)ms)?/
      );
      if (match) {
        currentThroughputs.push(parseFloat(match[3]));
        errors.push(parseInt(match[4]));
        // If no latency is present, skip the line
        if (typeof match[5] === "undefined") {
          continue;
        }
        avgLatencies.push(parseFloat(match[5]));
      }
    }
  }

  metrics.push({
    type: "time_series",
    metric: "latency",
    timestamps: avgLatencies.map((_, i) => i),
    values: avgLatencies,
  });
  metrics.push({
    type: "time_series",
    metric: "throughput",
    timestamps: currentThroughputs.map((_, i) => i),
    values: currentThroughputs,
  });

  return metrics;
}

/**
 * This is the adapter for the inch benchmarking tool, works with InfluxDB 1.x and 2.x.
 */
export const inchAdapter = createAdapter({
  tool: "inch",
  config: z.object({
    influx_token: z.string(),
    version: z
      .union([z.literal(1), z.literal(2)])
      .optional()
      .default(2),
    database: z.string().optional().default("empiris"),
    host: z.string().min(1).optional().default("http://localhost:8086"),
    maxErrors: z.number().optional(),
    time: z.string().optional(),
    concurrency: z.number().optional().default(1),
    measurements: z.number().optional().default(100),
  }),
  dependencies: ["go"],
  setup() {
    return ["go install github.com/influxdata/inch/cmd/inch@latest"];
  },
  run: async ({
    options: {
      influx_token,
      version,
      database,
      host,
      maxErrors,
      time,
      concurrency,
      measurements,
    },
    metadata: { ip, runConfig },
  }) => {
    core.info(`Waiting for ${host} to be ready...`);

    await waitOn({
      ressources: [`${host}/health`],
      // Timeout after 5 minutes
      timeout: 1000 * 60 * 5,
    });

    core.info(`Running inch...`);
    let output = "";

    if (ip && runConfig) {
      await ssh.connect({
        host: ip,
        username: "empiris",
        privateKey: runConfig.ssh.private_key,
      });

      // Run inch on the remote machine
      const result = await ssh.execCommand(
        `export GOPATH=$HOME/go && export PATH=$PATH:$GOROOT/bin:$GOPATH/bin && inch -token ${influx_token} ${
          version === 2 ? "-v2" : ""
        } -v -db ${database} -host ${host} ${
          typeof maxErrors === "undefined" ? "" : `-max-errors ${maxErrors}`
        } ${
          typeof time === "undefined" ? "" : `-time ${time}`
        } -c ${concurrency} -m ${measurements}`
      );

      core.info(result.stdout);

      output = result.stdout;
    } else {
      // Run inch locally
      await exec(
        `inch -token ${influx_token} ${
          version === 2 ? "-v2" : ""
        } -v -db ${database} ${
          typeof maxErrors === "undefined" ? "" : `-max-errors ${maxErrors}`
        } ${
          typeof time === "undefined" ? "" : `-time ${time}`
        } -c ${concurrency} -m ${measurements} -host ${host}`,
        [],
        {
          listeners: {
            stdout: (data: Buffer) => {
              output += data.toString();
            },
          },
        }
      );
    }

    return parseOutput(output);
  },
});

export type InchAdapter = typeof inchAdapter;

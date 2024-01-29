import { exec } from "@actions/exec";
import * as core from "@actions/core";
import { Metric, createAdapter } from "../types";
import { waitOn } from "../utils";
import { z } from "zod";

/**
 * Parse the output of inch and return a list of metrics
 * @param _out The output of inch
 * @returns A list of metrics
 */
export function parseOutput(_out: string): Metric[] {
  // Initialize metrics
  const metrics: Metric[] = [];
  // Split the output into lines
  const lines = _out.split("\n");

  // Initialize metrics
  // let totalPoints = 0;
  let totalThroughput = 0;
  let currentThroughput = 0;
  let errors = 0;
  /*let avgLatency = 0;
  let p90Latency = 0;
  let p95Latency = 0;
  let p99Latency = 0; */

  // Process each line
  for (const line of lines) {
    // Check if the line contains metrics
    if (line.startsWith("T=")) {
      // Extract the metrics
      const match = line.match(
        /T=\d+ (\d+) points written.*Total throughput: (\d+\.\d+).*Current throughput: (\d+(?:\.\d+)?).*Errors: (\d+)(?: \| μ: (\d+\.\d+)ms, 90%: (\d+\.\d+)ms, 95%: (\d+\.\d+)ms, 99%: (\d+\.\d+)ms)?/
      );
      if (match) {
        // totalPoints = parseInt(match[1]);
        totalThroughput = parseFloat(match[2]);
        currentThroughput = parseFloat(match[3]);
        errors = parseInt(match[4]);
        /* avgLatency = parseFloat(match[5]);
        p90Latency = parseFloat(match[6]);
        p95Latency = parseFloat(match[7]);
        p99Latency = parseFloat(match[8]); */
      }
      // Create DataframeMetric objects and add them to the list of metrics
      metrics.push(
        {
          type: "dataframe",
          metric: "throughput",
          value: totalThroughput,
          unit: "pt/sec",
          specifier: "total",
        },
        {
          type: "dataframe",
          metric: "throughput",
          value: currentThroughput,
          unit: "val/sec",
          specifier: "current",
        },
        {
          type: "dataframe",
          metric: "error_rate",
          value: errors,
          unit: "errors",
          specifier: null,
        }
        /* { type: 'dataframe', metric: 'latency', value: avgLatency, unit: 'ms', specifier: 'μ' },
        { type: 'dataframe', metric: 'latency', value: p90Latency, unit: 'ms', specifier: '90%' },
        { type: 'dataframe', metric: 'latency', value: p95Latency, unit: 'ms', specifier: '95%' },
        { type: 'dataframe', metric: 'latency', value: p99Latency, unit: 'ms', specifier: '99%' }, */
      );
    }
  }

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
    time: z.number().optional(),
  }),
  setup: async () => {
    // Install inch locally
    await exec("go install github.com/influxdata/inch/cmd/inch@latest");
  },
  run: async ({
    options: { influx_token, version, database, host, maxErrors },
  }) => {
    // Wait for the database to be ready
    core.info(`Waiting for ${host} to be ready...`);

    await waitOn({
      ressources: [`${host}/health`],
    });

    core.info(`Running inch...`);

    // Run inch
    let output = "";
    await exec(
      "inch",
      [
        "-token",
        influx_token,
        version === 2 ? "-v2" : "",
        "-v",
        "-db",
        database,
        "-host",
        host,
        typeof maxErrors === "undefined" ? "" : `-max-errors ${maxErrors}`,
      ],
      {
        listeners: {
          stdout: (data: Buffer) => {
            output += data.toString();
          },
        },
      }
    );

    return parseOutput(output);
  },
});

export type InchAdapter = typeof inchAdapter;

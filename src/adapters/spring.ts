import * as core from "@actions/core";
import { z } from "zod";
import {
  TimeSeriesMetric,
  DataframeMetric,
  createAdapter,
} from "../types";

export const springBootAdapter = createAdapter({
  tool: "spring-boot",
  dependsOn: ["go"],
  config: z.object({
    SUTUrl: z.string(),
    numberOfRequests: z.number().default(100),
  }),
  setup: async ({ options: { SUTUrl } }) => {
    const start = Date.now();
    const timeout = 5000;
    const interval = 30000;

    while (Date.now() - start < timeout) {
      try {
        await fetch(SUTUrl);
        core.info("Application is live!");
        return { success: true };
      } catch {
        core.info(`Waiting for application to be ready at ${SUTUrl}...`);
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    }

    core.error("Application did not become ready in time.");
    return {
      success: false,
      error: "Failed to reach the Spring Boot application",
    };
  },
  run: async ({ options: { SUTUrl, numberOfRequests } }) => {
    const url = `${SUTUrl}:8080/api/benchmark/run?iterations=10000`;
    const responseTimes: number[] = [];
    const timeStamps: number[] = [];

    for (let i = 0; i < numberOfRequests; i++) {
      const startTime = Date.now();
      try {
        await fetch(url);
        const endTime = Date.now();
        timeStamps.push(Date.now());
        responseTimes.push(endTime - startTime);
      } catch (error) {
        core.error(`Request ${i + 1} failed: ${error}`);
      }
    }

    const total = responseTimes.reduce((acc, time) => acc + time, 0);
    const averageTime = total / responseTimes.length;

    const timeSeriesMetric: TimeSeriesMetric = {
      type: "time_series",
      metric: "latency",
      timestamps: timeStamps,
      values: responseTimes,
      unit: "ms",
    };

    const avgLatencyMetric: DataframeMetric = {
      type: "dataframe",
      metric: "latency",
      value: averageTime,
      unit: "ms",
      specifier: "average",
    };

    return [timeSeriesMetric, avgLatencyMetric];
  },
});

export type SpringBootAdapter = typeof springBootAdapter;

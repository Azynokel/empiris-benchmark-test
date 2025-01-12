import { DataframeMetric, TimeSeriesMetric, createAdapter } from "../types";
import { runLoadTest, testConfigSchema } from "../load-generator/load-generator";

/**
 * This is the adapter for general http-based load testing. It is built upon k6.
 */
export const httpAdapter = createAdapter({
  tool: "http",
  dependsOn: ["k6"],
  config: testConfigSchema,
  async setup() {
    return { success: true };
  },
  run: async ({ options: { target, ...rest }, metadata: {} }) => {
    if (!target) {
      throw new Error("No target provided");
    }

    const stats = await runLoadTest({
      target,
      ...rest,
    });

    const timeSeriesMetric: TimeSeriesMetric = {
      type: "time_series",
      metric: "latency",
      timestamps: stats.overall.responseTimes.map((stat, index) => index),
      values: stats.overall.responseTimes,
      unit: "ms",
    };

    const avgLatencyMetric: DataframeMetric = {
      type: "dataframe",
      metric: "latency",
      value: stats.p50,
      unit: "ms",
      specifier: "median",
    };

    return [timeSeriesMetric, avgLatencyMetric];
  },
  async runDuet({ options: { targets, ...rest }, metadata: {} }) {
    if (!targets) {
      throw new Error("Targets not provided for duet comparison");
    }

    const stats = await runLoadTest({
      targets,
      ...rest,
    });

    const timeSeriesMetric: TimeSeriesMetric = {
      type: "time_series",
      metric: "latency_diff",
      timestamps: stats.overall.responseTimes.map((stat, index) => index),
      values: stats.overall.responseTimes,
      unit: "%",
    };

    const avgLatencyMetric: DataframeMetric = {
      type: "dataframe",
      metric: "latency_diff",
      value: stats.p50,
      unit: "%",
      specifier: "median",
    };

    const oldLatencyTimeSeriesMetric: TimeSeriesMetric = {
      type: "time_series",
      metric: "latency",
      timestamps: stats.overall.duet?.oldSamples.map((stat, index) => index) ?? [],
      values: stats.overall.duet?.oldSamples ?? [],
      unit: "ms",
    };

    const newLatencyTimeSeriesMetric: TimeSeriesMetric = {
      type: "time_series",
      metric: "latency",
      timestamps: stats.overall.duet?.latestSamples.map((stat, index) => index) ?? [],
      values: stats.overall.duet?.latestSamples ?? [],
      unit: "ms",
    };

    return {
      metrics: [timeSeriesMetric, avgLatencyMetric],
      samples: [
        { old: oldLatencyTimeSeriesMetric, latest: newLatencyTimeSeriesMetric },
      ],
    };
  },
});

export type HttpAdapter = typeof httpAdapter;

import { z } from "zod";
import { Run } from "./config";

export type DataframeMetric = {
  type: "dataframe";
  metric: "latency" | "throughput" | "error_rate";
  value: number;
  unit: string | null;
  specifier: string | null;
};

export type TimeSeriesMetric = {
  type: "time_series";
};

export type Metric = DataframeMetric | TimeSeriesMetric;

export type BenchmarkMetadata = {
  ip?: string;
  runConfig?: Run;
};

export interface BenchmarkAdapter<T extends string, O extends z.ZodTypeAny> {
  tool: T;
  config: O;
  dependencies?: "go"[];
  setup: (options: {
    options: z.infer<O>;
    metadata: BenchmarkMetadata;
  }) => Promise<string[]> | string[];
  run: (options: {
    options: z.infer<O>;
    metadata: BenchmarkMetadata;
  }) => Promise<Metric[]>;
  teardown?: (options: {
    options: z.infer<O>;
    metadata: BenchmarkMetadata;
  }) => Promise<void>;
}

/**
 * Helper function for type inference
 */
export function createAdapter<T extends string, O extends z.ZodTypeAny>(
  adapter: BenchmarkAdapter<T, O>
) {
  return adapter;
}

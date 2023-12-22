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
};

export interface BenchmarkAdapter<
  T extends string,
  O extends Record<string, string | number | boolean | undefined>
> {
  tool: T;
  setup: (options: {
    options: Omit<O, "tool">;
    metadata: BenchmarkMetadata;
  }) => Promise<void>;
  run: (options: {
    options: Omit<O, "tool">;
    metadata: BenchmarkMetadata;
  }) => Promise<Metric[]>;
  teardown?: (options: {
    options: Omit<O, "tool">;
    metadata: BenchmarkMetadata;
  }) => Promise<void>;
}

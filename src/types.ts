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

export interface BenchmarkAdapter<
  T extends string,
  O extends Record<string, string | number | boolean | undefined>
> {
  tool: T;
  setup: (options: Omit<O, "tool">) => Promise<void>;
  run: (options: Omit<O, "tool">) => Promise<Metric[]>;
}

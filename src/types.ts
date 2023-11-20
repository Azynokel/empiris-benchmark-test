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

export interface BenchmarkAdapter<T extends string> {
  name: T;
  setup: () => Promise<void>;
  run: (args: string[]) => Promise<Metric[]>;
}

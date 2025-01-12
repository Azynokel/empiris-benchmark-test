import { z } from "zod";
import { API, Run } from "./config";

type DataframeBaseMetricType = "latency" | "throughput" | "error_rate" | "LCP" | "CLS" | "FID" | "FCP" | "TTFB";
type DataframeDiffMetricType = `${DataframeBaseMetricType}_diff`;
type DataframeMetricType = DataframeBaseMetricType | DataframeDiffMetricType | "wilcoxon_signed_rank_test";

export type DataframeMetric = {
  type: "dataframe";
  metric: DataframeMetricType;
  value: number;
  unit: string | null;
  specifier: string | null;
};

type TimeSeriesBaseMetricType = "latency" | "throughput" | "error_rate";
type TimeSeriesDiffMetricType = `${TimeSeriesBaseMetricType}_diff`;
type TimeSeriesMetricType = TimeSeriesBaseMetricType | TimeSeriesDiffMetricType;

export type TimeSeriesMetric = {
  type: "time_series";
  metric: TimeSeriesMetricType;
  timestamps: number[];
  values: number[];
  unit?: string;
};

export type Metric = DataframeMetric | TimeSeriesMetric;

export type BenchmarkMetadata = {
  ip?: string;
  runConfig?: Run;
  githubToken?: string;
  api?: API;
  experimentRunId?: number;
};

export type ExecResult =
  | {
      success: true;
      stdout: string;
    }
  | {
      success: false;
      stderr: string;
    };

export type ExecFn = (cmd: string) => Promise<ExecResult>;
export type WriteFileFn = (path: string, content: string) => Promise<boolean>;

export type BenchmarkDependency<T extends string> = {
  name: T;
  getInstallCMD: () => string;
  getCheckIfInstalledCMD: () => string;
};

export type DuetResult = {
  metrics: Metric[];
  samples: {
    old: TimeSeriesMetric;
    latest: TimeSeriesMetric;
  }[];
}

export interface BenchmarkAdapter<T extends string, O extends z.ZodTypeAny> {
  tool: T;
  config: O;
  dependsOn?: ("go" | "node" | "make" | "k6")[];

  setup: (options: {
    isLocal: boolean;
    exec: ExecFn;
    writeFile: WriteFileFn;
    options: z.infer<O>;
    metadata: BenchmarkMetadata;
  }) => Promise<
    | {
        success: true;
      }
    | {
        success: false;
        error: string;
      }
  >;

  run: (options: {
    isLocal: boolean;
    exec: ExecFn;
    writeFile: WriteFileFn;
    options: z.infer<O>;
    metadata: BenchmarkMetadata;
  }) => Promise<Metric[]>;

  runDuet?: (options: {
    isLocal: boolean;
    exec: ExecFn;
    writeFile: WriteFileFn;
    options: z.infer<O>;
    metadata: BenchmarkMetadata;
  }) => Promise<DuetResult>;

  teardown?: (options: {
    isLocal: boolean;
    exec: ExecFn;
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

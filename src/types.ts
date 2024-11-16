import { z } from "zod";
import { API, Run } from "./config";

export type DataframeMetric = {
  type: "dataframe";
  metric: "latency" | "throughput" | "error_rate";
  value: number;
  unit: string | null;
  specifier: string | null;
};

export type TimeSeriesMetric = {
  type: "time_series";
  metric: "latency" | "throughput" | "error_rate";
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

export type BenchmarkDependency<T extends string> = {
  name: T;
  getInstallCMD: () => string;
  getCheckIfInstalledCMD: () => string;
};

export interface BenchmarkAdapter<T extends string, O extends z.ZodTypeAny> {
  tool: T;
  config: O;
  dependsOn?: ("go" | "node" | "make")[];

  setup: (options: {
    isLocal: boolean;
    exec: ExecFn;
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
    options: z.infer<O>;
    metadata: BenchmarkMetadata;
  }) => Promise<Metric[]>;

  runDuet?: (options: {
    isLocal: boolean;
    exec: ExecFn;
    options: z.infer<O>;
    metadata: BenchmarkMetadata;
  }) => Promise<Metric[]>;

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

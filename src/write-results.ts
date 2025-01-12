import * as http from "@actions/http-client";
import * as core from "@actions/core";
import { DataframeMetric, TimeSeriesMetric, Metric } from "./types";

const client = new http.HttpClient();

export async function createExperimentRun({
  basePath,
  apiKey,
  serviceName,
  metadata: {
    appName,
    commit,
    name,
    description = "",
    isDuetExperiment = false,
  },
}: {
  basePath: string;
  apiKey: string;
  serviceName: string;
  metadata: {
    name: string;
    description?: string;
    appName: string;
    commit: string;
    isDuetExperiment?: boolean;
  };
}) {
  const response = await client.post(
    `${basePath}/api/experiment/run`,
    JSON.stringify({
      name,
      description,
      serviceName,
      generalData: [
        ["Application name", appName],
        ["Commit", commit],
      ],
      isDuetExperiment,
    }),
    {
      authorization: `Bearer ${apiKey}`,
    }
  );

  const body = await response.readBody();

  return JSON.parse(body).id as number;
}

export async function patchExperimentRunData({
  basePath,
  apiKey,
  experimentRunId,
  metadata,
}: {
  basePath: string;
  apiKey: string;
  experimentRunId: number;
  metadata: Record<string, string | boolean>;
}) {
  try {
    const response = await client.patch(
      `${basePath}/api/experiment/run`,
      JSON.stringify({
        id: experimentRunId,
        generalData: metadata,
      }),
      {
        authorization: `Bearer ${apiKey}`,
      }
    );

    if (response.message.statusCode !== 200) {
      core.warning(
        `Failed to update experiment run: ${await response.readBody()}`
      );
    }
  } catch (error) {
    core.warning(`Failed to update experiment run: ${error}`);
  }
}

type ExperimentRunResult = {
  metric: string;
  bootstrap_mean: number;
  bootstrap_ci_low: number;
  bootstrap_ci_high: number;
  wilcoxon_stat: number;
  wilcoxon_p: number;
  performance_change: boolean;
}

export async function addExperimentRunResult({
  basePath,
  apiKey,
  experimentRunId,
  runResult,
}: {
  basePath: string;
  apiKey: string;
  experimentRunId: number;
  runResult: ExperimentRunResult;
}) {
  const response = await client.patch(
    `${basePath}/api/experiment/run/result`,
    JSON.stringify({
      id: experimentRunId,
      runResult,
    }),
    {
      authorization: `Bearer ${apiKey}`,
    }
  );

  if (response.message.statusCode !== 200) {
    core.warning(
      `Failed to finish experiment run: ${await response.readBody()}`
    );
  }
}

export async function writeMetrics(
  metrics: Metric[],
  {
    basePath,
    experimentRunId,
    apiKey,
  }: { basePath: string; experimentRunId: number; apiKey: string }
) {
  const dataframes = metrics.filter(
    (metric): metric is DataframeMetric => metric.type === "dataframe"
  );

  const timeSeries = metrics.filter(
    (metric): metric is TimeSeriesMetric => metric.type === "time_series"
  );

  if (dataframes.length > 0) {
    await writeDataframeMetrics({
      basePath,
      dataframes,
      experimentRunId,
      apiKey,
    });
  }

  if (timeSeries.length > 0) {
    await writeTimeSeriesMetrics({
      basePath,
      timeSeries,
      experimentRunId,
      apiKey,
    });
  }
}

export async function writeDataframeMetrics({
  basePath,
  dataframes,
  experimentRunId,
  apiKey,
}: {
  experimentRunId: number;
  basePath: string;
  dataframes: DataframeMetric[];
  apiKey: string;
}) {
  const response = await client.post(
    `${basePath}/api/dataframe`,
    JSON.stringify({
      experimentRunId,
      data: dataframes.map(({ metric, specifier, unit, value }) => [
        metric,
        value,
        unit,
        specifier,
      ]),
    }),
    {
      authorization: `Bearer ${apiKey}`,
    }
  );

  if (response.message.statusCode !== 200) {
    core.warning(
      `Failed to write dataframe metrics: ${await response.readBody()}`
    );
  }
}

export async function writeTimeSeriesMetrics({
  basePath,
  timeSeries,
  experimentRunId,
  apiKey,
}: {
  experimentRunId: number;
  basePath: string;
  timeSeries: TimeSeriesMetric[];
  apiKey: string;
}) {
  for (const { metric, timestamps, values, unit } of timeSeries) {
    const response = await client.post(
      `${basePath}/api/timeseries`,
      JSON.stringify({
        experimentRunId,
        metric,
        timestamps,
        values,
        unit,
      }),
      {
        authorization: `Bearer ${apiKey}`,
      }
    );

    if (response.message.statusCode !== 200) {
      core.warning(
        `Failed to write time series metric ${metric}: ${await response.readBody()}`
      );
    }
  }
}

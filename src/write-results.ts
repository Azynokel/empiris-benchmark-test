import * as http from "@actions/http-client";
import * as core from "@actions/core";
import { DataframeMetric, TimeSeriesMetric, Metric } from "./types";

const client = new http.HttpClient();

export async function createExperimentRun({
  basePath,
  apiKey,
  metadata: { appName, commit, name, description = "" },
}: {
  basePath: string;
  apiKey: string;
  metadata: {
    name: string;
    description?: string;
    appName: string;
    commit: string;
  };
}) {
  const response = await client.post(
    `${basePath}/api/experiment/run`,
    JSON.stringify({
      name,
      description,
      generalData: [
        ["Application Name", appName],
        ["Commit", commit],
      ],
    }),
    {
      authorization: `Bearer ${apiKey}`,
    }
  );

  const body = await response.readBody();

  return JSON.parse(body).id as number;
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
  await client.post(
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
  for (const { metric, timestamps, values } of timeSeries) {
    const response = await client.post(
      `${basePath}/api/timeseries`,
      JSON.stringify({
        experimentRunId,
        metric,
        timestamps,
        values,
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

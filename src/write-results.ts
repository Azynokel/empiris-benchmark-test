import * as http from "@actions/http-client";
import * as core from "@actions/core";
import { DataframeMetric, TimeSeriesMetric, Metric } from "./types";

const client = new http.HttpClient();

// TODO
export async function createExperimentRun({
  basePath,
  apiKey,
}: {
  basePath: string;
  apiKey: string;
}) {
  const response = await client.post(
    `https://${basePath}/api/experiment/runs`,
    "",
    {
      authorization: `Bearer ${apiKey}`,
    }
  );

  const body = await response.readBody();

  return JSON.parse(body).id;
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
    core.warning("Time series metrics are not implemented yet");
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
    `https://${basePath}/api/dataframe`,
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

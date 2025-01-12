export async function getPreviousRunData(experimentRunId: number) {
  const response = await client.get(
    `${basePath}/api/experiments/${experimentRunId}`
  );

  const body = await response.readBody();

  return JSON.parse(body) as ExperimentRun;
}
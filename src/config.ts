import * as core from "@actions/core";
import * as z from "zod";

const defaultString = (str: string) =>
  z.string().transform((value) => {
    if (value === "") {
      return str;
    }
    return value;
  });

const configSchema = z.object({
  benchmark: z.enum(["inch"]),
  apiKey: z.string(),
  visualizationApiBaseUrl: defaultString("https://empiris.pages.dev"),
  influx_token: z.string(),
});

export function getConfig() {
  const parsedConfig = configSchema.safeParse({
    benchmark: core.getInput("benchmark"),
    apiKey: core.getInput("api_key"),
    visualizationApiBaseUrl: core.getInput("visualization_api_base_url"),
    influx_token: core.getInput("influx_token"),
  });

  if (!parsedConfig.success) {
    throw new Error(parsedConfig.error.message);
  }

  return parsedConfig.data;
}

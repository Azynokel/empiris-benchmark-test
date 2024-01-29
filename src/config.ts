import * as core from "@actions/core";
import * as z from "zod";
import { parse } from "yaml";
import { readFile } from "fs/promises";
import path from "path";
import Handlebars from "handlebars";
import { adapters } from "./adapters";

/**
 * Simple function to inject process.env variables into a string
 */
export function injectEnvVars(str: string) {
  const template = Handlebars.compile(str, { noEscape: true });
  return template({ $env: process.env });
}

/**
 * Recursively inject process.env variables into an object for every string
 */
export function injectEnvVarsRecursive<T extends Record<string, unknown>>(
  obj: T
): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = injectEnvVars(value);
    } else if (typeof value === "object" && value) {
      result[key] = injectEnvVarsRecursive(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

const runSchema = z
  .object({
    gcp: z.string(),
  })
  .optional();

export type Run = z.infer<typeof runSchema>;

const configSchema = z.object({
  benchmark: z.union([
    adapters[0].config.extend({
      tool: z.literal(adapters[0].tool),
    }),
    adapters[1].config.extend({
      tool: z.literal(adapters[1].tool),
    }),
    ...adapters
      .slice(2)
      .map((a) => a.config.extend({ tool: z.literal(a.tool) })),
  ]),
  run: runSchema,
  visualization: z.object({
    api_key: z.string().optional(),
    api_base_url: z.string().optional().default("empiris.pages.dev"),
  }),
});

export type Config = z.infer<typeof configSchema>;

export async function getConfig() {
  const configPath = core.getInput("config_path");
  const configFile = await readFile(
    path.join(process.cwd(), configPath === "" ? "empiris.yml" : configPath),
    "utf8"
  );

  const parsedConfig = configSchema.safeParse(parse(configFile));

  if (!parsedConfig.success) {
    throw new Error("Invalid config");
  }

  return injectEnvVarsRecursive(parsedConfig.data);
}

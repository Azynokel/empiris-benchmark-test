import * as core from "@actions/core";
import * as z from "zod";
import { parse } from "yaml";
import { readFile } from "fs/promises";
import path from "path";
import Handlebars from "handlebars";

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

const inchConfig = z.object({
  name: z.literal("inch"),
  influx_token: z.string(),
  version: z
    .union([z.literal(1), z.literal(2)])
    .optional()
    .default(2),
  database: z.string().optional().default("empiris"),
  host: z.string().min(1).optional().default("http://localhost:8086"),
});

export type InchConfig = z.infer<typeof inchConfig>;

const tsbsConfig = z.object({
  name: z.literal("tsbs"),
});

export type TSBSConfig = z.infer<typeof tsbsConfig>;

const configSchema = z.object({
  benchmark: z.union([inchConfig, tsbsConfig]),
  visualization: z.object({
    api_key: z.string().optional(),
    api_base_url: z.string().optional().default("empiris.pages.dev"),
  }),
});

export type Config = z.infer<typeof configSchema>;

export async function getConfig() {
  const configPath = core.getInput("config_file");
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

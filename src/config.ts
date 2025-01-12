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
    }
    // If array
    else if (Array.isArray(value)) {
      result[key] = value.map((v) => {
        return injectEnvVarsRecursive(v as Record<string, unknown>);
      });
    } else if (typeof value === "object" && value) {
      result[key] = injectEnvVarsRecursive(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

const platformSchema = z
  .object({
    on: z.literal("gcp-vm"),
    project: z.string(),
    region: z.string().optional().default("europe-west1"),
    // Config for GCP VM
    instance: z
      .object({
        machine_type: z.string().optional().default("e2-medium"),
        zone: z.string().optional().default("europe-west1-b"),
        // We support copying local files to the VM
        copy: z
          .array(
            z.object({
              local: z.string(),
              remote: z.string(),
            })
          )
          .optional()
          .default([]),
      })
      .optional()
      .default({ machine_type: "n1-standard-4", zone: "europe-west1-b" }),

    auth: z.object({
      service_account: z.string(),
      ssh: z.object({
        public_key: z.string(),
        private_key: z.string(),
      }),
    }),
  })
  .or(
    z.object({
      on: z.literal("local"),
    })
  )
  .or(
    z.object({
      on: z.literal("custom-terraform"),
      work_dir: z.string(),
      variables: z.record(z.string()).optional().default({}),
    })
  )
  .optional()
  .default({ on: "local" });

export type Run = z.infer<typeof platformSchema>;

const apiSchema = z.object({
  key: z.string().optional(),
  base_url: z.string().optional().default("https://empiris.dev"),
});

export type API = z.infer<typeof apiSchema>;

const configSchema = z.object({
  name: z.string(),
  application: z.string(),
  description: z.string().optional(),

  benchmark: z.union([
    adapters[0].config.extend({
      tool: z.literal(adapters[0].tool),
      duet: z.boolean().optional().default(false),
    }),
    adapters[1].config.extend({
      tool: z.literal(adapters[1].tool),
      duet: z.boolean().optional().default(false),
    }),
    ...adapters.slice(2).map((a) =>
      a.config.extend({
        tool: z.literal(a.tool),
        duet: z.boolean().optional().default(false),
      })
    ),
  ]),
  api: apiSchema.optional(),
  platform: platformSchema,
  github_token: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

export async function getConfig(config?: string): Promise<Config> {
  const configPath = config || core.getInput("config_path") || "";
  core.info(`Reading config from ${configPath}`);
  const configFile = await readFile(
    path.join(process.cwd(), configPath === "" ? "empiris.yml" : configPath),
    "utf8"
  );

  const parsedConfig = configSchema.safeParse(parse(configFile));

  if (!parsedConfig.success) {
    core.error(`Invalid config: ${JSON.stringify(parsedConfig.error, null, 2)}`);
    throw new Error(
      "Invalid config: " + JSON.stringify(parsedConfig.error, null, 2)
    );
  }

  return injectEnvVarsRecursive(parsedConfig.data);
}

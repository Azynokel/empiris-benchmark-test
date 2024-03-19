import * as core from "@actions/core";
import { createAdapter } from "../types";
import { z } from "zod";

export const artilleryAdapter = createAdapter({
  tool: "artillery",
  dependsOn: ["node"],
  config: z.object({
    configPath: z.string().optional().default("artillery.yaml"),
  }),
  setup: async ({ exec }) => {
    const result = await exec("npm install -g artillery@latest");

    if (!result.success) {
      return {
        success: false,
        error: "Failed to install artillery",
      };
    }

    return { success: true };
  },
  run: async ({ exec, options: { configPath } }) => {
    core.info(`Running Artillery with config ${configPath}`);

    const result = await exec(`artillery run ${configPath}`);

    if (!result.success) {
      return [];
    }

    // TODO: Parse the output of Artillery and return the metrics

    return [];
  },
});

export type ArtilleryAdapter = typeof artilleryAdapter;

import { TSBSConfig } from "../config";
import { BenchmarkAdapter } from "../types";

export type TSBSAdapter = BenchmarkAdapter<"tsbs", TSBSConfig>;

export const tsbsAdapter: TSBSAdapter = {
  name: "tsbs",
  setup: async () => {},
  run: async () => {
    return [];
  },
};

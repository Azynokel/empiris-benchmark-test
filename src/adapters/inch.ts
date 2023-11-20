import { exec } from "@actions/exec";
import { BenchmarkAdapter, Metric } from "../types";

function parseOutput(_out: string): Metric[] {
  // TODO: Turn out into metrics

  return [];
}

export const inchAdapter: BenchmarkAdapter<"inch"> = {
  name: "inch",
  setup: async () => {
    // Install inch
    await exec("go install github.com/influxdata/inch/cmd/inch@latest");
  },
  run: async (args: string[]) => {
    // Run inch
    let output = "";
    await exec("inch", args, {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString();
        },
      },
    });

    return parseOutput(output);
  },
};

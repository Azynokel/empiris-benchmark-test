import { exec } from "@actions/exec";
import { BenchmarkAdapter, Metric } from "../types";
import { InchConfig } from "../config";

function parseOutput(_out: string): Metric[] {
  // TODO: Turn out into metrics

  return [];
}

export type InchAdapter = BenchmarkAdapter<"inch", InchConfig>;

export const inchAdapter: InchAdapter = {
  name: "inch",
  setup: async () => {
    // Install inch locally
    await exec("go install github.com/influxdata/inch/cmd/inch@latest");
  },
  run: async ({ influx_token, version, database, host }) => {
    // Run inch
    let output = "";
    await exec(
      "inch",
      [
        "-token",
        influx_token,
        version === 2 ? "-v2" : "",
        "-v",
        "-db",
        database,
        "-host",
        host,
      ],
      {
        listeners: {
          stdout: (data: Buffer) => {
            output += data.toString();
          },
        },
      }
    );

    return parseOutput(output);
  },
};

import { exec } from "@actions/exec";
import { GoConfig } from "../config";
import { BenchmarkAdapter } from "../types";
import { randomizedInterleavedExecution } from "../utils";
// import { getSSHKeyPath } from "../infrastructure/setup-ssh";
// import { SSH_KEY_NAME, USER_NAME } from "../infrastructure/constants";

export type GoAdapter = BenchmarkAdapter<"go", GoConfig>;

async function getAllBenchmarks(workdir: string) {
  let out: string = "";

  const currentDir = process.cwd();

  // Change directory to workdir with code
  process.chdir(workdir);

  // Get all benchmarks from the go test command in the workdir
  await exec(`go test -list Benchmark*`, [], {
    ignoreReturnCode: true,
    listeners: {
      stdout: (data: Buffer) => {
        out += data.toString();
      },
    },
  });

  // All benchmarks are separated by a newline and start with Benchmark
  const benchmarksList = out
    .split("\n")
    .filter((benchmark) => benchmark.trim().startsWith("Benchmark"));

  // Change directory back to the original directory
  process.chdir(currentDir);

  return benchmarksList;
}

/**
 * This is the adapter for the integrated Go benchmarking tool.
 */
export const goAdapter: GoAdapter = {
  tool: "go",
  setup: async ({ metadata: { ip: _ip } }) => {
    // SSH into the instance and ignore known host check, execute a echo and exit immediately
    /* await exec(
      `ssh -o StrictHostKeyChecking=no -i ${
        getSSHKeyPath(SSH_KEY_NAME).privateKeyPath
      } ${USER_NAME}@${ip} -f 'ls -a && exit'`,
      [],
      {
        ignoreReturnCode: true,
        listeners: {
          stderr: (data: Buffer) => {
            console.log("ERROR", data.toString());
          },
          stdout: (data: Buffer) => {
            console.log("SUCCESS", data.toString());
          },
        },
      }
    ); */
  },

  run: async ({ options: { workdir }, metadata: { ip: _ip } }) => {
    // Get all benchmarks
    const benchmarks = await getAllBenchmarks(workdir);

    const currentDir = process.cwd();

    // Change directory to workdir with code
    process.chdir(workdir);

    await randomizedInterleavedExecution(
      benchmarks.map(
        (benchmark) => async () => {
          await exec(`go test -bench=${benchmark}`);
        },
        3
      )
    );

    // Change directory back to the original directory
    process.chdir(currentDir);

    return [];
  },
};

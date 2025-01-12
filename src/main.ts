import * as core from "@actions/core";
import { Config, getConfig } from "./config";
import { adapters, Adapter } from "./adapters";
import {
  createStartupScript,
  destroyComputeInstance,
  setupComputeInstance,
} from "./platform/gcp";
import { BenchmarkMetadata, DuetResult, Metric } from "./types";
import { stat, unlink, writeFile } from "fs/promises";

import { NodeSSH } from "node-ssh";
import { isExecSuccess, waitOn } from "./utils";
import { getExecOutput } from "@actions/exec";
import {
  addExperimentRunResult,
  createExperimentRun,
  patchExperimentRunData,
  writeMetrics,
} from "./write-results";
import { randomUUID } from "crypto";
import { SSH_USER_NAME } from "./platform/constants";
import { join } from "path";
import { bootrapping, wilcoxonTest } from "./analysis";

const ssh = new NodeSSH();

function getAdapter<T extends Config["benchmark"]["tool"]>(tool: T) {
  const adapter = adapters.find((adapter) => adapter.tool === tool);

  if (!adapter) {
    throw new Error(`Adapter ${tool} not found`);
  }

  return adapter as Adapter<T>;
}

async function localExec(cmd: string) {
  try {
    const { exitCode, stderr, stdout } = await getExecOutput(cmd, [], {
      silent: true,
      // Set output to nothing
      outStream: undefined,
    });

    if (isExecSuccess(exitCode)) {
      return {
        success: true,
        stdout: stdout,
      } as const;
    }

    return {
      success: false,
      stderr: stderr,
    } as const;
  } catch (e) {}

  return {
    success: false,
    stderr: "Failed to execute command",
  } as const;
}

type SSHConnectParams = {
  host: string;
  username: string;
  privateKey: string;
};

function wrapRemoteExec(
  ssh: NodeSSH,
  { host, username, privateKey }: SSHConnectParams
) {
  return async (cmd: string) => {
    await ssh.connect({
      host,
      username,
      privateKey,
    });
    const { code, stderr, stdout } = await ssh.execCommand(cmd);

    if (code !== null && isExecSuccess(code)) {
      return {
        success: true,
        stdout,
      } as const;
    }

    core.error(`Failed to execute command on remote host: ${stderr}`);

    return {
      success: false,
      stderr,
    } as const;
  };
}

async function copyFileToRemote(
  ssh: NodeSSH,
  {
    host,
    username,
    privateKey,
    localPath,
    remotePath,
  }: {
    host: string;
    username: string;
    privateKey: string;
    localPath: string;
    remotePath: string;
  }
) {
  await ssh.connect({
    host,
    username,
    privateKey,
  });

  const joinedLocalPath = join(process.cwd(), localPath);

  // Check if the local path is a directory or a file
  const stats = await stat(joinedLocalPath);
  core.info(
    `Copying ${joinedLocalPath} to ${remotePath} as ${
      stats.isDirectory() ? "directory" : "file"
    }`
  );

  if (stats.isDirectory()) {
    const success = await ssh.putDirectory(joinedLocalPath, remotePath);

    if (!success) {
      core.error(
        `Failed to copy directory ${joinedLocalPath} to ${remotePath}`
      );
    }
  } else if (stats.isFile()) {
    await ssh.putFile(joinedLocalPath, remotePath);
  }
}

async function writeFileLocal(path: string, content: string) {
  try {
    await writeFile(path, content);
    return true;
  } catch (e) {
    core.error("Failed to write file locally: " + e);
  }
  return false;
}

function wrapWriteFileRemote(ssh: NodeSSH, connectParams: SSHConnectParams) {
  return async (path: string, content: string) => {
    try {
      await ssh.connect(connectParams);
      const tmpPath = `/tmp/${path}`;

      await writeFile(tmpPath, content);

      await ssh.putFile(tmpPath, path);

      // Cleanup local file
      await unlink(tmpPath);

      return true;
    } catch (e) {
      core.error("Failed to write file to remote host: " + e);
    }
    return false;
  };
}

export async function main(config?: string) {
  const {
    name,
    description,
    application,
    benchmark: { tool, ...rest },
    platform,
    github_token,
    api,
    analysis,
  } = await getConfig(config);

  // Get the adapter
  const adapter = getAdapter(tool);

  const runId = randomUUID();

  let metadata: BenchmarkMetadata = {};

  /*
   * The platform exeuction is not particularly elegant yet and could be improved
   * but for now it's good enough since we only support GCP VMs. In the future
   * we might want to support other platforms like AWS Lambdas or distributed
   * VMs for e.g. distributed loadtesting.
   */
  if (platform.on === "gcp-vm") {
    try {
      // NOTE: Here it could make sense to search for all empiris prefixed resources and delete them

      metadata = await setupComputeInstance({
        project: platform.project,
        serviceAccount: platform.auth.service_account,
        sshKey: platform.auth.ssh.public_key,
        zone: platform.instance.zone,
        machineType: platform.instance.machine_type,
        region: platform.region,
        runId,
        startupScript: createStartupScript(adapter.dependsOn || []),
      });
    } catch (e) {
      console.error("Failed to setup compute instance", e);
    }
  }

  let experimentRunId: number | undefined = undefined;
  if (api?.key) {
    const { base_url, key } = api;
    experimentRunId = await createExperimentRun({
      apiKey: key,
      basePath: base_url,
      serviceName: application,
      metadata: {
        name,
        description,
        appName: application,
        commit: process.env.GITHUB_SHA || "unknown",
        isDuetExperiment:
          "duet" in rest && typeof rest.duet === "boolean" && rest.duet,
      },
    });
    core.info("Experiment run id: " + experimentRunId);
  }

  metadata = {
    ...metadata,
    runConfig: platform,
    githubToken: github_token,
    api,
    experimentRunId,
  };

  let metrics: Metric[] = [];
  let duetResult: DuetResult | undefined = undefined;

  // Setup the Benchmark Client
  try {
    if (metadata.ip && metadata.runConfig?.on === "gcp-vm") {
      const { ip, runConfig } = metadata;

      core.info(`Waiting for ${ip} to be ready...`);
      // Wait for ip to be ready
      await waitOn({
        ressources: [`http://${ip}`],
      });

      if (runConfig.instance.copy.length > 0) {
        core.info(`Copying files to ${ip}...`);
      }

      for (const path of runConfig.instance.copy) {
        await copyFileToRemote(ssh, {
          host: ip,
          username: SSH_USER_NAME,
          privateKey: runConfig.auth.ssh.private_key,
          localPath: path.local,
          remotePath: path.remote,
        });
      }

      const remoteExec = wrapRemoteExec(ssh, {
        host: ip,
        username: SSH_USER_NAME,
        privateKey: runConfig.auth.ssh.private_key,
      });

      const remoteWriteFile = wrapWriteFileRemote(ssh, {
        host: ip,
        username: SSH_USER_NAME,
        privateKey: runConfig.auth.ssh.private_key,
      });

      const result = await adapter.setup({
        isLocal: false,
        options: rest,
        metadata,
        exec: remoteExec,
        writeFile: remoteWriteFile,
      });

      if (!result.success) {
        throw new Error("Failed to setup benchmark client: " + result.error);
      }

      // Run the Benchmark
      // We assume here that the SUT is already running and available, we don't do the setup here
      if ("duet" in rest && typeof rest.duet === "boolean" && rest.duet) {
        if (adapter.runDuet) {
          duetResult = await adapter.runDuet({
            isLocal: false,
            options: rest,
            metadata,
            exec: remoteExec,
            writeFile: remoteWriteFile,
          });

          metrics = duetResult.metrics;
        } else {
          throw new Error(
            `Adapter ${adapter.tool} does not support duet benchmarking`
          );
        }
      } else {
        metrics = await adapter.run({
          isLocal: false,
          options: rest,
          metadata,
          exec: remoteExec,
          writeFile: remoteWriteFile,
        });
      }

      // Teardown the Benchmark Client
      await adapter.teardown?.({
        options: rest,
        metadata,
        exec: remoteExec,
        isLocal: false,
      });
    } else {
      const result = await adapter.setup({
        isLocal: true,
        options: rest,
        metadata,
        exec: localExec,
        writeFile: writeFileLocal,
      });

      if (!result.success) {
        throw new Error("Failed to setup benchmark client: " + result.error);
      }

      // Run the Benchmark
      // We assume here that the SUT is already running and available, we don't do the setup here
      if ("duet" in rest && typeof rest.duet === "boolean" && rest.duet) {
        if (adapter.runDuet) {
          duetResult = await adapter.runDuet({
            isLocal: true,
            options: rest,
            metadata,
            exec: localExec,
            writeFile: writeFileLocal,
          });

          metrics = duetResult.metrics;
        } else {
          throw new Error(
            `Adapter ${adapter.tool} does not support duet benchmarking`
          );
        }
      } else {
        metrics = await adapter.run({
          isLocal: true,
          options: rest,
          metadata,
          exec: localExec,
          writeFile: writeFileLocal,
        });
      }

      // Teardown the Benchmark Client
      await adapter.teardown?.({
        options: rest,
        metadata,
        exec: localExec,
        isLocal: true,
      });
    }
  } catch (e) {
    core.error("Failed to run benchmark: " + e);
  }

  if (platform.on === "gcp-vm") {
    try {
      await destroyComputeInstance({
        project: platform.project,
        serviceAccount: platform.auth.service_account,
        zone: platform.instance.zone,
        region: platform.region,
        runId,
        isCleanUp: false,
      });
    } catch (e) {
      console.error("Failed to destroy compute instance", e);
    }
  }

  const report = JSON.stringify(
    {
      metrics,
    },
    null,
    2
  );

  if (duetResult && analysis.enabled) {
    for (const sample of duetResult.samples) {
      const { old, latest } = sample;
      const { p, significant, stat } = await wilcoxonTest(old.values, latest.values);
      const { significant: bootrapSignificant, ci_lower, ci_mean, ci_upper } = await bootrapping(old.values, latest.values);

      metrics.push({
        type: "dataframe",
        metric: "wilcoxon_signed_rank_test",
        specifier: `p-value for ${old.metric}`,
        value: p,
        unit: null
      });

      if (api?.key && experimentRunId) {
        const { base_url, key } = api;

        await patchExperimentRunData({
          basePath: base_url,
          apiKey: key,
          experimentRunId,
          metadata: {
            "Performance Change": significant && bootrapSignificant
          },
        });

        await addExperimentRunResult({
          basePath: base_url,
          apiKey: key,
          experimentRunId,
          runResult: {
            bootstrap_ci_high: ci_upper,
            bootstrap_ci_low: ci_lower,
            bootstrap_mean: ci_mean,
            metric: old.metric,
            performance_change: significant && bootrapSignificant,
            wilcoxon_p: p,
            wilcoxon_stat: stat,
          },
        });
      }
    }
  }

  // Send the report to the server
  if (metrics.length === 0) {
    core.warning("No metrics were collected");
  } else {
    core.info("Writing report to report.json");

    // For local analysis
    await writeFile("report.json", report);

    if (api?.key && experimentRunId) {
      const { base_url, key } = api;

      core.info("Writing metrics to Empiris API..");

      // Write the results to the Empiris API
      await writeMetrics(metrics, {
        basePath: base_url,
        experimentRunId,
        apiKey: key,
      });

      core.info(
        `You can view the results at ${base_url}/experiments/${experimentRunId}`
      );
    } else {
      core.info("No API key provided, skipping writing results to api");
    }
  }
}

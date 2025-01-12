import chalk from "chalk";
import ora from "ora";
import { scheduler } from "timers/promises";
import { z } from "zod";
// If you're on Node <18, uncomment the following line after installing `node-fetch`:
// import fetch from 'node-fetch';

/** -------------------- TYPES -------------------- **/

/** -------------------- ZOD SCHEMAS -------------------- **/
// Define the shape of each part of the config using Zod

// A Phase is a time period with a certain arrivalRate & concurrency limit
const phaseSchema = z.object({
  duration: z.number().positive().describe("Phase duration in seconds"),
  arrival_rate: z.number().positive().describe("Scenarios per second"),
  concurrency: z.number().positive().optional().describe("Max concurrency"),
});

// A RequestDefinition describes a single HTTP step in a scenario
const requestDefinitionSchema = z.object({
  name: z.string().optional(),
  method: z.string().default("GET"),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  body: z.any().optional(),
  thinkTime: z.number().nonnegative().optional(),
});

// A Scenario is a named collection of request definitions
const scenarioSchema = z.object({
  name: z.string(),
  requests: z.array(requestDefinitionSchema).min(1),
});

const targetSchema = z.object({
  url: z.string(),
  default_headers: z.record(z.string()).optional(),
  default_query_params: z.record(z.string().or(z.number())).optional(),
});

// Global config that applies to all requests
const globalConfigSchema = z.object({
  target: targetSchema.optional(),
  targets: z
    .object({
      old: targetSchema,
      latest: targetSchema,
    })
    .optional(),
  timeout: z.number().positive().optional(),
});

// The top-level config object
export const testConfigSchema = globalConfigSchema.merge(
  z.object({
    phases: z.array(phaseSchema).min(1),
    scenarios: z.array(scenarioSchema).min(1),
  })
);

// Infer the TypeScript types from the Zod schemas
type Phase = z.infer<typeof phaseSchema>;
type Scenario = z.infer<typeof scenarioSchema>;
type GlobalConfig = z.infer<typeof globalConfigSchema>;
type TestConfig = z.infer<typeof testConfigSchema>;

/** -------------------- HELPER FUNCTIONS -------------------- **/

interface RequestStats {
  count: number; // total requests attempted
  failed: number; // total requests failed
  responseTimes: number[]; // store durations to compute percentiles
  duet?: {
    oldSamples: number[];
    latestSamples: number[];
  };
}

interface LoadTestStats {
  overall: RequestStats;
  perRequest: {
    [requestName: string]: RequestStats;
  };
}

function sleep(ms: number) {
  return scheduler.wait(ms);
}

function getPercentile(sortedValues: number[], percentile: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

/**
 * Print a summary of stats to the console, including
 * percentiles (p50, p90, p95, p99) and success rate.
 */
function calcStats(stats: LoadTestStats) {
  const { overall, perRequest } = stats;
  const sortedTimes = [...overall.responseTimes].sort((a, b) => a - b);

  const p50 = getPercentile(sortedTimes, 50);
  const p90 = getPercentile(sortedTimes, 90);
  const p95 = getPercentile(sortedTimes, 95);
  const p99 = getPercentile(sortedTimes, 99);

  const successCount = overall.count - overall.failed;
  const successRate = ((successCount / overall.count) * 100).toFixed(2);
  const average =
    sortedTimes.reduce((acc, t) => acc + t, 0) / (sortedTimes.length || 1);

  const unit = stats.overall.duet ? "%" : "ms";

  console.log(chalk.bold("\n=== Load Test Results ==="));
  console.log(`Total Requests:    ${overall.count}`);
  console.log(`Completed:         ${successCount}`);
  console.log(`Failed:            ${overall.failed}`);
  console.log(`Success Rate:      ${successRate}%`);
  console.log(`Average (${unit}):      ${average.toFixed(2)}`);
  console.log(`p50 (${unit}):          ${p50.toFixed(2)}`);
  console.log(`p90 (${unit}):          ${p90.toFixed(2)}`);
  console.log(`p95 (${unit}):          ${p95.toFixed(2)}`);
  console.log(`p99 (${unit}):          ${p99.toFixed(2)}`);

  return {
    totalRequests: overall.count,
    completed: successCount,
    failed: overall.failed,
    successRate: parseFloat(successRate),
    average: parseFloat(average.toFixed(2)),
    p50: parseFloat(p50.toFixed(2)),
    p90: parseFloat(p90.toFixed(2)),
    p95: parseFloat(p95.toFixed(2)),
    p99: parseFloat(p99.toFixed(2)),
    overall,
    perRequest,
  };
}

/** -------------------- CORE LOGIC -------------------- **/

/**
 * Execute each request in the scenario sequentially.
 * Gathers stats for each request and scenario.
 */
async function runScenario(
  scenario: Scenario,
  stats: LoadTestStats,
  globalConfig: GlobalConfig
) {
  if (!globalConfig.target) {
    throw new Error("Target is required for single target scenario");
  }

  for (const reqDef of scenario.requests) {
    const startTime = performance.now();

    // The target is set here
    const fullUrl = (globalConfig.target.url.replace(/\/+$/, "") +
      reqDef.url) as string;

    // Merge headers: (global defaultHeaders + requestDefinition headers)
    const headers = {
      ...(globalConfig.target.default_headers || {}),
      ...(reqDef.headers || {}),
    };

    const requestName = reqDef.name || reqDef.url;

    // Initialize stats counters
    stats.overall.count += 1;
    if (!stats.perRequest[requestName]) {
      stats.perRequest[requestName] = {
        count: 0,
        failed: 0,
        responseTimes: [],
      };
    }
    stats.perRequest[requestName].count += 1;

    // Attempt the request
    try {
      const controller = new AbortController();
      const timeout = globalConfig?.timeout ?? 0;
      let timeoutId: NodeJS.Timeout | undefined;

      if (timeout > 0) {
        timeoutId = setTimeout(() => controller.abort(), timeout);
      }

      const response = await fetch(fullUrl, {
        method: reqDef.method ?? "GET",
        headers,
        body: reqDef.body,
        signal: controller.signal,
      });

      // We could also do something with the `response` (like check status).
      // For now, we just measure how long it took.
      const duration = performance.now() - startTime;
      stats.overall.responseTimes.push(duration);
      stats.perRequest[requestName].responseTimes.push(duration);

      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        // If you consider 4xx/5xx as failures:
        stats.overall.failed += 1;
        stats.perRequest[requestName].failed += 1;
      }
    } catch (error) {
      // request failed or timed out
      stats.overall.failed += 1;
      stats.perRequest[requestName].failed += 1;
    }

    // If there's a thinkTime, wait
    if (reqDef.thinkTime && reqDef.thinkTime > 0) {
      await sleep(reqDef.thinkTime);
    }
  }
}

async function runScenarioDuet(
  scenario: Scenario,
  stats: LoadTestStats,
  globalConfig: GlobalConfig
) {
  if (!globalConfig.targets) {
    throw new Error("Targets are required for duet comparison");
  }

  for (const reqDef of scenario.requests) {
    const startTime = performance.now();

    // The target is set here
    const fullUrls = {
      old: (globalConfig.targets?.old.url.replace(/\/+$/, "") +
        reqDef.url) as string,
      latest: (globalConfig.targets?.latest.url.replace(/\/+$/, "") +
        reqDef.url) as string,
    } as const;

    const requestName = reqDef.name || reqDef.url;

    // Initialize stats counters
    stats.overall.count += 1;
    if (!stats.perRequest[requestName]) {
      stats.perRequest[requestName] = {
        count: 0,
        failed: 0,
        responseTimes: [],
        duet: {
          oldSamples: [],
          latestSamples: [],
        },
      };
    }
    stats.perRequest[requestName].count += 1;

    // Attempt the request
    try {
      const controllers = {
        old: new AbortController(),
        latest: new AbortController(),
      } as const;
      const timeout = globalConfig?.timeout ?? 0;
      let timeoutId: NodeJS.Timeout | undefined;

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          controllers.old.abort();
          controllers.latest.abort();
        });
      }

      const responses = await Promise.all(
        Object.entries(fullUrls).map(async ([key, url]) => {
          // Merge headers: (global defaultHeaders + requestDefinition headers)
          const headers = {
            ...(globalConfig.targets?.[key as "old" | "latest"]
              .default_headers || {}),
            ...(reqDef.headers || {}),
          };

          const query = new URLSearchParams();
          Object.entries(
            globalConfig.targets?.[key as "old" | "latest"]
              .default_query_params || {}
          ).forEach(([key, value]) => {
            query.append(key, value.toString());
          });

          const response = await fetch(url + "?" + query.toString(), {
            method: reqDef.method ?? "GET",
            headers,
            body: reqDef.body,
            signal: controllers[key as "old" | "latest"].signal,
          });
          return [response, performance.now() - startTime] as const;
        })
      );

      // We could also do something with the `response` (like check status).
      // For now, we just measure how long it took.

      if (responses.some(([response]) => !response.ok)) {
        // If you consider 4xx/5xx as failures:
        stats.overall.failed += 1;
        stats.perRequest[requestName].failed += 1;
      } else {
        const oldDuration = responses[0][1];
        const latestDuration = responses[1][1];

        const durationChange = latestDuration / oldDuration * 100 - 100;

        stats.overall.responseTimes.push(durationChange);
        stats.overall.duet?.latestSamples.push(latestDuration);
        stats.overall.duet?.oldSamples.push(oldDuration);
        stats.perRequest[requestName].responseTimes.push(durationChange);
        stats.perRequest[requestName].duet?.oldSamples.push(oldDuration);
        stats.perRequest[requestName].duet?.latestSamples.push(latestDuration);
      }

      if (timeoutId) clearTimeout(timeoutId);
    } catch (error) {
      // request failed or timed out
      stats.overall.failed += 1;
      stats.perRequest[requestName].failed += 1;
    }

    // If there's a thinkTime, wait
    if (reqDef.thinkTime && reqDef.thinkTime > 0) {
      await sleep(reqDef.thinkTime);
    }
  }
}

/**
 * Runs a single phase:
 *   - We have a "duration" (seconds) and an "arrivalRate" (scenarios per second).
 *   - We can optionally limit concurrency if `concurrency` is given.
 *   - Each "arrival" randomly picks one scenario from the config.
 */
async function runPhase(
  phase: Phase,
  scenarios: Scenario[],
  stats: LoadTestStats,
  globalConfig: GlobalConfig
): Promise<void> {
  const { duration, arrival_rate: arrivalRate, concurrency } = phase;
  const startTime = Date.now();
  const endTime = startTime + duration * 1000;

  let activeCount = 0;
  let lastArrival = Date.now();

  // Keep launching new scenarios until we pass the phase duration
  while (Date.now() < endTime) {
    // Respect concurrency if set
    if (concurrency && activeCount >= concurrency) {
      await sleep(10);
      continue;
    }

    // Check if it’s time to launch a new scenario (based on arrivalRate)
    const now = Date.now();
    const msSinceLastArrival = now - lastArrival;
    const idealInterval = 1000 / arrivalRate; // ms between new arrivals

    if (msSinceLastArrival < idealInterval) {
      await sleep(idealInterval - msSinceLastArrival);
      continue;
    }

    // Launch a scenario
    lastArrival = now;
    activeCount++;
    const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];

    if (globalConfig.target) {
      runScenario(scenario, stats, globalConfig).finally(() => {
        activeCount--;
      });
    } else {
      if (!stats.overall.duet) {
        stats.overall.duet = {
          oldSamples: [],
          latestSamples: [],
        };
      }
      runScenarioDuet(scenario, stats, globalConfig).finally(() => {
        activeCount--;
      });
    }

    // Wait for all in-flight requests to finish
    while (activeCount > 0) {
      await sleep(20);
    }
  }
}

/**
 * Main load test function:
 *   - Initializes stats
 *   - Iterates through phases
 *   - Gathers & prints stats
 */
export async function runLoadTest(config: TestConfig) {
  const stats: LoadTestStats = {
    overall: { count: 0, failed: 0, responseTimes: [] },
    perRequest: {},
  };

  const spinner = ora("Starting load test...").start();

  const { phases, scenarios, ...globalConfig } = config;
  let phaseIndex = 0;

  for (const phase of phases) {
    phaseIndex++;
    spinner.text = chalk.blueBright(
      `Running phase #${phaseIndex}: ${phase.duration}s @ ${phase.arrival_rate} RPS`
    );
    await runPhase(phase, scenarios, stats, globalConfig);
  }

  spinner.succeed("Load test completed!");
  return calcStats(stats);
}

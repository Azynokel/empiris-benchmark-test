import * as http from "@actions/http-client";

const client = new http.HttpClient();

type WaitOnOptions = {
  ressources: string[];
  timeout?: number;
  // Delay between each check
  delay?: number;
};

function isReachable(response: http.HttpClientResponse) {
  if (!response.message.statusCode) {
    return false;
  }

  return (response.message.statusCode >= 200 && response.message.statusCode < 300) || response.message.statusCode === 404;
}

// Default timeout is 2 minutes
const DEFAULT_TIMEOUT = 2 * 60 * 1000;

export async function waitOn({
  ressources,
  timeout = DEFAULT_TIMEOUT,
  delay = 5000,
}: WaitOnOptions) {
  const start = Date.now();
  const end = start + timeout;

  while (Date.now() < end) {
    const promises = ressources.map((url) => client.get(url));
    try {
      const responses = await Promise.all(promises);
      const allReachable = responses.every((response) => isReachable(response));

      if (allReachable) {
        return;
      }
    } catch (_e) {}

    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw new Error(`Timeout after ${timeout}ms`);
}

export async function randomizedInterleavedExecution(
  fns: (() => Promise<void>)[],
  iterations: number
) {
  for (let i = 0; i < iterations; i++) {
    // Randomly shuffle the array
    const shuffled = fns.sort(() => Math.random() - 0.5);

    // Execute all functions
    for (const fn of shuffled) {
      await fn();
    }
  }
}

/**
 * Utilty to turn a human readable time into milliseconds
 */
export function toMs(time: string) {
  const parts = time.split(" ");

  return parts.reduce((acc, part) => {
    if (part.endsWith("ms")) {
      return acc + parseInt(part);
    }

    if (part.endsWith("s")) {
      return acc + parseInt(part) * 1000;
    }

    if (part.endsWith("m")) {
      return acc + parseInt(part) * 1000 * 60;
    }

    if (part.endsWith("h")) {
      return acc + parseInt(part) * 1000 * 60 * 60;
    }

    return acc;
  }, 0);
}

export function isExecSuccess(code?: number) {
  return code === 0;
}

export function getMedian(values: number[]) {
  const sorted = values.sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}
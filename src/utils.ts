import * as http from "@actions/http-client";

const client = new http.HttpClient();

type WaitOnOptions = {
  ressources: string[];
  timeout?: number;
  // Delay between each check
  delay?: number;
};

function isStatusOk(response: http.HttpClientResponse) {
  return response.message.statusCode === 200;
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
      const allOk = responses.every((response) => isStatusOk(response));

      if (allOk) {
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

export function isExecSuccess(code: number) {
  return code === 0;
}

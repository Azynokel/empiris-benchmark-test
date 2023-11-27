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

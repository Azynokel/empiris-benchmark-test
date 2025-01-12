import * as core from "@actions/core";
import { DataframeMetric, Metric, createAdapter } from "../types";
import { z } from "zod";
import puppeteer, { Page } from "puppeteer";
import { getMedian, waitOn } from "../utils";
import { scheduler } from "timers/promises";
import { MANAGED_CHROME_API_URL } from "../constants";

const fixedNetworkConditions = {
  offline: false,
  downloadThroughput: (1.5 * 1024 * 1024) / 8, // 1.5Mbps
  uploadThroughput: (750 * 1024) / 8, // 750Kbps
  latency: 40, // 40ms
};

function calcWebVitals() {
  // @ts-ignore
  window.firstContentfulPaint = 0;
  // @ts-ignore
  window.largestContentfulPaint = 0;
  // @ts-ignore
  window.cumulativeLayoutShift = 0;
  // @ts-ignore
  window.firstInputDelay = 0;

  const observer = new PerformanceObserver((entryList) => {
    const entries = entryList.getEntries();

    for (const entry of entries) {
      if (entry.name === "first-contentful-paint") {
        // @ts-ignore
        window.firstContentfulPaint = entry.startTime;
      } else if (entry.entryType === "largest-contentful-paint") {
        // @ts-ignore
        window.largestContentfulPaint = entry.startTime;
      } else if (entry.entryType === "layout-shift") {
        // @ts-ignore
        if (!entry.hadRecentInput) {
          // @ts-ignore
          window.cumulativeLayoutShift += entry.value;
        }
      } else if (entry.entryType === "first-input") {
        // @ts-ignore
        window.firstInputDelay = entry.processingStart - entry.startTime;
      }
    }
  });

  observer.observe({ type: "largest-contentful-paint", buffered: true });
  observer.observe({ type: "layout-shift", buffered: true });
  observer.observe({ type: "first-input", buffered: true });
  observer.observe({ type: "paint", buffered: true });
}

// TODO
function calcMemoryLeaks() {
  throw new Error("Not implemented");
}

async function preparePage(page: Page) {
  // Fix conditions to ensure fair benchmarking
  const client = await page.createCDPSession();
  await client.send("Network.enable");
  await client.send("ServiceWorker.enable");
  await client.send("Network.emulateNetworkConditions", fixedNetworkConditions);
  // 1 is no throttling
  await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  await page.evaluateOnNewDocument(calcWebVitals);
}

function isPageLoaded(page: Page) {
  return page.evaluate(() => {
    // @ts-ignore
    return window.largestContentfulPaint !== 0 && window.firstContentfulPaint !== 0;
  });
}

async function collectWebVitals(page: Page, iterations: number, goTo: string) {
  const values: { metric: string; value: number }[] = [];

  for (let i = 0; i < iterations; i++) {
    await page.goto(goTo, {
      waitUntil: "load",
      timeout: 10000,
    });

    // We wait until LCP & FCP are available
    while (!(await isPageLoaded(page))) {
      scheduler.wait(1000);
    }

    // Collect metrics
    const webVitals = await page.evaluate(() => {
      return {
        // @ts-ignore
        lcp: window.largestContentfulPaint,
        // @ts-ignore
        cls: window.cumulativeLayoutShift,
        // @ts-ignore
        fid: window.firstInputDelay,
        // @ts-ignore
        fcp: window.firstContentfulPaint,
      };
    });

    const timeToFirstByte = await page.evaluate(() => {
      return performance.timing.responseStart - performance.timing.requestStart;
    });

    values.push(
      {
        metric: "LCP",
        value: webVitals.lcp,
      },
      {
        metric: "CLS",
        value: webVitals.cls,
      },
      {
        metric: "FID",
        value: webVitals.fid,
      },
      {
        metric: "FCP",
        value: webVitals.fcp,
      },
      {
        metric: "TTFB",
        value: timeToFirstByte,
      }
    );
  }

  // Median calculation
  const webVitals = {
    lcp: getMedian(
      values.filter((v) => v.metric === "LCP").map((v) => v.value)
    ),
    cls: getMedian(
      values.filter((v) => v.metric === "CLS").map((v) => v.value)
    ),
    fid: getMedian(
      values.filter((v) => v.metric === "FID").map((v) => v.value)
    ),
    fcp: getMedian(
      values.filter((v) => v.metric === "FCP").map((v) => v.value)
    ),
    ttbf: getMedian(
      values.filter((v) => v.metric === "TTFB").map((v) => v.value)
    ),
  };

  const metrics: DataframeMetric[] = [];

  if (webVitals.lcp > 0) {
    metrics.push({
      type: "dataframe",
      metric: "LCP",
      specifier: "Largest Contentful Paint",
      // Round to 2 decimal places
      value: Math.round(webVitals.lcp * 100) / 100,
      unit: "ms",
    });
  }

  if (webVitals.cls > 0) {
    metrics.push({
      type: "dataframe",
      metric: "CLS",
      specifier: "Cumulative Layout Shift",
      value: Math.round(webVitals.cls * 100) / 100,
      unit: "",
    });
  }

  if (webVitals.fid > 0) {
    metrics.push({
      type: "dataframe",
      metric: "FID",
      specifier: "First Input Delay",
      value: Math.round(webVitals.fid * 100) / 100,
      unit: "ms",
    });
  }

  if (webVitals.fcp > 0) {
    metrics.push({
      type: "dataframe",
      metric: "FCP",
      specifier: "First Contentful Paint",
      value: Math.round(webVitals.fcp * 100) / 100,
      unit: "ms",
    });
  }

  if (webVitals.ttbf > 0) {
    metrics.push({
      type: "dataframe",
      metric: "TTFB",
      specifier: "Time to First Byte",
      value: Math.round(webVitals.ttbf * 100) / 100,
      unit: "ms",
    });
  }

  return metrics;
}

async function getMetricsFromManagedChrome(host1: string, host2: string) {
  try {
    core.debug(`Fetching metrics from Empiris-managed Chrome for hosts ${host1} and ${host2}`);
    const response = await fetch(`${MANAGED_CHROME_API_URL}?url1=${host1}&url2=${host2}`, {
      method: "GET",
      headers: {
        Authorization: process.env.MANAGED_CHROME_API_KEY || "0f492474c8215950473eb0e58dd5a55e9d089103cf48aff971193923ce047eea070a448fc48c758af36c7384779f64a977fe80399250f57d11b27afe078c7d78",
      },
    });
    core.debug(`Response status: ${response.status}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch metrics: ${response.statusText}`);
    }

    const data = await response.json() as {
      metrics: DataframeMetric[];
    }

    return data.metrics;
  } catch (e) {
    console.error(e);
    return [] as DataframeMetric[];
  }
}

async function runPuppeteerBenchmark({
  host,
  iterations,
  chrome_mode: chromeMode,
}: {
  host: string;
  iterations: number;
  chrome_mode: "local" | "empiris-managed";
}): Promise<Metric[]> {
  // Wait for dependencies to be ready
  await waitOn({
    ressources: [host],
    timeout: 5 * 60 * 1000, // Wait for 5 minutes
  });

  core.info(`Running Puppeteer benchmark against host ${host}`);

  if (chromeMode === "empiris-managed") {
    throw new Error("Empiris-managed Chrome is not yet supported");
  }

  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await preparePage(page);

  const metrics = await collectWebVitals(page, iterations, host);

  await browser.close();

  // Return the metrics as DataframeMetrics
  return metrics;
}

async function runPuppeteerBenchmarkDuet({
  hosts,
  iterations,
  chrome_mode
}: {
  hosts: string[];
  iterations: number;
  chrome_mode: "local" | "empiris-managed";
}): Promise<DataframeMetric[]> {
  if (hosts.length !== 2) {
    throw new Error("Duet mode requires exactly two hosts");
  }

  if (chrome_mode === "empiris-managed") {
    core.info(
      `Running Puppeteer benchmark in duet mode against hosts ${hosts.join(", ")} using empiris-managed Chrome`
    );
    return await getMetricsFromManagedChrome(hosts[0], hosts[1]);
  }

  core.info(
    `Running Puppeteer benchmark in duet mode against hosts ${hosts.join(", ")}`
  );

  await waitOn({
    ressources: hosts,
    timeout: 5 * 60 * 1000, // Wait for 5 minutes
  });

  const browser = await puppeteer.launch();
  const context1 = await browser.createBrowserContext();
  const context2 = await browser.createBrowserContext();
  const pages = await Promise.all([context1.newPage(), context2.newPage()]);

  await Promise.all(pages.map((page) => preparePage(page)));

  const metrics = await Promise.all(
    pages.map((page, i) => collectWebVitals(page, iterations, hosts[i]))
  );

  await browser.close();

  // Merge metrics
  const diffedMetrics: DataframeMetric[] = [];

  for (let i = 0; i < metrics[0].length; i++) {
    const metric1 = metrics[0][i];
    // Find the corresponding metric in the second set
    const metric2 = metrics[1].find((m) => m.metric === metric1.metric);

    if (!metric2) {
      continue;
    }

    // Calculate the difference
    const diff = (metric2.value / metric1.value) * 100 - 100;

    diffedMetrics.push({
      type: "dataframe",
      metric: `${metric1.metric}`,
      specifier: `Difference Median ${metric1.specifier}`,
      value: Math.round(diff * 100) / 100,
      unit: metric1.unit,
    });
  }

  return diffedMetrics;
}

/**
 * This is the adapter for the Puppeteer-based frontend benchmark.
 */
export const puppeteerAdapter = createAdapter({
  tool: "puppeteer",
  dependsOn: ["node"],
  config: z.object({
    host: z.string().optional(),
    hosts: z.array(z.object({ url: z.string() })).optional(),
    iterations: z.number().optional().default(1),
    chrome_mode: z
      .enum(["local", "empiris-managed"])
      .default("empiris-managed"),
  }),
  setup: async () => {
    // No setup needed for Puppeteer
    return { success: true };
  },
  run: async ({ options }) => {
    if (!options.host) {
      throw new Error("Host is required");
    }

    return await runPuppeteerBenchmark({
      host: options.host as string,
      iterations: options.iterations,
      chrome_mode: options.chrome_mode,
    });
  },
  async runDuet({ options }) {
    if (!options.hosts) {
      throw new Error("Hosts are required for duet mode");
    }

    const m = await runPuppeteerBenchmarkDuet({
      hosts: options.hosts.map((h) => h.url),
      iterations: options.iterations,
      chrome_mode: options.chrome_mode,
    });

    return {
      metrics: m,
      samples: []
    }
  },
});

export type PuppeteerAdapter = typeof puppeteerAdapter;

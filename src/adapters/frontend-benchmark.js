import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import fs from 'fs';

// Load the environment variables from the .env file
dotenv.config();

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  // Fetch URL and button selector from the environment variables
  const url = process.env.APP_URL || 'http://localhost:4200';  // Default if not defined in .env
  const buttonSelector = process.env.BUTTON_SELECTOR || 'button';  // Default if not defined in .env

  console.log(`Starting benchmark for ${url}...`);

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('body');
  
  // Wait for the button to be available
  await page.waitForSelector(buttonSelector, { visible: true, timeout: 10000 });

  const button = await page.$(buttonSelector);
  if (button) {
    await button.click();
    console.log(`Button clicked on ${url}`);
  } else {
    console.error(`Button with selector ${buttonSelector} not found or not clickable.`);
  }

  // Collect metrics
  const metrics = await page.evaluate(() => {
    return new Promise((resolve) => {
      const result = {
        LCP: { value: 'N/A', unit: 'ms' },
        CLS: { value: 'N/A', unit: '' },
        FID: { value: 'N/A', unit: 'ms' },
        TTFB: { value: 'N/A', unit: 'ms' },
        DOMContentLoaded: { value: 'N/A', unit: 'ms' },
        LoadEvent: { value: 'N/A', unit: 'ms' }
      };

      const performanceObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        entries.forEach(entry => {
          if (entry.entryType === 'largest-contentful-paint' && entry.startTime > 0) {
            result.LCP.value = entry.startTime;
          }
          if (entry.entryType === 'layout-shift' && entry.value > 0) {
            result.CLS.value = entry.value;
          }
          if (entry.entryType === 'first-input' && entry.startTime > 0) {
            result.FID.value = entry.startTime;
          }
        });
        resolve(result);
      });

      performanceObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      performanceObserver.observe({ type: 'layout-shift', buffered: true });
      performanceObserver.observe({ type: 'first-input', buffered: true });

      const timing = performance.timing || {};
      result.TTFB.value = timing.responseStart && timing.requestStart ? timing.responseStart - timing.requestStart : 'N/A';
      result.DOMContentLoaded.value = timing.domContentLoadedEventEnd && timing.navigationStart ? timing.domContentLoadedEventEnd - timing.navigationStart : 'N/A';
      result.LoadEvent.value = timing.loadEventEnd && timing.navigationStart ? timing.loadEventEnd - timing.navigationStart : 'N/A';
    });
  });

  // Output metrics to console
  console.log('Core Web Vitals Metrics:');
  console.log(`Largest Contentful Paint (LCP): ${metrics.LCP.value !== 'N/A' ? metrics.LCP.value + ' ' + metrics.LCP.unit : 'N/A'}`);
  console.log(`Cumulative Layout Shift (CLS): ${metrics.CLS.value !== 'N/A' ? metrics.CLS.value + ' ' + metrics.CLS.unit : 'N/A'}`);
  console.log(`First Input Delay (FID): ${metrics.FID.value !== 'N/A' ? metrics.FID.value + ' ' + metrics.FID.unit : 'N/A'}`);
  
  console.log('Additional Metrics:');
  console.log(`Time to First Byte (TTFB): ${metrics.TTFB.value !== 'N/A' ? metrics.TTFB.value + ' ' + metrics.TTFB.unit : 'N/A'}`);
  console.log(`DOM Content Loaded: ${metrics.DOMContentLoaded.value !== 'N/A' ? metrics.DOMContentLoaded.value + ' ' + metrics.DOMContentLoaded.unit : 'N/A'}`);
  console.log(`Load Event: ${metrics.LoadEvent.value !== 'N/A' ? metrics.LoadEvent.value + ' ' + metrics.LoadEvent.unit : 'N/A'}`);

  // Save metrics to a JSON file
  const timestamp = new Date().toISOString().replace(/:/g, '-'); // Replace colons with hyphens for a valid filename
  const fileName = `benchmark-results-${timestamp}.json`;
  fs.writeFileSync(fileName, JSON.stringify(metrics, null, 2));

  console.log(`Results saved to ${fileName}`);

  await browser.close();
})();

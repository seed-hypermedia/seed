import {Page} from "@playwright/test";
import * as path from "path";
import {PerformanceScenario} from "./perf-utils";
import {
  analyzeTrace,
  collectTrace,
  generateTraceReport,
  saveTraceToFile,
} from "./trace-collector";

/**
 * Collection of performance test scenarios
 */

// App startup scenario - just launches the app and measures startup metrics
export const appStartupScenario: PerformanceScenario = {
  name: "app-startup",
  description: "Measures basic app startup performance",
  setup: async (page: Page) => {
    // Wait for the app to be fully loaded
    await page.waitForLoadState("networkidle");
  },
};

// Main dashboard loading scenario
export const libraryScenario: PerformanceScenario = {
  name: "library-view",
  description: "Measures performance of the library view",
  setup: async (page: Page) => {
    // Wait for the app to be fully loaded
    await page.waitForLoadState("networkidle");

    // Navigate to the dashboard (modify the selector as needed)
    // Example: await page.click('a[href="/dashboard"]');

    // Wait for dashboard to load
    // await page.click("#welcome-next");
    // await page.click("#profile-skip");
    await page.waitForLoadState("networkidle");
  },
};

// Example scenario for measuring performance when navigating between views
export const navigationScenario: PerformanceScenario = {
  name: "navigation-performance",
  description: "Measures performance when navigating between different views",
  setup: async (page: Page) => {
    // Wait for initial load
    await page.waitForLoadState("networkidle");

    // Navigate to first view (modify selectors as needed)
    // Example: await page.click('a[href="/firstview"]');
    await page.waitForLoadState("networkidle");

    // Navigate to second view
    // Example: await page.click('a[href="/secondview"]');
    await page.waitForLoadState("networkidle");

    // Navigate back to first view
    // Example: await page.click('a[href="/firstview"]');
    await page.waitForLoadState("networkidle");
  },
};

// Example heavy operation scenario
export const heavyOperationScenario: PerformanceScenario = {
  name: "heavy-operation",
  description: "Measures performance during a CPU/memory intensive operation",
  setup: async (page: Page) => {
    // Wait for initial load
    await page.waitForLoadState("networkidle");

    // Trigger a heavy operation, such as loading a large dataset
    // Example: await page.click('#load-large-dataset');

    // Wait for operation to complete
    await page.waitForLoadState("networkidle");
  },
};

// IPC Communication scenario - test inter-process communication performance
export const ipcCommunicationScenario: PerformanceScenario = {
  name: "ipc-communication",
  description:
    "Measures performance of IPC communication between renderer and main process",
  setup: async (page: Page) => {
    // Wait for the app to load
    await page.waitForLoadState("networkidle");

    // Set up a trace collector for this test
    const traces = await collectTrace(page, async () => {
      // Execute some action that triggers IPC
      // This could be a button click or other action that causes main-renderer communication
      // For example: await page.click('#button-that-triggers-ipc');

      // Simulate this with wait time for now
      await page.waitForTimeout(1000);
    });

    // Analyze and save trace data
    const analysis = analyzeTrace(traces);
    const outputDir =
      process.env.TRACE_OUTPUT_DIR || "performance-results/traces";
    const traceFile = path.join(
      outputDir,
      `ipc-trace-${new Date().toISOString().replace(/:/g, "-")}.json`
    );
    saveTraceToFile(traces, traceFile);

    // Generate an HTML report
    const reportFile = path.join(
      outputDir,
      `ipc-report-${new Date().toISOString().replace(/:/g, "-")}.html`
    );
    generateTraceReport(analysis, reportFile, "IPC Communication Performance");
  },
};

// Memory usage over time scenario
export const memoryUsageScenario: PerformanceScenario = {
  name: "memory-usage",
  description: "Measures memory usage patterns over time",
  setup: async (page: Page) => {
    // Wait for the app to load
    await page.waitForLoadState("networkidle");

    // Get initial memory metrics
    const initialMetrics = await getMemoryMetrics(page);
    console.log("Initial memory metrics:", initialMetrics);

    // Perform operations that might impact memory
    // For example, navigate to different pages or perform memory-intensive tasks
    // Example: await page.click('#memory-intensive-action');

    // Wait a bit to let operations complete
    await page.waitForTimeout(5000);

    // Get final memory metrics
    const finalMetrics = await getMemoryMetrics(page);
    console.log("Final memory metrics:", finalMetrics);

    // Calculate change
    console.log(
      "Memory change (bytes):",
      finalMetrics.jsHeapUsedSize - initialMetrics.jsHeapUsedSize
    );
  },
};

// Window creation and management performance
export const windowManagementScenario: PerformanceScenario = {
  name: "window-management",
  description: "Measures performance of window creation and management",
  setup: async (page: Page) => {
    // Wait for the app to load
    await page.waitForLoadState("networkidle");

    // Measure performance of window-related operations
    const traces = await collectTrace(page, async () => {
      // Actions that might create/manipulate windows
      // Example: await page.click('#open-new-window');
      await page.waitForTimeout(1000);

      // Wait for any window operations to complete
      await page.waitForLoadState("networkidle");
    });

    // Analyze and save trace data
    const analysis = analyzeTrace(traces);
    const outputDir =
      process.env.TRACE_OUTPUT_DIR || "performance-results/traces";
    const reportFile = path.join(
      outputDir,
      `window-report-${new Date().toISOString().replace(/:/g, "-")}.html`
    );
    generateTraceReport(analysis, reportFile, "Window Management Performance");
  },
};

// Performance with large content or data sets
export const largeContentScenario: PerformanceScenario = {
  name: "large-content",
  description:
    "Measures performance when dealing with large content or datasets",
  setup: async (page: Page) => {
    // Wait for the app to load
    await page.waitForLoadState("networkidle");

    // Navigate to a view with large content
    // Example: await page.click('#large-dataset-view');

    // Wait for content to load
    await page.waitForLoadState("networkidle");

    // Measure scrolling performance
    const traces = await collectTrace(page, async () => {
      // Scroll through the content
      await page.evaluate(() => {
        return new Promise<void>((resolve) => {
          let totalScroll = 0;
          const interval = setInterval(() => {
            window.scrollBy(0, 100);
            totalScroll += 100;

            if (totalScroll >= 2000) {
              clearInterval(interval);
              resolve();
            }
          }, 100);
        });
      });
    });

    // Analyze and save trace data
    const analysis = analyzeTrace(traces);
    const outputDir =
      process.env.TRACE_OUTPUT_DIR || "performance-results/traces";
    const reportFile = path.join(
      outputDir,
      `large-content-report-${new Date().toISOString().replace(/:/g, "-")}.html`
    );
    generateTraceReport(analysis, reportFile, "Large Content Performance");
  },
};

// Collection of all scenarios
export const allScenarios = [
  appStartupScenario,
  libraryScenario,
  navigationScenario,
  heavyOperationScenario,
  ipcCommunicationScenario,
  memoryUsageScenario,
  windowManagementScenario,
  largeContentScenario,
];

// Get scenario by name
export function getScenarioByName(
  name: string
): PerformanceScenario | undefined {
  return allScenarios.find((scenario) => scenario.name === name);
}

// Helper function to get memory metrics
async function getMemoryMetrics(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const result = await client.send("Performance.getMetrics");
  const metrics = result.metrics;

  const jsHeapUsedSize =
    metrics.find((m: any) => m.name === "JSHeapUsedSize")?.value || 0;
  const jsHeapTotalSize =
    metrics.find((m: any) => m.name === "JSHeapTotalSize")?.value || 0;

  return {
    jsHeapUsedSize,
    jsHeapTotalSize,
    timestamp: Date.now(),
  };
}

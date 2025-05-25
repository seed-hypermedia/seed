import {CDPSession, Page} from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

let isTracing = false;
let activeSession: CDPSession | null = null;

interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  pid: number;
  tid: number;
  ts: number;
  dur?: number;
  args?: Record<string, unknown>;
}

// Match the CDP protocol types
interface CDPDataCollectedEvent {
  value: Array<{
    name?: string;
    cat?: string;
    ph?: string;
    pid?: string | number;
    tid?: string | number;
    ts?: string | number;
    dur?: string | number;
    args?: Record<string, unknown>;
  }>;
}

/**
 * Interface for trace analysis results
 */
export interface TraceAnalysis {
  totalTime: number;
  scriptingTime: number;
  renderingTime: number;
  paintingTime: number;
  systemTime: number;
  idleTime: number;
  longTasks: {
    count: number;
    totalTime: number;
    longestTask: number;
  };
  navigationTiming: {
    domContentLoaded?: number;
    loadEvent?: number;
    firstPaint?: number;
    firstContentfulPaint?: number;
  };
  frames: {
    count: number;
    slowFrames: number;
    averageFrameTime: number;
  };
  javascriptExecution: {
    compilationTime: number;
    executionTime: number;
    garbageCollectionTime: number;
  };
}

/**
 * Start collecting a trace
 */
async function startTracing(page: Page) {
  if (isTracing) {
    console.log("Tracing is already started, skipping startTracing");
    return;
  }

  try {
    // Create and store the CDP session
    activeSession = await page.context().newCDPSession(page);

    await activeSession.send("Tracing.start", {
      categories: [
        "-*",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "devtools.timeline",
        "disabled-by-default-devtools.timeline.stack",
        "disabled-by-default-v8.cpu_profile",
        "disabled-by-default-v8.cpu_profiler",
        "disabled-by-default-v8.cpu_profiler.hires",
      ].join(","),
      options: "sampling-frequency=10000", // 1000 is default
    });

    isTracing = true;
    console.log("Tracing started successfully");
  } catch (error) {
    console.error("Error starting trace:", error);
    // Clean up in case of error
    activeSession = null;
    isTracing = false;
    throw error;
  }
}

/**
 * Stop collecting the trace
 */
async function stopTracing(page: Page): Promise<TraceEvent[]> {
  if (!isTracing || !activeSession) {
    console.log(
      "Tracing is not started or session is invalid, skipping stopTracing"
    );
    return [];
  }

  try {
    const events: TraceEvent[] = [];

    // Use the existing session
    await activeSession.send("Tracing.end");

    activeSession.on("Tracing.dataCollected", (data: CDPDataCollectedEvent) => {
      // Convert CDP data format to our TraceEvent format
      const traceEvents = data.value.map((event) => {
        // Helper function to safely convert string/number to number
        const toNumber = (
          value: string | number | undefined,
          defaultValue = 0
        ): number => {
          if (typeof value === "number") return value;
          if (typeof value === "string")
            return parseInt(value, 10) || defaultValue;
          return defaultValue;
        };

        return {
          name: event.name || "",
          cat: event.cat || "",
          ph: event.ph || "",
          pid: toNumber(event.pid),
          tid: toNumber(event.tid),
          ts: toNumber(event.ts),
          dur: event.dur !== undefined ? toNumber(event.dur) : undefined,
          args: event.args || {},
        };
      });
      events.push(...traceEvents);
    });

    await new Promise((resolve) => {
      activeSession?.on("Tracing.tracingComplete", resolve);
    });

    // Clean up
    isTracing = false;
    activeSession = null;

    console.log(
      `Tracing stopped successfully, collected ${events.length} events`
    );
    return events;
  } catch (error) {
    console.error("Error stopping trace:", error);
    // Clean up in case of error
    isTracing = false;
    activeSession = null;
    return [];
  }
}

/**
 * Save trace data to a file
 */
export function saveTraceToFile(traceData: any[], outputFile: string): void {
  try {
    // Ensure the directory exists
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, {recursive: true});
    }

    fs.writeFileSync(outputFile, JSON.stringify(traceData, null, 2));
    console.log(`Trace data saved to ${outputFile}`);
  } catch (error) {
    console.error("Error saving trace data:", error);
  }
}

/**
 * Analyze trace data to extract performance metrics
 */
export function analyzeTrace(events: any[]): any {
  const metrics: any = {
    scriptDuration: 0,
    layoutDuration: 0,
    recalcStyleDuration: 0,
    paintDuration: 0,
  };

  events.forEach((event) => {
    switch (event.name) {
      case "EvaluateScript":
      case "FunctionCall":
      case "v8.compile":
      case "v8.compileModule":
        metrics.scriptDuration += event.dur || 0;
        break;
      case "Layout":
        metrics.layoutDuration += event.dur || 0;
        break;
      case "UpdateLayoutTree":
      case "RecalculateStyles":
        metrics.recalcStyleDuration += event.dur || 0;
        break;
      case "Paint":
        metrics.paintDuration += event.dur || 0;
        break;
    }
  });

  // Convert microseconds to milliseconds
  Object.keys(metrics).forEach((key) => {
    metrics[key] = metrics[key] / 1000;
  });

  return metrics;
}

/**
 * Generate an HTML report from trace analysis
 */
export function generateTraceReport(
  metrics: Record<string, number>,
  outputFile: string,
  title: string = "Performance Analysis"
): void {
  try {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .metric { margin: 10px 0; padding: 10px; border: 1px solid #ccc; }
            .metric-name { font-weight: bold; }
            .metric-value { color: #666; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          ${Object.entries(metrics)
            .map(
              ([name, value]) => `
            <div class="metric">
              <div class="metric-name">${name}</div>
              <div class="metric-value">${value.toFixed(2)}ms</div>
            </div>
          `
            )
            .join("")}
        </body>
      </html>
    `;

    // Ensure the directory exists
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, {recursive: true});
    }

    fs.writeFileSync(outputFile, html);
    console.log(`Trace report generated at ${outputFile}`);
  } catch (error) {
    console.error("Error generating trace report:", error);
  }
}

/**
 * Collect a trace during the execution of an action
 */
export async function collectTrace(
  page: Page,
  action: () => Promise<void>
): Promise<TraceEvent[]> {
  try {
    await startTracing(page);
    await action();
    return await stopTracing(page);
  } catch (error) {
    console.error("Error collecting trace:", error);
    // Ensure tracing is stopped even if there's an error
    if (isTracing) {
      try {
        await stopTracing(page);
      } catch (stopError) {
        console.error("Error stopping trace after error:", stopError);
      }
    }
    return [];
  }
}

/**
 * Saves trace analysis to a file
 */
export function saveTraceAnalysis(
  analysis: TraceAnalysis,
  filePath: string
): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }

  fs.writeFileSync(filePath, JSON.stringify(analysis, null, 2));
  console.log(`Trace analysis saved to: ${filePath}`);
}

// Helper functions for styling
function getTimeStatusClass(time?: number): string {
  if (!time) return "";
  if (time < 1000) return "status-good";
  if (time < 3000) return "status-warning";
  return "status-bad";
}

function getGCStatusClass(gcTime: number, totalTime: number): string {
  const gcPercentage = (gcTime / totalTime) * 100;
  if (gcPercentage < 5) return "status-good";
  if (gcPercentage < 10) return "status-warning";
  return "status-bad";
}

function getSlowFramesStatusClass(
  slowFrames: number,
  totalFrames: number
): string {
  if (totalFrames === 0) return "";
  const percentage = (slowFrames / totalFrames) * 100;
  if (percentage < 10) return "status-good";
  if (percentage < 30) return "status-warning";
  return "status-bad";
}

function getFrameTimeStatusClass(frameTime: number): string {
  if (frameTime < 16) return "status-good";
  if (frameTime < 33) return "status-warning";
  return "status-bad";
}

function getLongTasksStatusClass(count: number): string {
  if (count < 3) return "status-good";
  if (count < 10) return "status-warning";
  return "status-bad";
}

function getTaskTimeStatusClass(time: number): string {
  if (time < 100) return "status-good";
  if (time < 300) return "status-warning";
  return "status-bad";
}

export {startTracing, stopTracing, TraceEvent};

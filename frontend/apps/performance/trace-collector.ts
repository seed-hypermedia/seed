import {Page} from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * Interface for trace event data
 */
export interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  pid: number;
  tid: number;
  args?: any;
  dur?: number;
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
 * Starts collecting a performance trace through CDP
 */
export async function startTracing(page: Page): Promise<void> {
  try {
    const client = await page.context().newCDPSession(page);

    // Check if tracing is already active by trying to end it first
    try {
      await client.send("Tracing.end");
      // Wait a bit for the tracing to fully end
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log("Ended existing tracing session before starting a new one");
    } catch (err) {
      // Ignore errors here, it just means tracing wasn't active
    }

    // Start tracing with these categories
    await client.send("Tracing.start", {
      categories:
        "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,blink.user_timing,disabled-by-default-devtools.timeline.stack",
      transferMode: "ReturnAsStream",
      options: "sampling-frequency=10000", // 1000 is default
    });
    console.log("Successfully started tracing");
  } catch (error) {
    console.error("Error starting tracing:", error);
    // Propagate error so caller knows it failed
    throw error;
  }
}

/**
 * Stops collecting a performance trace and returns the collected events
 */
export async function stopTracing(page: Page): Promise<TraceEvent[]> {
  try {
    const client = await page.context().newCDPSession(page);
    let traceDataReceived = false;

    // Get the trace data
    let traceEvents: TraceEvent[] = [];

    try {
      // End tracing
      await client.send("Tracing.end");
      console.log("Successfully ended tracing");

      // Set up handler for trace data
      const traceDataPromise = new Promise<TraceEvent[]>((resolve) => {
        let traceChunks: Buffer[] = [];

        // Listen for dataCollected events
        client.on("Tracing.dataCollected", (event: any) => {
          if (event.value) {
            traceEvents = traceEvents.concat(event.value);
          }
        });

        // Listen for tracingComplete event
        client.on("Tracing.tracingComplete", async (event: any) => {
          console.log("Received tracingComplete event:", event);
          traceDataReceived = true;

          if (event && event.stream) {
            try {
              // Read trace data from stream
              const handle = event.stream;
              while (true) {
                const {data, eof} = await client.send("IO.read", {handle});
                if (data) {
                  traceChunks.push(Buffer.from(data, "base64"));
                }
                if (eof) {
                  break;
                }
              }
              await client.send("IO.close", {handle});

              // Process and parse trace data
              const traceData = Buffer.concat(traceChunks).toString("utf8");
              try {
                const parsedData = JSON.parse(traceData);
                if (Array.isArray(parsedData)) {
                  traceEvents = traceEvents.concat(parsedData);
                } else if (parsedData.traceEvents) {
                  traceEvents = traceEvents.concat(parsedData.traceEvents);
                }
              } catch (error) {
                console.error("Error parsing trace JSON:", error);
              }
            } catch (error) {
              console.error("Error reading trace stream:", error);
            }
          }

          resolve(traceEvents);
        });
      });

      // Wait with timeout for trace data
      const timeoutPromise = new Promise<TraceEvent[]>((resolve) => {
        setTimeout(() => {
          if (!traceDataReceived) {
            console.warn("Timed out waiting for trace data");
            resolve([]);
          }
        }, 5000);
      });

      // Return trace events or empty array if timeout
      return await Promise.race([traceDataPromise, timeoutPromise]);
    } catch (err) {
      // Handle the specific error for tracing not started
      console.warn("Error stopping trace:", err);
      return [];
    }
  } catch (error) {
    console.error("Error in stopTracing:", error);
    return [];
  }
}

/**
 * Collects a performance trace for an action
 */
export async function collectTrace(
  page: Page,
  action: () => Promise<void>
): Promise<TraceEvent[]> {
  try {
    // Start tracing
    await startTracing(page);

    // Perform the action
    await action();

    // Stop tracing and get events
    return await stopTracing(page);
  } catch (error) {
    console.error("Error collecting trace:", error);
    // Return empty array in case of error
    return [];
  }
}

/**
 * Analyzes trace data and extracts performance metrics
 */
export function analyzeTrace(events: TraceEvent[]): TraceAnalysis {
  // Initialize analysis object
  const analysis: TraceAnalysis = {
    totalTime: 0,
    scriptingTime: 0,
    renderingTime: 0,
    paintingTime: 0,
    systemTime: 0,
    idleTime: 0,
    longTasks: {
      count: 0,
      totalTime: 0,
      longestTask: 0,
    },
    navigationTiming: {},
    frames: {
      count: 0,
      slowFrames: 0,
      averageFrameTime: 0,
    },
    javascriptExecution: {
      compilationTime: 0,
      executionTime: 0,
      garbageCollectionTime: 0,
    },
  };

  // Calculate time ranges
  let minTimestamp = Number.MAX_SAFE_INTEGER;
  let maxTimestamp = 0;

  events.forEach((event) => {
    if (event.ts < minTimestamp) minTimestamp = event.ts;
    if (event.ts > maxTimestamp) maxTimestamp = event.ts;
  });

  analysis.totalTime = (maxTimestamp - minTimestamp) / 1000; // Convert to ms

  // Extract key metrics
  let frameTimes: number[] = [];

  events.forEach((event) => {
    // Track JavaScript execution
    if (event.name === "v8.compile" && event.dur) {
      analysis.javascriptExecution.compilationTime += event.dur / 1000;
    }

    if (event.name === "FunctionCall" && event.dur) {
      analysis.javascriptExecution.executionTime += event.dur / 1000;
    }

    if (event.name.includes("GC") && event.dur) {
      analysis.javascriptExecution.garbageCollectionTime += event.dur / 1000;
    }

    // Track rendering and painting
    if (
      event.name === "UpdateLayerTree" ||
      event.name === "Layout" ||
      event.name.includes("Recalc")
    ) {
      if (event.dur) {
        analysis.renderingTime += event.dur / 1000;
      }
    }

    if (
      event.name.includes("Paint") ||
      event.name.includes("Raster") ||
      event.name.includes("Composite")
    ) {
      if (event.dur) {
        analysis.paintingTime += event.dur / 1000;
      }
    }

    // Track scripting time
    if (event.cat.includes("scripting") && event.dur) {
      analysis.scriptingTime += event.dur / 1000;
    }

    // Track system time
    if (event.cat.includes("system") && event.dur) {
      analysis.systemTime += event.dur / 1000;
    }

    // Track long tasks (tasks > 50ms)
    if (event.dur && event.dur > 50000) {
      // 50ms in microseconds
      analysis.longTasks.count++;
      const taskDuration = event.dur / 1000;
      analysis.longTasks.totalTime += taskDuration;

      if (taskDuration > analysis.longTasks.longestTask) {
        analysis.longTasks.longestTask = taskDuration;
      }
    }

    // Track frame data
    if (event.name === "DrawFrame") {
      analysis.frames.count++;

      if (event.dur) {
        const frameTime = event.dur / 1000;
        frameTimes.push(frameTime);

        // Frame is slow if it takes more than 16.67ms (60fps)
        if (frameTime > 16.67) {
          analysis.frames.slowFrames++;
        }
      }
    }

    // Track navigation timing
    if (event.name === "domContentLoadedEventEnd") {
      analysis.navigationTiming.domContentLoaded =
        (event.ts - minTimestamp) / 1000;
    }

    if (event.name === "loadEventEnd") {
      analysis.navigationTiming.loadEvent = (event.ts - minTimestamp) / 1000;
    }

    if (event.name === "firstPaint") {
      analysis.navigationTiming.firstPaint = (event.ts - minTimestamp) / 1000;
    }

    if (event.name === "firstContentfulPaint") {
      analysis.navigationTiming.firstContentfulPaint =
        (event.ts - minTimestamp) / 1000;
    }
  });

  // Calculate idle time
  analysis.idleTime =
    analysis.totalTime -
    (analysis.scriptingTime +
      analysis.renderingTime +
      analysis.paintingTime +
      analysis.systemTime);

  // Calculate average frame time
  if (frameTimes.length > 0) {
    analysis.frames.averageFrameTime =
      frameTimes.reduce((sum, time) => sum + time, 0) / frameTimes.length;
  }

  return analysis;
}

/**
 * Saves trace data to a file
 */
export function saveTraceToFile(trace: TraceEvent[], filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }

  fs.writeFileSync(filePath, JSON.stringify({traceEvents: trace}, null, 2));
  console.log(`Trace saved to: ${filePath}`);
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

/**
 * Generates an HTML report for trace analysis
 */
export function generateTraceReport(
  analysis: TraceAnalysis,
  outputPath: string,
  title: string = "Performance Trace Analysis"
): void {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }
    h1, h2, h3 {
      color: #2c3e50;
    }
    .chart-container {
      position: relative;
      height: 300px;
      margin-bottom: 40px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      margin: 0 -15px;
    }
    .col {
      flex: 1;
      padding: 0 15px;
      min-width: 300px;
    }
    .card {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    .metric {
      margin-bottom: 15px;
    }
    .metric-name {
      font-weight: bold;
      margin-bottom: 5px;
    }
    .metric-value {
      font-size: 24px;
      font-weight: bold;
      color: #3498db;
    }
    .metric-unit {
      font-size: 14px;
      color: #7f8c8d;
    }
    .status-good {
      color: #2ecc71;
    }
    .status-warning {
      color: #f39c12;
    }
    .status-bad {
      color: #e74c3c;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    th {
      background-color: #f2f2f2;
    }
  </style>
</head>
<body>
  <h1>${title}</h1>
  
  <div class="row">
    <div class="col">
      <div class="card">
        <h2>Navigation Timing</h2>
        <div class="chart-container">
          <canvas id="navigationChart"></canvas>
        </div>
        <div class="metric">
          <div class="metric-name">DOM Content Loaded</div>
          <div class="metric-value ${getTimeStatusClass(
            analysis.navigationTiming.domContentLoaded
          )}">
            ${
              analysis.navigationTiming.domContentLoaded?.toFixed(2) || "N/A"
            } <span class="metric-unit">ms</span>
          </div>
        </div>
        <div class="metric">
          <div class="metric-name">Load Event</div>
          <div class="metric-value ${getTimeStatusClass(
            analysis.navigationTiming.loadEvent
          )}">
            ${
              analysis.navigationTiming.loadEvent?.toFixed(2) || "N/A"
            } <span class="metric-unit">ms</span>
          </div>
        </div>
        <div class="metric">
          <div class="metric-name">First Paint</div>
          <div class="metric-value ${getTimeStatusClass(
            analysis.navigationTiming.firstPaint
          )}">
            ${
              analysis.navigationTiming.firstPaint?.toFixed(2) || "N/A"
            } <span class="metric-unit">ms</span>
          </div>
        </div>
        <div class="metric">
          <div class="metric-name">First Contentful Paint</div>
          <div class="metric-value ${getTimeStatusClass(
            analysis.navigationTiming.firstContentfulPaint
          )}">
            ${
              analysis.navigationTiming.firstContentfulPaint?.toFixed(2) ||
              "N/A"
            } <span class="metric-unit">ms</span>
          </div>
        </div>
      </div>
    </div>
    
    <div class="col">
      <div class="card">
        <h2>Time Breakdown</h2>
        <div class="chart-container">
          <canvas id="timeBreakdownChart"></canvas>
        </div>
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Time (ms)</th>
              <th>Percentage</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Scripting</td>
              <td>${analysis.scriptingTime.toFixed(2)}</td>
              <td>${(
                (analysis.scriptingTime / analysis.totalTime) *
                100
              ).toFixed(1)}%</td>
            </tr>
            <tr>
              <td>Rendering</td>
              <td>${analysis.renderingTime.toFixed(2)}</td>
              <td>${(
                (analysis.renderingTime / analysis.totalTime) *
                100
              ).toFixed(1)}%</td>
            </tr>
            <tr>
              <td>Painting</td>
              <td>${analysis.paintingTime.toFixed(2)}</td>
              <td>${(
                (analysis.paintingTime / analysis.totalTime) *
                100
              ).toFixed(1)}%</td>
            </tr>
            <tr>
              <td>System</td>
              <td>${analysis.systemTime.toFixed(2)}</td>
              <td>${((analysis.systemTime / analysis.totalTime) * 100).toFixed(
                1
              )}%</td>
            </tr>
            <tr>
              <td>Idle</td>
              <td>${analysis.idleTime.toFixed(2)}</td>
              <td>${((analysis.idleTime / analysis.totalTime) * 100).toFixed(
                1
              )}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
  
  <div class="row">
    <div class="col">
      <div class="card">
        <h2>JavaScript Execution</h2>
        <div class="chart-container">
          <canvas id="jsChart"></canvas>
        </div>
        <div class="metric">
          <div class="metric-name">Compilation Time</div>
          <div class="metric-value">
            ${analysis.javascriptExecution.compilationTime.toFixed(
              2
            )} <span class="metric-unit">ms</span>
          </div>
        </div>
        <div class="metric">
          <div class="metric-name">Execution Time</div>
          <div class="metric-value">
            ${analysis.javascriptExecution.executionTime.toFixed(
              2
            )} <span class="metric-unit">ms</span>
          </div>
        </div>
        <div class="metric">
          <div class="metric-name">Garbage Collection Time</div>
          <div class="metric-value ${getGCStatusClass(
            analysis.javascriptExecution.garbageCollectionTime,
            analysis.totalTime
          )}">
            ${analysis.javascriptExecution.garbageCollectionTime.toFixed(
              2
            )} <span class="metric-unit">ms</span>
          </div>
        </div>
      </div>
    </div>
    
    <div class="col">
      <div class="card">
        <h2>Frames & Long Tasks</h2>
        <div class="chart-container">
          <canvas id="framesChart"></canvas>
        </div>
        <div class="metric">
          <div class="metric-name">Total Frames</div>
          <div class="metric-value">
            ${analysis.frames.count}
          </div>
        </div>
        <div class="metric">
          <div class="metric-name">Slow Frames (>16.67ms)</div>
          <div class="metric-value ${getSlowFramesStatusClass(
            analysis.frames.slowFrames,
            analysis.frames.count
          )}">
            ${analysis.frames.slowFrames} <span class="metric-unit">(${(
              (analysis.frames.slowFrames / analysis.frames.count) *
              100
            ).toFixed(1)}%)</span>
          </div>
        </div>
        <div class="metric">
          <div class="metric-name">Average Frame Time</div>
          <div class="metric-value ${getFrameTimeStatusClass(
            analysis.frames.averageFrameTime
          )}">
            ${analysis.frames.averageFrameTime.toFixed(
              2
            )} <span class="metric-unit">ms</span>
          </div>
        </div>
        <div class="metric">
          <div class="metric-name">Long Tasks (>50ms)</div>
          <div class="metric-value ${getLongTasksStatusClass(
            analysis.longTasks.count
          )}">
            ${analysis.longTasks.count}
          </div>
        </div>
        <div class="metric">
          <div class="metric-name">Longest Task</div>
          <div class="metric-value ${getTaskTimeStatusClass(
            analysis.longTasks.longestTask
          )}">
            ${analysis.longTasks.longestTask.toFixed(
              2
            )} <span class="metric-unit">ms</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    document.addEventListener('DOMContentLoaded', () => {
      // Navigation Timing Chart
      const navCtx = document.getElementById('navigationChart').getContext('2d');
      new Chart(navCtx, {
        type: 'bar',
        data: {
          labels: ['First Paint', 'First Contentful Paint', 'DOM Content Loaded', 'Load Event'],
          datasets: [{
            label: 'Time (ms)',
            data: [
              ${analysis.navigationTiming.firstPaint || 0},
              ${analysis.navigationTiming.firstContentfulPaint || 0},
              ${analysis.navigationTiming.domContentLoaded || 0},
              ${analysis.navigationTiming.loadEvent || 0}
            ],
            backgroundColor: [
              'rgba(26, 188, 156, 0.7)',
              'rgba(46, 204, 113, 0.7)',
              'rgba(52, 152, 219, 0.7)',
              'rgba(155, 89, 182, 0.7)'
            ],
            borderColor: [
              'rgba(26, 188, 156, 1)',
              'rgba(46, 204, 113, 1)',
              'rgba(52, 152, 219, 1)',
              'rgba(155, 89, 182, 1)'
            ],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true
            }
          }
        }
      });
      
      // Time Breakdown Chart
      const timeCtx = document.getElementById('timeBreakdownChart').getContext('2d');
      new Chart(timeCtx, {
        type: 'doughnut',
        data: {
          labels: ['Scripting', 'Rendering', 'Painting', 'System', 'Idle'],
          datasets: [{
            data: [
              ${analysis.scriptingTime},
              ${analysis.renderingTime},
              ${analysis.paintingTime},
              ${analysis.systemTime},
              ${analysis.idleTime}
            ],
            backgroundColor: [
              'rgba(52, 152, 219, 0.7)',
              'rgba(231, 76, 60, 0.7)',
              'rgba(241, 196, 15, 0.7)',
              'rgba(155, 89, 182, 0.7)',
              'rgba(149, 165, 166, 0.7)'
            ],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false
        }
      });
      
      // JavaScript Chart
      const jsCtx = document.getElementById('jsChart').getContext('2d');
      new Chart(jsCtx, {
        type: 'doughnut',
        data: {
          labels: ['Compilation', 'Execution', 'Garbage Collection'],
          datasets: [{
            data: [
              ${analysis.javascriptExecution.compilationTime},
              ${analysis.javascriptExecution.executionTime},
              ${analysis.javascriptExecution.garbageCollectionTime}
            ],
            backgroundColor: [
              'rgba(52, 152, 219, 0.7)',
              'rgba(46, 204, 113, 0.7)',
              'rgba(231, 76, 60, 0.7)'
            ],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false
        }
      });
      
      // Frames Chart
      const framesCtx = document.getElementById('framesChart').getContext('2d');
      new Chart(framesCtx, {
        type: 'bar',
        data: {
          labels: ['Average Frame Time', 'Slow Frames', 'Long Tasks'],
          datasets: [{
            label: 'Count',
            data: [
              ${analysis.frames.averageFrameTime},
              ${analysis.frames.slowFrames},
              ${analysis.longTasks.count}
            ],
            backgroundColor: [
              'rgba(46, 204, 113, 0.7)',
              'rgba(241, 196, 15, 0.7)',
              'rgba(231, 76, 60, 0.7)'
            ],
            borderColor: [
              'rgba(46, 204, 113, 1)',
              'rgba(241, 196, 15, 1)',
              'rgba(231, 76, 60, 1)'
            ],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true
            }
          }
        }
      });
    });
  </script>
</body>
</html>
  `;

  // Create directory if it doesn't exist
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }

  fs.writeFileSync(outputPath, html);
  console.log(`Trace report generated at: ${outputPath}`);
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

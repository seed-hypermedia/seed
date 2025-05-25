import type {
  PerformanceReport,
  WebPerformanceMetric,
  WebPerformanceReport,
  WebPerformanceResult,
} from "../types";

/**
 * Load performance reports from the specified directory
 */
export async function loadPerformanceReports(
  appType: string = "electron"
): Promise<PerformanceReport[]> {
  try {
    // Determine the correct path based on app type
    const basePath =
      appType == "electron" ? "/results/electron" : `/results/${appType}`;
    const fetchUrl = `${basePath}/index.json`;

    const response = await fetch(fetchUrl);

    if (!response.ok) {
      throw new Error(`Failed to load performance reports for ${appType}`);
    }

    const data = await response.json();

    return appType == "electron" ? data.reports : data;
  } catch (error) {
    console.error(`Error loading ${appType} performance reports:`, error);
    return [];
  }
}

/**
 * Load a specific performance report by ID
 */
export const loadReportById = async (
  reportId: string
): Promise<PerformanceReport | null> => {
  console.log("loadReportById", reportId);

  try {
    // First, get the index to find the correct file for this report ID
    const indexResponse = await fetch("/results/electron/index.json");
    if (!indexResponse.ok) {
      throw new Error("Failed to load electron performance index");
    }
    const indexData = await indexResponse.json();
    const report = indexData.reports.find((r: any) => r.id === reportId);

    if (!report) {
      throw new Error(`Report with ID ${reportId} not found in index`);
    }

    // Now fetch the actual report file
    const url = `/results/electron/${report.file}`;
    console.log(
      `[loadReportById] Attempting to fetch report ${reportId} from: ${url}`
    );

    const response = await fetch(url);

    console.log(
      `[loadReportById] Response status for report ${reportId}: ${response.status} ${response.statusText}`
    );

    if (!response.ok) {
      throw new Error(
        `Failed to load report ${reportId}: ${response.statusText}`
      );
    }

    const reportData = await response.json();
    console.log(
      `[loadReportById] Report data received for ${reportId}:`,
      reportData
    );

    // Transform the data to match the expected format
    const scenarios = Object.entries(reportData.metrics).map(
      ([name, metrics]: [string, any]) => ({
        name,
        metrics: Object.entries(metrics)
          .map(([metricName, value]) => {
            // Handle CPU usage metrics separately
            if (metricName === "cpuUsage") {
              return Object.entries(
                value as {
                  percentCPUUsage: number;
                  idleWakeupsPerSecond: number;
                }
              ).map(([cpuMetricName, cpuValue]) => ({
                name: cpuMetricName,
                value: cpuValue,
                unit:
                  cpuMetricName.includes("Percentage") ||
                  cpuMetricName === "percentCPUUsage"
                    ? "%"
                    : "",
              }));
            }

            // Handle regular metrics
            return {
              name: metricName,
              value: value as number,
              unit:
                metricName.includes("Time") || metricName.includes("Duration")
                  ? "ms"
                  : metricName.includes("Size")
                  ? "bytes"
                  : "",
            };
          })
          .flat(), // Flatten the array to include CPU metrics at the same level
      })
    );

    return {
      id: reportId,
      date: report.date,
      scenarios,
      summary: report.summary,
    };
  } catch (error: unknown) {
    console.error(`[loadReportById] Error loading report ${reportId}:`, error);
    if (error instanceof Error) {
      console.error(`[loadReportById] Full error details for ${reportId}:`, {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
    return null;
  }
};

/**
 * Get the path to a trace file
 */
export const getTracePath = (reportId: string, traceFile: string): string => {
  console.log("getTracePath", reportId, traceFile);
  const path = `/results/electron/${reportId}/traces/${traceFile}`;
  console.log(
    `[getTracePath] Generated path for report ${reportId}, trace ${traceFile}: ${path}`
  );
  return path;
};

/**
 * Get the path to a screenshot file
 */
export const getScreenshotPath = (
  reportId: string,
  screenshotFile: string
): string => {
  const path = `/results/electron/${reportId}/screenshots/${screenshotFile}`;
  console.log(
    `[getScreenshotPath] Generated path for report ${reportId}, screenshot ${screenshotFile}: ${path}`
  );
  return path;
};

// Load electron performance reports
export async function loadElectronPerformanceReports(): Promise<
  PerformanceReport[]
> {
  try {
    // First load the index file
    const response = await fetch("/results/electron/index.json");
    if (!response.ok) {
      throw new Error("Failed to load electron performance results");
    }
    const indexData = await response.json();
    const reports = indexData.reports || [];

    // Now load each report file
    const fullReports = await Promise.all(
      reports.map(
        async (report: {
          id: string;
          date: string;
          file: string;
          summary: {
            totalScenarios: number;
            passedBudgets: number;
            failedBudgets: number;
          };
        }) => {
          try {
            const reportResponse = await fetch(
              `/results/electron/${report.file}`
            );
            if (!reportResponse.ok) {
              throw new Error(`Failed to load report file: ${report.file}`);
            }
            const reportData = await reportResponse.json();

            // Transform metrics into scenarios
            const scenarios = Object.entries(reportData.metrics).map(
              ([name, metrics]: [string, any]) => ({
                name,
                metrics: Object.entries(metrics)
                  .map(([metricName, value]) => {
                    // Handle CPU usage metrics separately
                    if (metricName === "cpuUsage") {
                      return Object.entries(
                        value as {
                          percentCPUUsage: number;
                          idleWakeupsPerSecond: number;
                        }
                      ).map(([cpuMetricName, cpuValue]) => ({
                        name: cpuMetricName,
                        value: cpuValue,
                        unit:
                          cpuMetricName.includes("Percentage") ||
                          cpuMetricName === "percentCPUUsage"
                            ? "%"
                            : "",
                      }));
                    }

                    // Handle regular metrics
                    return {
                      name: metricName,
                      value: value as number,
                      unit:
                        metricName.includes("Time") ||
                        metricName.includes("Duration")
                          ? "ms"
                          : metricName.includes("Size")
                          ? "bytes"
                          : "",
                    };
                  })
                  .flat(), // Flatten the array to include CPU metrics at the same level
              })
            );

            return {
              id: report.id,
              date: report.date,
              scenarios,
              summary: report.summary,
            };
          } catch (error) {
            console.error(`Error loading report file ${report.file}:`, error);
            return null;
          }
        }
      )
    );

    // Filter out any failed loads
    return fullReports.filter(
      (report): report is PerformanceReport => report !== null
    );
  } catch (error) {
    console.error("Error loading electron performance results:", error);
    return [];
  }
}

// Load web performance results for a specific app (web or landing)
export async function loadWebPerformanceResults(
  app: "web" | "landing"
): Promise<WebPerformanceResult[]> {
  try {
    const response = await fetch(`/results/${app}/index.json`);
    if (!response.ok) {
      throw new Error(`Failed to load ${app} performance results`);
    }
    const rawData = await response.json();

    // Flatten nested arrays and remove duplicates
    const flattenArray = (arr: any[]): any[] => {
      return arr.reduce((flat, item) => {
        if (Array.isArray(item)) {
          return [...flat, ...flattenArray(item)];
        }
        return [...flat, item];
      }, []);
    };

    const flattened = flattenArray(rawData);

    // Remove duplicates based on timestamp
    const uniqueResults = flattened.filter(
      (item, index, self) =>
        index === self.findIndex((t) => t.timestamp === item.timestamp)
    );

    // Sort by timestamp descending (most recent first)
    return uniqueResults.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  } catch (error) {
    console.error(`Error loading ${app} performance results:`, error);
    return [];
  }
}

// Transform a web performance result into a report format
export function transformWebResult(
  result: WebPerformanceResult
): WebPerformanceReport {
  const metrics: WebPerformanceMetric[] = [];

  // Mobile metrics
  Object.entries(result.mobile).forEach(([key, value]) => {
    metrics.push({
      name: key,
      value: value as number,
      device: "mobile",
    });
  });

  // Desktop metrics
  Object.entries(result.desktop).forEach(([key, value]) => {
    metrics.push({
      name: key,
      value: value as number,
      device: "desktop",
    });
  });

  return {
    id: result.timestamp,
    date: result.timestamp,
    timestamp: result.timestamp,
    app: result.app,
    metrics,
    budgetViolations: result.budgetViolations,
  };
}

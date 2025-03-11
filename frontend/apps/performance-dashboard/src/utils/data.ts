import {PerformanceReport} from "../types";

/**
 * Load performance reports from the specified directory
 */
export const loadPerformanceReports = async (): Promise<
  PerformanceReport[]
> => {
  // Path to the index.json file in the public directory
  const url = "/performance-results/index.json";
  console.log(`[loadPerformanceReports] Attempting to fetch from: ${url}`);

  try {
    // Fetch from the public directory
    const response = await fetch(url);

    console.log(
      `[loadPerformanceReports] Response status: ${response.status} ${response.statusText}`
    );

    if (!response.ok) {
      throw new Error(
        `Failed to load performance reports: ${response.statusText}`
      );
    }

    const indexData = await response.json();
    console.log(`[loadPerformanceReports] Data received:`, indexData);

    const reports = indexData.reports || [];
    console.log(
      `[loadPerformanceReports] Number of reports loaded: ${reports.length}`
    );

    if (reports.length === 0) {
      console.warn("[loadPerformanceReports] No reports found in the response");
    }

    return reports;
  } catch (error: unknown) {
    console.error(
      "[loadPerformanceReports] Error loading performance reports:",
      error
    );
    if (error instanceof Error) {
      console.error("[loadPerformanceReports] Full error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
    }
    return [];
  }
};

/**
 * Load a specific performance report by ID
 */
export const loadReportById = async (
  reportId: string
): Promise<PerformanceReport | null> => {
  const url = `/performance-results/${reportId}/report.json`;
  console.log(
    `[loadReportById] Attempting to fetch report ${reportId} from: ${url}`
  );

  try {
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

    return reportData;
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
  const path = `/performance-results/${reportId}/traces/${traceFile}`;
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
  const path = `/performance-results/${reportId}/screenshots/${screenshotFile}`;
  console.log(
    `[getScreenshotPath] Generated path for report ${reportId}, screenshot ${screenshotFile}: ${path}`
  );
  return path;
};

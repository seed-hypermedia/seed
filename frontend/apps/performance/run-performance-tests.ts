#!/usr/bin/env node

import {program} from "commander";
import * as fs from "fs";
import * as glob from "glob";
import * as path from "path";
import {
  generateBestPracticesReport,
  runBestPracticeChecks,
} from "./best-practices-checker";
import {generateDashboard} from "./dashboard-generator";
import {
  measureAppStartupTime,
  PerformanceMetrics,
  PerformanceScenario,
  runLighthouseAudit,
  runPerformanceScenario,
  saveMetricsToJson,
} from "./perf-utils";
import {
  checkPerformanceBudgets,
  defaultBudgets,
  generateBudgetReport,
  loadBudgetsFromFile,
} from "./performance-budgets";
import {allScenarios, appStartupScenario, getScenarioByName} from "./scenarios";
import {startApp} from "./utils";

// Define report interface that will be used for the index.json file
interface ScenarioMetric {
  name: string;
  value: number;
  unit: string;
  description?: string;
  threshold?: number;
}

interface ScenarioResult {
  name: string;
  metrics: ScenarioMetric[];
}

interface PerformanceReportData {
  id: string;
  date: string;
  scenarios: ScenarioResult[];
  summary?: {
    totalScenarios: number;
    passedBudgets: number;
    failedBudgets: number;
  };
}

// Set up CLI options
program
  .name("run-performance-tests")
  .description("Run performance tests on the Electron desktop app")
  .version("0.1.0");

program
  .option(
    "-s, --scenarios <scenarios>",
    "Comma-separated list of scenarios to run (default: all)",
    "all"
  )
  .option(
    "-o, --output-dir <dir>",
    "Output directory for test results",
    "performance-results"
  )
  .option("-d, --dashboard", "Generate HTML dashboard", false)
  .option("-b, --best-practices", "Run best practices checks", false)
  .option("-l, --lighthouse", "Run Lighthouse audits", false)
  .option(
    "-u, --upload",
    "Upload results to S3 (requires AWS credentials)",
    false
  )
  .option("--ci", "Run in CI mode", false)
  .option(
    "--url <url>",
    "URL to run Lighthouse audit against (required for lighthouse option)",
    "http://localhost:9222"
  )
  .option("--budget", "Check performance against budgets", false)
  .option("--budget-file <file>", "Custom performance budget file (JSON)")
  .option("--trace", "Collect and analyze Chrome DevTools traces", false)
  .option(
    "--fail-on-budget-error",
    "Exit with error code if budget error violations are found",
    false
  );

program.parse();

const options = program.opts();

async function main() {
  console.log("🚀 Starting Electron app performance tests...");

  // Prepare results directory
  const outputDir = path.resolve(options.outputDir);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, {recursive: true});
  }

  // Create traces directory if tracing is enabled
  const tracesDir = path.join(outputDir, "traces");
  if (options.trace && !fs.existsSync(tracesDir)) {
    fs.mkdirSync(tracesDir, {recursive: true});
  }

  // Load custom performance budgets if provided
  let performanceBudgets = defaultBudgets;
  if (options.budgetFile) {
    try {
      performanceBudgets = loadBudgetsFromFile(options.budgetFile);
      console.log(
        `📋 Loaded custom performance budgets from ${options.budgetFile}`
      );
    } catch (error) {
      console.error(`❌ Error loading performance budgets:`, error);
      process.exit(1);
    }
  }

  // Determine which scenarios to run
  let scenariosToRun = allScenarios;
  if (options.scenarios !== "all") {
    const scenarioNames = options.scenarios.split(",");
    scenariosToRun = scenarioNames
      .map((name: string) => getScenarioByName(name))
      .filter(
        (scenario: PerformanceScenario | undefined) => !!scenario
      ) as PerformanceScenario[];

    if (scenariosToRun.length === 0) {
      console.error("Error: No valid scenarios specified");
      process.exit(1);
    }
  }

  // Run the tests
  const results: Record<string, PerformanceMetrics> = {};

  // Always measure startup time
  console.log("📊 Measuring app startup time...");
  results[appStartupScenario.name] = await measureAppStartupTime();

  // Run each scenario
  for (const scenario of scenariosToRun) {
    if (scenario.name === appStartupScenario.name) {
      continue; // Already measured
    }

    console.log(`📊 Running scenario: ${scenario.name}`);
    try {
      results[scenario.name] = await runPerformanceScenario(scenario);
      console.log(`✅ Completed scenario: ${scenario.name}`);
    } catch (error) {
      console.error(`❌ Error running scenario ${scenario.name}:`, error);
    }
  }

  // Run Lighthouse audit if requested
  if (options.lighthouse) {
    if (!options.url) {
      console.error("Error: URL is required for Lighthouse audit");
      process.exit(1);
    }

    console.log(`📊 Running Lighthouse audit on ${options.url}...`);
    try {
      // Make sure URL has proper http:// prefix
      let urlToAudit = options.url;
      if (
        !urlToAudit.startsWith("http://") &&
        !urlToAudit.startsWith("https://")
      ) {
        urlToAudit = `http://${urlToAudit}`;
      }

      console.log(
        "NOTE: For Electron apps, the URL should be the actual web server URL where your app content is served."
      );
      console.log(
        "      The URL 'localhost:9222' is typically just the Chrome debugging port, not your actual app."
      );
      console.log(
        "      For Vite-based apps, try 'http://localhost:5173' instead."
      );

      // Add retry logic for Lighthouse
      let retries = 3;
      let lighthouseMetrics: PerformanceMetrics = {};

      while (retries > 0) {
        try {
          lighthouseMetrics = await runLighthouseAudit(urlToAudit);
          // Check if we have valid metrics
          if (
            lighthouseMetrics &&
            "lighthouse" in lighthouseMetrics &&
            lighthouseMetrics.lighthouse &&
            typeof lighthouseMetrics.lighthouse.performanceScore === "number"
          ) {
            break; // Success, exit retry loop
          }
          throw new Error("Invalid Lighthouse metrics result");
        } catch (error) {
          retries--;
          if (retries === 0) throw error;
          console.log(
            `Retrying Lighthouse audit (${retries} attempts left)...`
          );
          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      results["lighthouse"] = lighthouseMetrics;
      console.log("✅ Lighthouse audit completed");
    } catch (error) {
      console.error("❌ Error running Lighthouse audit:", error);

      // Create fallback metrics to avoid breaking the rest of the process
      const fallbackMetrics: PerformanceMetrics = {
        lighthouse: {
          performanceScore: 0,
          firstContentfulPaint: 0,
          speedIndex: 0,
          largestContentfulPaint: 0,
          totalBlockingTime: 0,
          cumulativeLayoutShift: 0,
          timeToInteractive: 0,
        },
      };

      results["lighthouse"] = fallbackMetrics;
      console.log("⚠️ Using fallback Lighthouse metrics due to error");
    }
  }

  // Run best practices checks if requested
  if (options.bestPractices) {
    console.log("📊 Running best practices checks...");
    try {
      // Launch the app again for best practices checks
      const {app, appWindow} = await startApp();
      const bestPracticesResults = await runBestPracticeChecks(app, appWindow);

      // Generate best practices report
      const bestPracticesReportPath = path.join(
        outputDir,
        "best-practices-report.html"
      );
      generateBestPracticesReport(
        bestPracticesResults,
        bestPracticesReportPath
      );
      console.log(
        `✅ Best practices report generated at: ${bestPracticesReportPath}`
      );

      await app.close();
    } catch (error) {
      console.error("❌ Error running best practices checks:", error);
    }
  }

  // Save results
  const resultsPath = await saveMetricsToJson(results, outputDir);
  console.log(`💾 Results saved to: ${resultsPath}`);

  // Update index.json for the dashboard
  updateIndexJson(outputDir, resultsPath, results);

  // Check performance against budgets if requested
  if (options.budget) {
    console.log("📋 Checking performance against budgets...");
    try {
      const budgetResults = checkPerformanceBudgets(
        results,
        performanceBudgets
      );

      // Generate budget report
      const budgetReportPath = path.join(outputDir, "budget-report.html");
      generateBudgetReport(budgetResults, budgetReportPath);
      console.log(`✅ Budget report generated at: ${budgetReportPath}`);

      // Report violations
      const errorViolations = budgetResults.violations.filter(
        (v) => v.budget.severity === "error"
      );
      const warningViolations = budgetResults.violations.filter(
        (v) => v.budget.severity === "warning"
      );

      if (errorViolations.length > 0 || warningViolations.length > 0) {
        console.log(`⚠️ Performance budget violations found:`);
        if (errorViolations.length > 0) {
          console.log(`   - ${errorViolations.length} error violations`);
        }
        if (warningViolations.length > 0) {
          console.log(`   - ${warningViolations.length} warning violations`);
        }
        console.log(
          `   See the budget report for details: ${budgetReportPath}`
        );

        // Exit with error if requested and there are error violations
        if (options.failOnBudgetError && errorViolations.length > 0) {
          console.error("❌ Error: Performance budget error violations found.");
          process.exit(1);
        }
      } else {
        console.log("✅ All performance budgets passed!");
      }
    } catch (error) {
      console.error("❌ Error checking performance budgets:", error);
    }
  }

  // Generate dashboard if requested
  if (options.dashboard) {
    console.log("🖥️ Generating dashboard...");
    const metricsFiles = glob.sync(path.join(outputDir, "perf-metrics-*.json"));
    const dashboardPath = path.join(outputDir, "dashboard.html");
    generateDashboard(metricsFiles, dashboardPath);
    console.log(`🎉 Dashboard generated at: ${dashboardPath}`);
  }

  // Upload to S3 if requested
  if (options.upload) {
    console.log("☁️ Uploading results to S3...");
    try {
      // This would call an AWS SDK function to upload the files
      // We're using the upload-to-s3.ts script
      const {execSync} = require("child_process");
      execSync(
        `yarn ts-node upload-to-s3.ts -d ${outputDir} -b ${
          process.env.S3_BUCKET_NAME || "performance-metrics"
        } --public`,
        {
          cwd: __dirname,
          stdio: "inherit",
        }
      );
      console.log("✅ Upload complete");
    } catch (error) {
      console.error("❌ Error uploading to S3:", error);
    }
  }

  // Generate summary for CI
  if (options.ci) {
    console.log("📝 Generating CI summary...");
    generateCISummary(results, outputDir);
  }

  console.log("✨ Performance testing complete");
}

/**
 * Generate a summary for CI environments (like GitHub Actions)
 */
function generateCISummary(
  results: Record<string, PerformanceMetrics>,
  outputDir: string
): void {
  let summary = "## Electron App Performance Test Results\n\n";

  // Add startup metrics
  if (results["app-startup"]) {
    const startup = results["app-startup"];
    summary += "### App Startup Performance\n\n";
    summary += "| Metric | Value |\n";
    summary += "| ------ | ----- |\n";

    if (startup.appStartupTime) {
      summary += `| App Startup Time | ${startup.appStartupTime.toFixed(
        2
      )} ms |\n`;
    }

    if (startup.firstContentfulPaint) {
      summary += `| First Contentful Paint | ${startup.firstContentfulPaint.toFixed(
        2
      )} ms |\n`;
    }

    if (startup.loadTime) {
      summary += `| Load Time | ${startup.loadTime.toFixed(2)} ms |\n`;
    }

    summary += "\n";
  }

  // Add memory metrics if available
  const hasMemoryMetrics = Object.values(results).some(
    (m) => m.jsHeapUsedSize !== undefined
  );
  if (hasMemoryMetrics) {
    summary += "### Memory Usage\n\n";
    summary += "| Scenario | JS Heap Used (MB) | JS Heap Total (MB) |\n";
    summary += "| -------- | ----------------- | ------------------ |\n";

    for (const [scenario, metrics] of Object.entries(results)) {
      if (metrics.jsHeapUsedSize) {
        const jsHeapUsedMB = (metrics.jsHeapUsedSize / (1024 * 1024)).toFixed(
          2
        );
        const jsHeapTotalMB = metrics.jsHeapTotalSize
          ? (metrics.jsHeapTotalSize / (1024 * 1024)).toFixed(2)
          : "N/A";

        summary += `| ${formatScenarioName(
          scenario
        )} | ${jsHeapUsedMB} | ${jsHeapTotalMB} |\n`;
      }
    }

    summary += "\n";
  }

  // Add CPU metrics if available
  const hasCpuMetrics = Object.values(results).some(
    (m) => m.cpuUsage !== undefined
  );
  if (hasCpuMetrics) {
    summary += "### CPU Performance\n\n";
    summary += "| Scenario | CPU Usage (%) | Frame Rate (fps) |\n";
    summary += "| -------- | ------------- | ---------------- |\n";

    for (const [scenario, metrics] of Object.entries(results)) {
      if (metrics.cpuUsage || metrics.frameRate) {
        const cpuUsage = metrics.cpuUsage
          ? metrics.cpuUsage.percentCPUUsage.toFixed(2)
          : "N/A";

        const frameRate = metrics.frameRate
          ? metrics.frameRate.toFixed(1)
          : "N/A";

        summary += `| ${formatScenarioName(
          scenario
        )} | ${cpuUsage} | ${frameRate} |\n`;
      }
    }

    summary += "\n";
  }
}

/**
 * Helper to format scenario names
 */
function formatScenarioName(scenario: string): string {
  // Convert kebab-case to Title Case
  return scenario
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Add a function to update the index.json file
function updateIndexJson(
  outputDir: string,
  metricsFile: string,
  metrics: Record<string, PerformanceMetrics>
) {
  const indexPath = path.join(outputDir, "index.json");
  let indexData: {reports: any[]} = {reports: []};

  console.log(`Updating index.json with data from: ${metricsFile}`);

  // Read existing index.json if it exists
  if (fs.existsSync(indexPath)) {
    try {
      const indexContent = fs.readFileSync(indexPath, "utf-8");
      indexData = JSON.parse(indexContent);
    } catch (error) {
      console.error("Error reading index.json:", error);
    }
  }

  // Create report entry
  const reportId = path
    .basename(metricsFile, ".json")
    .replace("perf-metrics-", "");

  // Handle date parsing safely
  let reportDate: string;
  try {
    // Try to create a Date object from the ID directly first
    let dateObj = new Date(reportId);

    // Check if date is valid
    if (isNaN(dateObj.getTime())) {
      // If direct parsing fails, try to properly format it
      // The format is typically like "2025-03-04T16-36-42.846Z"
      // We need to replace hyphens in the time part with colons
      const formattedId = reportId.replace(
        /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})\.(\d{3})Z/,
        "$1T$2:$3:$4.$5Z"
      );
      dateObj = new Date(formattedId);

      if (isNaN(dateObj.getTime())) {
        throw new Error("Invalid date after formatting");
      }
    }

    reportDate = dateObj.toISOString();
  } catch (error) {
    // Fallback to current date if parsing fails
    console.warn(
      `Failed to parse date from ID '${reportId}', using current date instead:`,
      error
    );
    reportDate = new Date().toISOString();
  }

  console.log(`Report ID: ${reportId}, Report Date: ${reportDate}`);

  // Transform the metrics data into the expected format with scenarios
  const scenariosArray: ScenarioResult[] = Object.entries(metrics).map(
    ([scenarioName, scenarioMetrics]) => {
      // Convert metrics object into array of metrics
      const metricsArray: ScenarioMetric[] = [];

      // Add all numeric metrics
      for (const [metricName, metricValue] of Object.entries(scenarioMetrics)) {
        if (typeof metricValue === "number") {
          metricsArray.push({
            name: metricName,
            value: metricValue,
            unit:
              metricName.includes("Time") || metricName.includes("Duration")
                ? "ms"
                : metricName.includes("Size")
                ? "bytes"
                : "",
          });
        }
      }

      // Add CPU metrics if they exist
      if (scenarioMetrics.cpuUsage) {
        for (const [cpuMetricName, cpuMetricValue] of Object.entries(
          scenarioMetrics.cpuUsage
        )) {
          metricsArray.push({
            name: cpuMetricName,
            value: cpuMetricValue,
            unit: cpuMetricName.includes("Percentage") ? "%" : "",
          });
        }
      }

      // Add Lighthouse metrics if they exist
      if (scenarioMetrics.lighthouse) {
        for (const [
          lighthouseMetricName,
          lighthouseMetricValue,
        ] of Object.entries(scenarioMetrics.lighthouse)) {
          if (typeof lighthouseMetricValue === "number") {
            metricsArray.push({
              name: `lighthouse_${lighthouseMetricName}`,
              value: lighthouseMetricValue,
              unit:
                lighthouseMetricName.includes("Time") ||
                lighthouseMetricName.includes("Paint")
                  ? "ms"
                  : lighthouseMetricName.includes("Score")
                  ? ""
                  : "",
            });
          }
        }
      }

      return {
        name: scenarioName,
        metrics: metricsArray,
      };
    }
  );

  // Create the transformed report data
  const reportData: PerformanceReportData = {
    id: reportId,
    date: reportDate,
    scenarios: scenariosArray,
    summary: {
      totalScenarios: scenariosArray.length,
      passedBudgets: 0, // Will calculate below
      failedBudgets: 0, // Will calculate below
    },
  };

  // Count passed and failed budgets
  let passedBudgets = 0;
  let failedBudgets = 0;

  reportData.scenarios.forEach((scenario) => {
    scenario.metrics.forEach((metric) => {
      if (metric.threshold) {
        if (metric.value <= metric.threshold) {
          passedBudgets++;
        } else {
          failedBudgets++;
        }
      }
    });
  });

  // Update the summary
  if (reportData.summary) {
    reportData.summary.passedBudgets = passedBudgets;
    reportData.summary.failedBudgets = failedBudgets;
  } else {
    reportData.summary = {
      totalScenarios: scenariosArray.length,
      passedBudgets,
      failedBudgets,
    };
  }

  // Create report entry for the index
  const reportEntry = {
    id: reportId,
    date: reportDate,
    file: path.basename(metricsFile),
    summary: {
      totalScenarios: reportData.scenarios.length,
      passedBudgets,
      failedBudgets,
    },
  };

  // Add to reports array (or replace if already exists)
  const existingIndex = indexData.reports.findIndex((r) => r.id === reportId);
  if (existingIndex >= 0) {
    indexData.reports[existingIndex] = reportEntry;
  } else {
    indexData.reports.push(reportEntry);
  }

  // Sort reports by date (newest first)
  indexData.reports.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Write updated index.json
  fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2), "utf-8");
  console.log(`Updated index.json with report ${reportId}`);

  // Also save the full report data
  const reportPath = path.join(outputDir, reportId, "report.json");
  fs.mkdirSync(path.dirname(reportPath), {recursive: true});
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), "utf-8");
  console.log(`Saved full report data to ${reportPath}`);
}

main().catch((error) => {
  console.error("❌ Unhandled error:", error);
  process.exit(1);
});

import React, {useEffect, useState} from "react";
import "../App.css";
import type {PerformanceReport, ScenarioResult} from "../types";
import {loadPerformanceReports, loadReportById} from "../utils/data";

// Type for SVG icon props
interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

// Utility functions
// Format bytes into human-readable format
const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

// Simple icon components with SVG to replace lucide-react
const Icons = {
  Activity: (props: IconProps) => {
    const {size = 24, ...rest} = props;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
      </svg>
    );
  },
  Cpu: (props: IconProps) => {
    const {size = 24, ...rest} = props;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
        <rect x="9" y="9" width="6" height="6"></rect>
        <line x1="9" y1="1" x2="9" y2="4"></line>
        <line x1="15" y1="1" x2="15" y2="4"></line>
        <line x1="9" y1="20" x2="9" y2="23"></line>
        <line x1="15" y1="20" x2="15" y2="23"></line>
        <line x1="20" y1="9" x2="23" y2="9"></line>
        <line x1="20" y1="14" x2="23" y2="14"></line>
        <line x1="1" y1="9" x2="4" y2="9"></line>
        <line x1="1" y1="14" x2="4" y2="14"></line>
      </svg>
    );
  },
  HardDrive: (props: IconProps) => {
    const {size = 24, ...rest} = props;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <line x1="22" y1="12" x2="2" y2="12"></line>
        <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>
        <line x1="6" y1="16" x2="6.01" y2="16"></line>
        <line x1="10" y1="16" x2="10.01" y2="16"></line>
      </svg>
    );
  },
  Clock: (props: IconProps) => {
    const {size = 24, ...rest} = props;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
    );
  },
  Gauge: (props: IconProps) => {
    const {size = 24, ...rest} = props;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <path d="M12 2v2"></path>
        <path d="M12 14l4-4"></path>
        <circle cx="12" cy="14" r="8"></circle>
      </svg>
    );
  },
  LayoutPanelLeft: (props: IconProps) => {
    const {size = 24, ...rest} = props;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="9" y1="3" x2="9" y2="21"></line>
      </svg>
    );
  },
  AlertTriangle: (props: IconProps) => {
    const {size = 24, ...rest} = props;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    );
  },
  Zap: (props: IconProps) => {
    const {size = 24, ...rest} = props;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
      </svg>
    );
  },
  Calendar: (props: IconProps) => {
    const {size = 24, ...rest} = props;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...rest}
      >
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
    );
  },
};

// MetricHeatmap component to display performance metrics across reports in a heatmap
const MetricHeatmap = ({
  reports,
  activeReportId,
}: {
  reports: PerformanceReport[];
  activeReportId: string | null;
}) => {
  const [reportData, setReportData] = useState<PerformanceReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMetric, setSelectedMetric] =
    useState<string>("percentCPUUsage");
  const [scenarioNames, setScenarioNames] = useState<string[]>([]);
  const [metricOptions, setMetricOptions] = useState<
    {name: string; displayName: string}[]
  >([]);

  // Load full report data for all reports
  useEffect(() => {
    if (!reports || reports.length === 0) return;

    const fetchAllReports = async () => {
      setIsLoading(true);

      try {
        // Fetch full report data for each report
        const fullReports = await Promise.all(
          reports.map(async (report) => {
            const fullReport = await loadReportById(report.id);
            return fullReport;
          })
        );

        // Filter out null reports
        const validReports = fullReports.filter(Boolean) as PerformanceReport[];

        if (validReports.length > 0) {
          // Get all unique scenario names across all reports
          const allScenarioNames = new Set<string>();

          // Get all unique metric names for the dropdown
          const allMetricNames = new Set<string>();
          const metricDisplayNames: Record<string, string> = {};

          validReports.forEach((report) => {
            report.scenarios.forEach((scenario) => {
              allScenarioNames.add(scenario.name);

              scenario.metrics.forEach((metric) => {
                allMetricNames.add(metric.name);
                // Create a display name from the metric name
                metricDisplayNames[metric.name] = metric.name
                  .replace(/([A-Z])/g, " $1")
                  .replace(/^./, (str) => str.toUpperCase())
                  .replace(/([a-z])([A-Z])/g, "$1 $2");
              });
            });
          });

          setScenarioNames(Array.from(allScenarioNames).sort());

          // Create metric options for the dropdown
          const options = Array.from(allMetricNames).map((name) => ({
            name,
            displayName: metricDisplayNames[name] || name,
          }));

          // Sort options by display name
          options.sort((a, b) => a.displayName.localeCompare(b.displayName));

          setMetricOptions(options);

          // If current selected metric is not in the list, set to first available metric
          if (options.length > 0 && !allMetricNames.has(selectedMetric)) {
            setSelectedMetric(options[0].name);
          }
        }

        setReportData(validReports);
      } catch (error) {
        console.error("Error loading full report data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllReports();
  }, [reports, selectedMetric]);

  // Get the maximum and minimum values for the selected metric across all reports
  const getMetricMinMax = () => {
    let min = Number.MAX_VALUE;
    let max = Number.MIN_VALUE;

    reportData.forEach((report) => {
      report.scenarios.forEach((scenario) => {
        const metric = scenario.metrics.find((m) => m.name === selectedMetric);
        if (metric) {
          min = Math.min(min, metric.value);
          max = Math.max(max, metric.value);
        }
      });
    });

    // If we didn't find any metrics, return default values
    if (min === Number.MAX_VALUE) min = 0;
    if (max === Number.MIN_VALUE) max = 100;

    return {min, max};
  };

  // Calculate color for a metric value
  const getColorForValue = (
    value: number,
    min: number,
    max: number,
    metricName: string
  ) => {
    // For most metrics, lower is better
    let normalizedValue = (value - min) / (max - min || 1);

    // For some metrics, higher is better (e.g. performanceScore)
    const higherIsBetter = ["performanceScore"].includes(metricName);
    if (higherIsBetter) {
      normalizedValue = 1 - normalizedValue;
    }

    // Clamp to [0, 1]
    normalizedValue = Math.max(0, Math.min(1, normalizedValue));

    // Generate color from green (good) to red (bad)
    const r = Math.round(255 * normalizedValue);
    const g = Math.round(255 * (1 - normalizedValue));
    const b = 0;

    return `rgb(${r}, ${g}, ${b})`;
  };

  // Format metric value for display
  const formatMetricValue = (value: number, unit?: string): string => {
    if (!unit) return value.toLocaleString();

    // Special case for bytes - convert to KB, MB, GB as appropriate
    if (unit === "bytes") {
      return formatBytes(value);
    }

    // For percentages, format with fixed decimal places
    if (unit === "%") {
      return `${value.toFixed(1)}${unit}`;
    }

    // For time measurements (ms), format appropriately
    if (unit === "ms") {
      if (value < 1) {
        return `${(value * 1000).toFixed(2)}μs`;
      }
      if (value >= 1000) {
        return `${(value / 1000).toFixed(2)}s`;
      }
      return `${Math.round(value)}${unit}`;
    }

    // Default formatting - add the unit to the value
    return `${value.toLocaleString()}${unit}`;
  };

  // Format scenario name for display
  const formatScenarioName = (name: string): string => {
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Format date for display
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).format(date);
  };

  // Get the unit for the selected metric
  const getMetricUnit = (): string => {
    for (const report of reportData) {
      for (const scenario of report.scenarios) {
        const metric = scenario.metrics.find((m) => m.name === selectedMetric);
        if (metric && metric.unit) {
          return metric.unit;
        }
      }
    }
    return "";
  };

  // If loading, show loading indicator
  if (isLoading) {
    return (
      <div className="metrics-heatmap-loading">Loading metrics data...</div>
    );
  }

  // If no report data, show message
  if (reportData.length === 0) {
    return (
      <div className="metrics-heatmap-empty">No performance data available</div>
    );
  }

  // Get min and max values for the selected metric
  const {min, max} = getMetricMinMax();
  const metricUnit = getMetricUnit();

  return (
    <div className="metrics-heatmap-container">
      <div className="metrics-heatmap-controls">
        <label htmlFor="metric-select">Metric:</label>
        <select
          id="metric-select"
          value={selectedMetric}
          onChange={(e) => setSelectedMetric(e.target.value)}
          className="metric-select"
        >
          {metricOptions.map((option) => (
            <option key={option.name} value={option.name}>
              {option.displayName}
            </option>
          ))}
        </select>

        <div className="heatmap-legend">
          <div className="legend-label">Good</div>
          <div className="legend-gradient"></div>
          <div className="legend-label">Bad</div>
          <div className="legend-value">
            Range: {formatMetricValue(min, metricUnit)} -{" "}
            {formatMetricValue(max, metricUnit)}
          </div>
        </div>
      </div>

      <div className="heatmap-scroll-container">
        <table className="metrics-heatmap-table">
          <thead>
            <tr>
              <th className="heatmap-scenario-header">Scenario</th>
              {reportData.map((report) => (
                <th
                  key={report.id}
                  className={`heatmap-date-header ${
                    report.id === activeReportId ? "active-report" : ""
                  }`}
                >
                  {formatDate(report.date)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenarioNames.map((scenarioName) => (
              <tr key={scenarioName}>
                <td className="heatmap-scenario-name">
                  {formatScenarioName(scenarioName)}
                </td>
                {reportData.map((report) => {
                  const scenario = report.scenarios.find(
                    (s) => s.name === scenarioName
                  );
                  const metric = scenario?.metrics.find(
                    (m) => m.name === selectedMetric
                  );

                  return (
                    <td
                      key={`${report.id}-${scenarioName}`}
                      className={`heatmap-cell ${
                        report.id === activeReportId ? "active-report" : ""
                      }`}
                      style={
                        metric
                          ? {
                              backgroundColor: getColorForValue(
                                metric.value,
                                min,
                                max,
                                selectedMetric
                              ),
                              color:
                                metric.value > (min + max) / 2
                                  ? "white"
                                  : "black",
                            }
                          : {}
                      }
                      title={
                        metric
                          ? `${formatScenarioName(scenarioName)}\n${
                              metricOptions.find(
                                (m) => m.name === selectedMetric
                              )?.displayName || selectedMetric
                            }: ${formatMetricValue(metric.value, metric.unit)}`
                          : "No data"
                      }
                    >
                      {metric
                        ? formatMetricValue(metric.value, metric.unit)
                        : "N/A"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// PerformanceChangeDashboard component to display performance changes between reports
const PerformanceChangeDashboard = ({
  reports,
  activeReportId,
}: {
  reports: PerformanceReport[];
  activeReportId: string | null;
}) => {
  const [reportData, setReportData] = useState<PerformanceReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [baselineReportId, setBaselineReportId] = useState<string | null>(null);
  const [keyMetrics] = useState<string[]>([
    "percentCPUUsage",
    "jsHeapUsedSize",
    "appStartupTime",
    "timeToInteractive",
    "scriptDuration",
    "layoutDuration",
  ]);

  // Load full report data for all reports
  useEffect(() => {
    if (!reports || reports.length < 2) return;

    const fetchAllReports = async () => {
      setIsLoading(true);

      try {
        // Fetch full report data for each report
        const fullReports = await Promise.all(
          reports.map(async (report) => {
            const fullReport = await loadReportById(report.id);
            return fullReport;
          })
        );

        // Filter out null reports
        const validReports = fullReports.filter(Boolean) as PerformanceReport[];

        if (validReports.length > 0) {
          // Sort reports by date (newest first)
          validReports.sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          );

          // Set a default baseline if needed - pick the next report after the active one
          // or if the active report is the baseline, pick the first non-active report
          if (validReports.length > 1 && !baselineReportId) {
            // Find the index of the active report
            const activeIndex = validReports.findIndex(
              (r) => r.id === activeReportId
            );

            if (activeIndex === -1 || activeIndex === validReports.length - 1) {
              // If active report not found or is the last one, use the first report as baseline
              setBaselineReportId(
                validReports[0].id !== activeReportId
                  ? validReports[0].id
                  : validReports[1].id
              );
            } else {
              // Use the next report in the list as baseline
              setBaselineReportId(validReports[activeIndex + 1].id);
            }
          }
        }

        setReportData(validReports);
      } catch (error) {
        console.error("Error loading full report data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllReports();
  }, [reports, baselineReportId, activeReportId]);

  // Format date for display
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).format(date);
  };

  // Format scenario name for display
  const formatScenarioName = (name: string): string => {
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Format metric name for display
  const formatMetricName = (name: string): string => {
    // Dictionary of common metric names
    const metricNames: Record<string, string> = {
      percentCPUUsage: "CPU Usage",
      jsHeapUsedSize: "Memory Usage",
      appStartupTime: "App Startup Time",
      timeToInteractive: "Time to Interactive",
      scriptDuration: "Script Duration",
      layoutDuration: "Layout Duration",
      recalcStyleDuration: "Style Recalc Duration",
      paintDuration: "Paint Duration",
    };

    return (
      metricNames[name] ||
      name
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (str) => str.toUpperCase())
        .replace(/([a-z])([A-Z])/g, "$1 $2")
    );
  };

  // Format percent change
  const formatChange = (change: number): string => {
    const prefix = change > 0 ? "+" : "";
    return `${prefix}${change.toFixed(1)}%`;
  };

  // Get color based on change value and metric type
  const getChangeColor = (change: number, metricName: string): string => {
    // For most metrics, negative change is good (lower is better)
    let isImprovement = change < 0;

    // For some metrics, higher is better
    const higherIsBetter = ["performanceScore"].includes(metricName);
    if (higherIsBetter) {
      isImprovement = change > 0;
    }

    // Determine severity of change
    const absChange = Math.abs(change);

    if (isImprovement) {
      // Improvement: green with varying intensity
      if (absChange < 5) return "#4caf50"; // Light green
      if (absChange < 15) return "#2e7d32"; // Medium green
      return "#1b5e20"; // Dark green (significant improvement)
    } else {
      // Regression: amber to red
      if (absChange < 5) return "#ffca28"; // Amber (slight regression)
      if (absChange < 15) return "#f57c00"; // Orange (moderate regression)
      return "#d32f2f"; // Red (significant regression)
    }
  };

  // Calculate change between two values
  const calculateChange = (current: number, baseline: number): number => {
    if (baseline === 0) return 0;
    return ((current - baseline) / baseline) * 100;
  };

  // Get the current report based on activeReportId
  const getCurrentReport = (): PerformanceReport | null => {
    if (!activeReportId || reportData.length === 0) return null;
    return reportData.find((report) => report.id === activeReportId) || null;
  };

  // Get the baseline report
  const getBaselineReport = (): PerformanceReport | null => {
    if (!baselineReportId || reportData.length === 0) return null;
    return reportData.find((report) => report.id === baselineReportId) || null;
  };

  // If loading, show loading indicator
  if (isLoading) {
    return (
      <div className="performance-change-loading">
        Loading performance data...
      </div>
    );
  }

  // If no report data or insufficient data, show message
  if (reportData.length < 2) {
    return (
      <div className="performance-change-empty">
        Need at least two performance reports to compare changes
      </div>
    );
  }

  const currentReport = getCurrentReport();
  const baselineReport = getBaselineReport();

  if (!currentReport || !baselineReport) {
    return (
      <div className="performance-change-empty">Unable to compare reports</div>
    );
  }

  // Get all unique scenario names from both reports
  const scenarioNames = new Set<string>();
  currentReport.scenarios.forEach((scenario) =>
    scenarioNames.add(scenario.name)
  );
  baselineReport.scenarios.forEach((scenario) =>
    scenarioNames.add(scenario.name)
  );

  // Create a list of possible baseline reports (excluding the current report)
  const baselineOptions = reportData.filter(
    (report) => report.id !== activeReportId
  );

  return (
    <div className="performance-change-container">
      <div className="performance-change-header">
        <div className="change-report-info">
          <div className="current-report">
            <span className="report-label">Current:</span>
            <span className="report-date">
              {formatDate(currentReport.date)}
            </span>
          </div>
          <div className="vs-indicator">vs</div>
          <div className="baseline-selector">
            <label htmlFor="baseline-select">Baseline:</label>
            <select
              id="baseline-select"
              value={baselineReportId || ""}
              onChange={(e) => setBaselineReportId(e.target.value)}
              className="baseline-select"
            >
              {baselineOptions.map((report) => (
                <option key={report.id} value={report.id}>
                  {formatDate(report.date)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="change-legend">
          <div className="change-legend-item">
            <span
              className="legend-color"
              style={{backgroundColor: "#1b5e20"}}
            ></span>
            <span className="legend-label">Better</span>
          </div>
          <div className="change-legend-item">
            <span
              className="legend-color"
              style={{backgroundColor: "#ffca28"}}
            ></span>
            <span className="legend-label">Slight Regression</span>
          </div>
          <div className="change-legend-item">
            <span
              className="legend-color"
              style={{backgroundColor: "#d32f2f"}}
            ></span>
            <span className="legend-label">Significant Regression</span>
          </div>
        </div>
      </div>

      <div className="performance-changes-grid">
        {Array.from(scenarioNames)
          .sort()
          .map((scenarioName) => {
            const currentScenario = currentReport.scenarios.find(
              (s) => s.name === scenarioName
            );
            const baselineScenario = baselineReport.scenarios.find(
              (s) => s.name === scenarioName
            );

            // Skip if scenario doesn't exist in either report
            if (!currentScenario || !baselineScenario) return null;

            return (
              <div key={scenarioName} className="scenario-change-card">
                <h3 className="scenario-change-name">
                  {formatScenarioName(scenarioName)}
                </h3>
                <div className="metric-changes">
                  {keyMetrics.map((metricName) => {
                    const currentMetric = currentScenario.metrics.find(
                      (m) => m.name === metricName
                    );
                    const baselineMetric = baselineScenario.metrics.find(
                      (m) => m.name === metricName
                    );

                    // Skip if metric doesn't exist in either scenario
                    if (!currentMetric || !baselineMetric) return null;

                    const change = calculateChange(
                      currentMetric.value,
                      baselineMetric.value
                    );
                    const changeColor = getChangeColor(change, metricName);

                    // Format the values based on unit
                    const formatValue = (
                      value: number,
                      unit: string
                    ): string => {
                      if (unit === "bytes") return formatBytes(value);
                      if (unit === "%") return `${value.toFixed(1)}${unit}`;
                      if (unit === "ms") {
                        if (value < 1) return `${(value * 1000).toFixed(2)}μs`;
                        if (value >= 1000)
                          return `${(value / 1000).toFixed(2)}s`;
                        return `${Math.round(value)}${unit}`;
                      }
                      return `${value.toLocaleString()}${unit}`;
                    };

                    return (
                      <div key={metricName} className="metric-change-item">
                        <div className="metric-change-name">
                          {formatMetricName(metricName)}
                        </div>
                        <div className="metric-values">
                          <div className="metric-current-value">
                            {formatValue(
                              currentMetric.value,
                              currentMetric.unit
                            )}
                          </div>
                          <div
                            className="metric-change-indicator"
                            style={{color: changeColor}}
                          >
                            {formatChange(change)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};

function App() {
  const [reports, setReports] = useState<PerformanceReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [activeReport, setActiveReport] = useState<PerformanceReport | null>(
    null
  );
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "memory" | "performance" | "heatmap" | "changes"
  >("overview");

  // Load reports
  useEffect(() => {
    const fetchReports = async () => {
      try {
        setIsLoading(true);
        const fetchedReports = await loadPerformanceReports();
        setReports(fetchedReports);

        // Auto-select most recent report
        if (fetchedReports.length > 0) {
          setActiveReportId(fetchedReports[0].id);
        }
      } catch (err) {
        setError("Failed to load performance reports");
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchReports();
  }, []);

  // Load active report when ID changes
  useEffect(() => {
    const fetchReport = async () => {
      if (!activeReportId) return;

      try {
        setIsLoading(true);
        const report = await loadReportById(activeReportId);
        setActiveReport(report);

        // Auto-select first scenario
        if (report && report.scenarios.length > 0) {
          setSelectedScenario(report.scenarios[0].name);
        }
      } catch (err) {
        setError(`Failed to load report ${activeReportId}`);
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchReport();
  }, [activeReportId]);

  // Format a date in a readable way
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    }).format(date);
  };

  // Format metric values with appropriate units
  const formatMetricValue = (value: number, unit: string): string => {
    // Special case for bytes - convert to KB, MB, GB as appropriate
    if (unit === "bytes") {
      return formatBytes(value);
    }

    // For percentages, format with fixed decimal places
    if (unit === "%") {
      return `${value.toFixed(1)}${unit}`;
    }

    // For time measurements (ms), format appropriately
    if (unit === "ms") {
      if (value < 1) {
        return `${(value * 1000).toFixed(2)}μs`;
      }
      if (value >= 1000) {
        return `${(value / 1000).toFixed(2)}s`;
      }
      return `${Math.round(value)}${unit}`;
    }

    // Default formatting - add the unit to the value
    if (unit) {
      return `${value.toLocaleString()}${unit}`;
    }

    // Just return the value if no unit
    return value.toLocaleString();
  };

  // Helper function to determine if a metric value should be considered concerning
  const isConcerningMetric = (metricName: string, value: number): boolean => {
    const thresholds: Record<string, number> = {
      timeToInteractive: 3000, // ms
      appStartupTime: 500, // ms
      scriptDuration: 50, // ms
      layoutDuration: 30, // ms
      jsHeapUsedSize: 50 * 1024 * 1024, // 50MB in bytes
      percentCPUUsage: 50, // percent
    };

    if (!(metricName in thresholds)) return false;
    return value > thresholds[metricName];
  };

  // Transform metrics data for the dashboard
  const transformMetricsData = () => {
    if (
      !activeReport ||
      !activeReport.scenarios ||
      activeReport.scenarios.length === 0
    ) {
      return {sections: [], memoryData: [], cpuData: [], scriptData: []};
    }

    const sections = activeReport.scenarios.map((scenario) => scenario.name);

    // Memory chart data
    const memoryData = activeReport.scenarios.map((scenario) => {
      const heapUsed =
        scenario.metrics.find((m) => m.name === "jsHeapUsedSize")?.value || 0;
      const heapTotal =
        scenario.metrics.find((m) => m.name === "jsHeapTotalSize")?.value || 0;

      return {
        name: formatScenarioName(scenario.name),
        memory: heapUsed,
        total: heapTotal,
      };
    });

    // CPU chart data
    const cpuData = activeReport.scenarios.map((scenario) => {
      const cpuUsage =
        scenario.metrics.find((m) => m.name === "percentCPUUsage")?.value || 0;

      return {
        name: formatScenarioName(scenario.name),
        cpu: cpuUsage,
      };
    });

    // Script, layout, and style data
    const scriptData = activeReport.scenarios.map((scenario) => {
      const scriptDuration =
        scenario.metrics.find((m) => m.name === "scriptDuration")?.value || 0;
      const layoutDuration =
        scenario.metrics.find((m) => m.name === "layoutDuration")?.value || 0;
      const styleDuration =
        scenario.metrics.find(
          (m) => m.name === "recalcStyleDuration" || "styleRecalcDuration"
        )?.value || 0;

      return {
        name: formatScenarioName(scenario.name),
        script: scriptDuration * 1000, // Convert to ms
        layout: layoutDuration * 1000,
        style: styleDuration * 1000,
      };
    });

    return {sections, memoryData, cpuData, scriptData};
  };

  // Helper to format scenario names for display
  const formatScenarioName = (name: string): string => {
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Get all metrics for a given scenario
  const getScenarioMetrics = (scenarioName: string): ScenarioResult | null => {
    if (!activeReport) return null;

    return activeReport.scenarios.find((s) => s.name === scenarioName) || null;
  };

  // Get average values for key metrics across all scenarios
  const getAverageMetrics = () => {
    if (
      !activeReport ||
      !activeReport.scenarios ||
      activeReport.scenarios.length === 0
    ) {
      return {
        avgMemoryUsage: 0,
        avgCpuUsage: 0,
        maxMemoryUsage: 0,
        maxTotalMemory: 0,
        avgMemoryPercentage: 0,
      };
    }

    let totalMemory = 0;
    let totalCpu = 0;
    let maxMemory = 0;
    let maxTotal = 0;
    let count = 0;

    activeReport.scenarios.forEach((scenario) => {
      const memoryMetric = scenario.metrics.find(
        (m) => m.name === "jsHeapUsedSize"
      );
      const totalMemoryMetric = scenario.metrics.find(
        (m) => m.name === "jsHeapTotalSize"
      );
      const cpuMetric = scenario.metrics.find(
        (m) => m.name === "percentCPUUsage"
      );

      if (memoryMetric) {
        totalMemory += memoryMetric.value;
        maxMemory = Math.max(maxMemory, memoryMetric.value);
        count++;
      }

      if (totalMemoryMetric) {
        maxTotal = Math.max(maxTotal, totalMemoryMetric.value);
      }

      if (cpuMetric) {
        totalCpu += cpuMetric.value;
      }
    });

    const avgMemory = count > 0 ? totalMemory / count : 0;
    const avgCpu = count > 0 ? totalCpu / count : 0;
    const avgMemoryPercentage = maxTotal > 0 ? (avgMemory / maxTotal) * 100 : 0;

    return {
      avgMemoryUsage: avgMemory,
      avgCpuUsage: avgCpu,
      maxMemoryUsage: maxMemory,
      maxTotalMemory: maxTotal,
      avgMemoryPercentage,
    };
  };

  // Get startup-specific metrics
  const getStartupMetrics = () => {
    if (!activeReport) return null;

    const startupScenario = activeReport.scenarios.find(
      (s) => s.name === "app-startup"
    );
    if (!startupScenario) return null;

    // Map of metric names to values
    const metrics: Record<string, {value: number; unit: string}> = {};

    startupScenario.metrics.forEach((metric) => {
      metrics[metric.name] = {
        value: metric.value,
        unit: metric.unit,
      };
    });

    return metrics;
  };

  // Get concerning metrics across scenarios
  const getConcerningMetrics = () => {
    if (!activeReport) return [];

    const concerns: {
      scenario: string;
      metric: string;
      value: number;
      unit: string;
    }[] = [];

    activeReport.scenarios.forEach((scenario) => {
      scenario.metrics.forEach((metric) => {
        if (isConcerningMetric(metric.name, metric.value)) {
          concerns.push({
            scenario: scenario.name,
            metric: metric.name,
            value: metric.value,
            unit: metric.unit,
          });
        }
      });
    });

    return concerns;
  };

  // Find the most appropriate icon for a metric
  const getMetricIcon = (metricName: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      timeToInteractive: <Icons.Clock size={20} />,
      appStartupTime: <Icons.Zap size={20} />,
      scriptDuration: <Icons.Activity size={20} />,
      layoutDuration: <Icons.LayoutPanelLeft size={20} />,
      jsHeapUsedSize: <Icons.HardDrive size={20} />,
      percentCPUUsage: <Icons.Cpu size={20} />,
      taskDuration: <Icons.Activity size={20} />,
      performanceScore: <Icons.Gauge size={20} />,
    };

    return iconMap[metricName] || <Icons.Activity size={20} />;
  };

  // Get formatted display name for a metric
  const getMetricDisplayName = (metricName: string): string => {
    const displayNames: Record<string, string> = {
      timeToInteractive: "Time to Interactive",
      appStartupTime: "App Startup Time",
      scriptDuration: "Script Duration",
      layoutDuration: "Layout Duration",
      jsHeapUsedSize: "JS Heap Used",
      percentCPUUsage: "CPU Usage",
      taskDuration: "Task Duration",
      styleRecalcDuration: "Style Recalc Duration",
      recalcStyleDuration: "Style Recalc Duration",
      paintDuration: "Paint Duration",
      performanceScore: "Performance Score",
    };

    return (
      displayNames[metricName] ||
      metricName
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (str) => str.toUpperCase())
        .replace(/([a-z])([A-Z])/g, "$1 $2")
    );
  };

  // Render loading state
  if (isLoading && !activeReport) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-gray-500">
          Loading Electron performance data...
        </div>
      </div>
    );
  }

  // Render error state
  if (error && !activeReport) {
    return (
      <div className="p-4 bg-red-50 rounded-lg">
        <div className="text-red-700">{error}</div>
        <div className="text-red-600 text-sm mt-1">
          Check that performance test results exist and are accessible.
        </div>
      </div>
    );
  }

  // Case where no reports are found
  if (reports.length === 0) {
    return (
      <div className="p-4 bg-yellow-50 rounded-lg">
        <div className="text-yellow-800">
          No electron performance test results found.
        </div>
        <div className="text-yellow-700 text-sm mt-1">
          Run performance tests to generate data for the dashboard.
        </div>
      </div>
    );
  }

  // Get our transformed data for the dashboard
  const {memoryData, cpuData, scriptData} = transformMetricsData();
  const averages = getAverageMetrics();
  const startupMetrics = getStartupMetrics();
  const concerningMetrics = getConcerningMetrics();

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Electron Performance Dashboard
            </h2>
            <p className="text-gray-500 mb-6">
              Latest results from {new Date(reports[0].date).toLocaleString()}
            </p>
          </div>
          {reports.length > 0 && (
            <div className="report-selector flex items-center gap-2">
              <label htmlFor="report-select" className="text-gray-600">
                Report:
              </label>
              <select
                id="report-select"
                value={activeReportId || ""}
                onChange={(e) => setActiveReportId(e.target.value)}
                className="border rounded-md py-1 px-2 text-sm"
              >
                {reports.map((report) => (
                  <option key={report.id} value={report.id}>
                    {formatDate(report.date)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <main className="dashboard-content">
          <div className="tabs">
            <div className="tabs-header">
              <button
                className={`tab-button ${
                  activeTab === "overview" ? "active" : ""
                }`}
                onClick={() => setActiveTab("overview")}
              >
                Overview
              </button>
              <button
                className={`tab-button ${
                  activeTab === "memory" ? "active" : ""
                }`}
                onClick={() => setActiveTab("memory")}
              >
                Memory
              </button>
              <button
                className={`tab-button ${
                  activeTab === "performance" ? "active" : ""
                }`}
                onClick={() => setActiveTab("performance")}
              >
                Performance
              </button>
              <button
                className={`tab-button ${
                  activeTab === "heatmap" ? "active" : ""
                }`}
                onClick={() => setActiveTab("heatmap")}
              >
                Heatmap
              </button>
              <button
                className={`tab-button ${
                  activeTab === "changes" ? "active" : ""
                }`}
                onClick={() => setActiveTab("changes")}
              >
                Changes
              </button>
            </div>

            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="tab-content">
                {/* Key Metrics Card Row */}
                <div className="metric-summary">
                  <div className="metric-card">
                    <div className="metric-card-content">
                      <div className="metric-card-icon">
                        <Icons.Cpu />
                      </div>
                      <div className="metric-card-info">
                        <h3 className="metric-card-title">CPU Usage</h3>
                        <div className="metric-card-value">
                          {averages.avgCpuUsage.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                    <div className="metric-card-progress">
                      <div
                        className="metric-card-progress-bar"
                        style={{
                          width: `${Math.min(100, averages.avgCpuUsage)}%`,
                          backgroundColor:
                            averages.avgCpuUsage > 70
                              ? "var(--color-danger)"
                              : "var(--color-primary)",
                        }}
                      ></div>
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-card-content">
                      <div className="metric-card-icon">
                        <Icons.HardDrive />
                      </div>
                      <div className="metric-card-info">
                        <h3 className="metric-card-title">Memory Usage</h3>
                        <div className="metric-card-value">
                          {formatBytes(averages.avgMemoryUsage)} /{" "}
                          {formatBytes(averages.maxTotalMemory)}
                        </div>
                      </div>
                    </div>
                    <div className="metric-card-progress">
                      <div
                        className="metric-card-progress-bar"
                        style={{
                          width: `${Math.min(
                            100,
                            averages.avgMemoryPercentage
                          )}%`,
                          backgroundColor:
                            averages.avgMemoryPercentage > 70
                              ? "var(--color-danger)"
                              : "var(--color-primary)",
                        }}
                      ></div>
                    </div>
                  </div>

                  {startupMetrics && startupMetrics.appStartupTime && (
                    <div className="metric-card">
                      <div className="metric-card-content">
                        <div className="metric-card-icon">
                          <Icons.Zap />
                        </div>
                        <div className="metric-card-info">
                          <h3 className="metric-card-title">Startup Time</h3>
                          <div className="metric-card-value">
                            {formatMetricValue(
                              startupMetrics.appStartupTime.value,
                              startupMetrics.appStartupTime.unit
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="metric-card-progress">
                        <div
                          className="metric-card-progress-bar"
                          style={{
                            width: `${Math.min(
                              100,
                              (startupMetrics.appStartupTime.value / 1000) * 100
                            )}%`,
                            backgroundColor:
                              startupMetrics.appStartupTime.value > 500
                                ? "var(--color-danger)"
                                : "var(--color-primary)",
                          }}
                        ></div>
                      </div>
                    </div>
                  )}

                  <div className="metric-card">
                    <div className="metric-card-content">
                      <div className="metric-card-icon">
                        <Icons.Calendar />
                      </div>
                      <div className="metric-card-info">
                        <h3 className="metric-card-title">Report Date</h3>
                        <div className="metric-card-value">
                          {activeReport && formatDate(activeReport.date)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Performance Concerns */}
                {concerningMetrics.length > 0 && (
                  <div className="dashboard-card issues-card">
                    <h2 className="card-title">
                      <Icons.AlertTriangle
                        size={20}
                        className="card-title-icon"
                      />
                      Performance Concerns
                    </h2>
                    <div className="card-content">
                      <div className="issues-list">
                        {concerningMetrics.map((issue, index) => (
                          <div key={index} className="issue-item">
                            <div className="issue-content">
                              <div className="issue-scenario">
                                {formatScenarioName(issue.scenario)}
                              </div>
                              <div className="issue-metric">
                                {getMetricDisplayName(issue.metric)}:
                                <span className="issue-value">
                                  {formatMetricValue(issue.value, issue.unit)}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Scenarios Overview */}
                <div className="dashboard-card">
                  <h2 className="card-title">
                    <Icons.Activity className="card-title-icon" />
                    Scenarios Overview
                  </h2>
                  <div className="card-content">
                    <div className="scenarios-grid">
                      {activeReport &&
                        activeReport.scenarios.map((scenario) => (
                          <div
                            key={scenario.name}
                            className="scenario-card"
                            onClick={() => {
                              setSelectedScenario(scenario.name);
                              setActiveTab("performance");
                            }}
                          >
                            <h3 className="scenario-name">
                              {formatScenarioName(scenario.name)}
                            </h3>
                            <div className="scenario-metrics">
                              {scenario.metrics.slice(0, 4).map((metric) => (
                                <div
                                  key={metric.name}
                                  className="scenario-metric-item"
                                >
                                  <div className="scenario-metric-info">
                                    <span className="scenario-metric-icon">
                                      {getMetricIcon(metric.name)}
                                    </span>
                                    <span className="scenario-metric-name">
                                      {getMetricDisplayName(metric.name)}
                                    </span>
                                  </div>
                                  <span
                                    className={`scenario-metric-value ${
                                      isConcerningMetric(
                                        metric.name,
                                        metric.value
                                      )
                                        ? "value-danger"
                                        : ""
                                    }`}
                                  >
                                    {formatMetricValue(
                                      metric.value,
                                      metric.unit
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Memory Tab */}
            {activeTab === "memory" && (
              <div className="tab-content">
                <div className="dashboard-card">
                  <h2 className="card-title">
                    <Icons.HardDrive className="card-title-icon" />
                    Memory Usage
                  </h2>
                  <div className="card-content">
                    <div className="memory-summary">
                      <div className="memory-stat">
                        <h3 className="memory-stat-title">
                          Average Memory Usage
                        </h3>
                        <div className="memory-stat-value">
                          {formatBytes(averages.avgMemoryUsage)}
                        </div>
                      </div>
                      <div className="memory-stat">
                        <h3 className="memory-stat-title">Peak Memory Usage</h3>
                        <div className="memory-stat-value">
                          {formatBytes(averages.maxMemoryUsage)}
                        </div>
                      </div>
                      <div className="memory-stat">
                        <h3 className="memory-stat-title">
                          Total Available Memory
                        </h3>
                        <div className="memory-stat-value">
                          {formatBytes(averages.maxTotalMemory)}
                        </div>
                      </div>
                      <div className="memory-stat">
                        <h3 className="memory-stat-title">
                          Memory Usage Percent
                        </h3>
                        <div className="memory-stat-value">
                          {averages.avgMemoryPercentage.toFixed(1)}%
                        </div>
                      </div>
                    </div>

                    <div className="memory-chart">
                      {/* Memory Data Visualization */}
                      <div className="memory-bars">
                        {memoryData.map((item, index) => (
                          <div key={index} className="memory-bar-container">
                            <div className="memory-bar-label">{item.name}</div>
                            <div className="memory-bar-wrapper">
                              <div
                                className="memory-bar"
                                style={{
                                  width: `${
                                    (item.memory / averages.maxTotalMemory) *
                                    100
                                  }%`,
                                }}
                              ></div>
                            </div>
                            <div className="memory-bar-value">
                              {formatBytes(item.memory)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="dashboard-card">
                  <h2 className="card-title">
                    <Icons.Cpu className="card-title-icon" />
                    CPU Usage by Scenario
                  </h2>
                  <div className="card-content">
                    <div className="cpu-chart">
                      <div className="cpu-bars">
                        {cpuData.map((item, index) => (
                          <div key={index} className="cpu-bar-container">
                            <div className="cpu-bar-label">{item.name}</div>
                            <div className="cpu-bar-wrapper">
                              <div
                                className="cpu-bar"
                                style={{
                                  width: `${Math.min(100, item.cpu)}%`,
                                  backgroundColor:
                                    item.cpu > 70
                                      ? "var(--color-danger)"
                                      : "var(--color-primary)",
                                }}
                              ></div>
                            </div>
                            <div className="cpu-bar-value">
                              {item.cpu.toFixed(1)}%
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Performance Tab */}
            {activeTab === "performance" && (
              <div className="tab-content">
                <div className="dashboard-card">
                  <div className="scenario-selector">
                    <h2 className="card-title">
                      <Icons.Activity className="card-title-icon" />
                      Scenario Details
                    </h2>
                    <select
                      className="scenario-select"
                      value={selectedScenario || ""}
                      onChange={(e) => setSelectedScenario(e.target.value)}
                    >
                      {activeReport &&
                        activeReport.scenarios.map((scenario) => (
                          <option key={scenario.name} value={scenario.name}>
                            {formatScenarioName(scenario.name)}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="card-content">
                    {selectedScenario &&
                      getScenarioMetrics(selectedScenario) && (
                        <div className="selected-scenario-metrics">
                          <div className="metric-grid">
                            {getScenarioMetrics(selectedScenario)?.metrics.map(
                              (metric) => (
                                <div
                                  key={metric.name}
                                  className={`detailed-metric-card ${
                                    isConcerningMetric(
                                      metric.name,
                                      metric.value
                                    )
                                      ? "metric-concerning"
                                      : "metric-ok"
                                  }`}
                                >
                                  <div className="detailed-metric-header">
                                    <div className="detailed-metric-icon">
                                      {getMetricIcon(metric.name)}
                                    </div>
                                    <div className="detailed-metric-name">
                                      {getMetricDisplayName(metric.name)}
                                    </div>
                                  </div>
                                  <div className="detailed-metric-value">
                                    {formatMetricValue(
                                      metric.value,
                                      metric.unit
                                    )}
                                  </div>
                                  {metric.description && (
                                    <div className="detailed-metric-description">
                                      {metric.description}
                                    </div>
                                  )}
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                </div>

                <div className="dashboard-card">
                  <h2 className="card-title">
                    <Icons.Clock className="card-title-icon" />
                    Duration Metrics
                  </h2>
                  <div className="card-content">
                    <div className="duration-chart">
                      <div className="duration-bars">
                        {scriptData.map((item, index) => (
                          <div key={index} className="duration-section">
                            <div className="duration-section-header">
                              <div className="duration-section-title">
                                {item.name}
                              </div>
                            </div>
                            <div className="duration-metrics">
                              <div className="duration-metric">
                                <div className="duration-metric-name">
                                  Script
                                </div>
                                <div className="duration-bar-wrapper">
                                  <div
                                    className="duration-bar script-bar"
                                    style={{
                                      width: `${Math.min(
                                        100,
                                        item.script / 10
                                      )}%`,
                                    }}
                                  ></div>
                                </div>
                                <div className="duration-metric-value">
                                  {item.script.toFixed(2)}ms
                                </div>
                              </div>
                              <div className="duration-metric">
                                <div className="duration-metric-name">
                                  Layout
                                </div>
                                <div className="duration-bar-wrapper">
                                  <div
                                    className="duration-bar layout-bar"
                                    style={{
                                      width: `${Math.min(
                                        100,
                                        item.layout / 10
                                      )}%`,
                                    }}
                                  ></div>
                                </div>
                                <div className="duration-metric-value">
                                  {item.layout.toFixed(2)}ms
                                </div>
                              </div>
                              <div className="duration-metric">
                                <div className="duration-metric-name">
                                  Style
                                </div>
                                <div className="duration-bar-wrapper">
                                  <div
                                    className="duration-bar style-bar"
                                    style={{
                                      width: `${Math.min(
                                        100,
                                        item.style / 10
                                      )}%`,
                                    }}
                                  ></div>
                                </div>
                                <div className="duration-metric-value">
                                  {item.style.toFixed(2)}ms
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Heatmap Tab */}
            {activeTab === "heatmap" && (
              <div className="tab-content">
                <div className="tab-header">
                  <h2 className="tab-title">Performance Metrics Heatmap</h2>
                  <p className="tab-description">
                    View how each metric performs across different scenarios and
                    reports. Colors indicate performance: green is good, red is
                    concerning. Select different metrics using the dropdown to
                    explore various performance aspects.
                  </p>
                </div>
                <MetricHeatmap
                  reports={reports}
                  activeReportId={activeReportId}
                />
              </div>
            )}

            {/* Changes Tab */}
            {activeTab === "changes" && (
              <div className="tab-content">
                <div className="tab-header">
                  <h2 className="tab-title">Performance Changes Dashboard</h2>
                  <p className="tab-description">
                    Compare the latest report with a baseline to see performance
                    improvements or regressions. Changes are highlighted: green
                    is better, yellow/red indicates regression. You can select
                    different baseline reports to compare against.
                  </p>
                </div>
                <PerformanceChangeDashboard
                  reports={reports}
                  activeReportId={activeReportId}
                />
              </div>
            )}
          </div>
        </main>

        <footer className="dashboard-footer">
          <div className="footer-content">
            Performance Dashboard © {new Date().getFullYear()} • Desktop
            Application Performance Metrics
          </div>
        </footer>
      </div>
    </div>
  );
}

export default App;

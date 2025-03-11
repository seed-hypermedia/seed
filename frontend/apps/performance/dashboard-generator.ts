import * as fs from "fs";
import * as path from "path";
import {PerformanceMetrics} from "./perf-utils";

interface DashboardData {
  timestamp: string;
  metrics: Record<string, PerformanceMetrics>;
  platform: string;
  arch: string;
}

/**
 * Generate report.json files for the React dashboard
 */
export function generateReportJsonFiles(metricsFiles: string[]): void {
  metricsFiles.forEach((file) => {
    try {
      // Read the metrics file
      const content = fs.readFileSync(file, "utf-8");
      const data = JSON.parse(content) as DashboardData;

      // Create a report ID from the filename
      const reportId = path
        .basename(file, ".json")
        .replace("perf-metrics-", "");

      // Create the report directory if it doesn't exist
      const reportDir = path.join(path.dirname(file), reportId);
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, {recursive: true});
      }

      // Create traces directory if it doesn't exist
      const tracesDir = path.join(reportDir, "traces");
      if (!fs.existsSync(tracesDir)) {
        fs.mkdirSync(tracesDir, {recursive: true});
      }

      // Create screenshots directory if it doesn't exist
      const screenshotsDir = path.join(reportDir, "screenshots");
      if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, {recursive: true});
      }

      // Transform the data into the format expected by the dashboard
      const scenarios = Object.entries(data.metrics).map(([name, metrics]) => {
        return {
          name,
          timestamp: data.timestamp,
          metrics: Object.entries(metrics).map(([metricName, value]) => {
            // Handle both simple values and complex objects
            if (typeof value === "object" && value !== null) {
              return {
                name: metricName,
                value: value.value || 0,
                unit: value.unit || "",
                description: value.description || "",
                threshold: value.threshold,
              };
            } else {
              return {
                name: metricName,
                value: typeof value === "number" ? value : 0,
                unit: "",
                description: "",
              };
            }
          }),
          traces: [], // We'll need to copy trace files if they exist
          screenshots: [], // We'll need to copy screenshot files if they exist
        };
      });

      // Create the report.json file
      const reportJson = {
        id: reportId,
        date: data.timestamp,
        scenarios,
        summary: {
          totalScenarios: scenarios.length,
          passedBudgets: 0,
          failedBudgets: 0,
        },
      };

      // Count passed and failed budgets
      scenarios.forEach((scenario) => {
        scenario.metrics.forEach((metric) => {
          if (metric.threshold) {
            if (metric.value <= metric.threshold) {
              reportJson.summary.passedBudgets++;
            } else {
              reportJson.summary.failedBudgets++;
            }
          }
        });
      });

      // Write the report.json file
      fs.writeFileSync(
        path.join(reportDir, "report.json"),
        JSON.stringify(reportJson, null, 2),
        "utf-8"
      );

      console.log(`Created report.json for ${reportId}`);
    } catch (error) {
      console.error(`Error creating report.json for ${file}:`, error);
    }
  });
}

/**
 * Generate an HTML dashboard from performance metrics
 */
export function generateDashboard(
  metricsFiles: string[],
  outputPath: string
): void {
  // Create directory if it doesn't exist
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true});
  }

  // Generate report.json files for the React dashboard
  generateReportJsonFiles(metricsFiles);

  // Load all metrics files
  const allData: DashboardData[] = metricsFiles.map((file) => {
    const content = fs.readFileSync(file, "utf-8");
    return JSON.parse(content) as DashboardData;
  });

  // Sort by timestamp
  allData.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Create HTML content
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Electron Performance Metrics Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/luxon@3.0.1/build/global/luxon.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-luxon@1.3.0/dist/chartjs-adapter-luxon.min.js"></script>
  <script>
    // Ensure Chart.js knows about the date adapter
    window.addEventListener('DOMContentLoaded', () => {
      // Verify that the adapters are loaded properly
      console.log('Chart.js loaded:', !!window.Chart);
      console.log('Luxon loaded:', !!window.luxon);
      
      // Make sure the adapter is properly registered
      if (window.Chart && window.luxon) {
        console.log('Both Chart.js and Luxon are available');
        
        // Check if the adapter is already registered
        if (!window.Chart.defaults.adapters) {
          console.log('Adapter not found, registering manually');
          
          // Register the adapter manually if needed
          window._adapters = window._adapters || {};
          window._adapters._date = {
            _id: 'luxon',
            formats: function() { return {}; },
            parse: function(value) { 
              return window.luxon.DateTime.fromISO(value).toMillis();
            },
            format: function(time) {
              return window.luxon.DateTime.fromMillis(time).toISO();
            },
            add: function(time, amount, unit) {
              return window.luxon.DateTime.fromMillis(time).plus({ [unit]: amount }).toMillis();
            },
            diff: function(max, min, unit) {
              return window.luxon.DateTime.fromMillis(max)
                .diff(window.luxon.DateTime.fromMillis(min), unit)
                .get(unit);
            },
            startOf: function(time, unit) {
              return window.luxon.DateTime.fromMillis(time).startOf(unit).toMillis();
            },
            endOf: function(time, unit) {
              return window.luxon.DateTime.fromMillis(time).endOf(unit).toMillis();
            }
          };
        } else {
          console.log('Adapter already registered:', window.Chart.defaults.adapters);
        }
      }
    });
  </script>
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
      height: 400px;
      margin-bottom: 40px;
    }
    .metric-card {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .metric-value {
      font-size: 24px;
      font-weight: bold;
      color: #3498db;
    }
    .metric-value-good {
      color: #2ecc71;
    }
    .metric-value-warning {
      color: #f39c12;
    }
    .metric-value-bad {
      color: #e74c3c;
    }
    .platform-badge {
      display: inline-block;
      padding: 5px 10px;
      border-radius: 15px;
      font-size: 12px;
      font-weight: bold;
      margin-right: 10px;
      background: #e0e0e0;
    }
    .tabs {
      display: flex;
      border-bottom: 1px solid #ddd;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .tab {
      padding: 10px 20px;
      cursor: pointer;
      border: 1px solid transparent;
    }
    .tab.active {
      border: 1px solid #ddd;
      border-bottom-color: white;
      border-radius: 5px 5px 0 0;
      margin-bottom: -1px;
      background-color: white;
    }
    .tab-content {
      display: none;
    }
    .tab-content.active {
      display: block;
    }
    .summary-box {
      background: #f0f7ff;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 20px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 12px;
      text-align: left;
    }
    th {
      background-color: #f2f2f2;
    }
    tr:nth-child(even) {
      background-color: #f9f9f9;
    }
    .info-icon {
      display: inline-block;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #3498db;
      color: white;
      text-align: center;
      line-height: 18px;
      font-size: 12px;
      margin-left: 5px;
      cursor: help;
    }
    .tooltip {
      position: relative;
      display: inline-block;
    }
    .tooltip .tooltiptext {
      visibility: hidden;
      width: 200px;
      background-color: #555;
      color: #fff;
      text-align: center;
      border-radius: 6px;
      padding: 5px;
      position: absolute;
      z-index: 1;
      bottom: 125%;
      left: 50%;
      margin-left: -100px;
      opacity: 0;
      transition: opacity 0.3s;
    }
    .tooltip:hover .tooltiptext {
      visibility: visible;
      opacity: 1;
    }
  </style>
</head>
<body>
  <h1>Electron Performance Metrics Dashboard</h1>
  
  <div class="summary-box">
    <h3>Latest Run Summary</h3>
    <p>
      Date: ${new Date(
        allData[allData.length - 1].timestamp
      ).toLocaleString()}<br>
      Platform: ${allData[allData.length - 1].platform}<br>
      Architecture: ${allData[allData.length - 1].arch}
    </p>
  </div>

  <div class="tabs">
    <div class="tab active" data-tab="overview">Overview</div>
    <div class="tab" data-tab="startup">Startup Performance</div>
    <div class="tab" data-tab="navigation">Navigation Performance</div>
    <div class="tab" data-tab="memory">Memory Usage</div>
    <div class="tab" data-tab="cpu">CPU Performance</div>
    <div class="tab" data-tab="javascript">JavaScript Performance</div>
    <div class="tab" data-tab="lighthouse">Lighthouse Metrics</div>
    <div class="tab" data-tab="raw">Raw Data</div>
  </div>

  <div id="overview" class="tab-content active">
    <h2>Performance Trends</h2>
    <div class="chart-container">
      <canvas id="trendsChart"></canvas>
    </div>
    
    <h2>Latest Metrics Summary</h2>
    <div class="metric-grid">
      ${generateLatestMetricsSummary(allData[allData.length - 1])}
    </div>
  </div>

  <div id="startup" class="tab-content">
    <h2>Startup Performance</h2>
    <div class="chart-container">
      <canvas id="startupChart"></canvas>
    </div>
    
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Platform</th>
          <th>Time to Interactive (ms)</th>
          <th>First Paint (ms)</th>
          <th>First Contentful Paint (ms)</th>
          <th>App Startup Time (ms)</th>
        </tr>
      </thead>
      <tbody>
        ${generateStartupTableRows(allData)}
      </tbody>
    </table>
  </div>

  <div id="navigation" class="tab-content">
    <h2>Navigation Performance</h2>
    <div class="chart-container">
      <canvas id="navigationChart"></canvas>
    </div>
    
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Scenario</th>
          <th>Script Duration (ms)</th>
          <th>Layout Duration (ms)</th>
          <th>Style Recalc Duration (ms)</th>
        </tr>
      </thead>
      <tbody>
        ${generateNavigationTableRows(allData)}
      </tbody>
    </table>
  </div>

  <div id="memory" class="tab-content">
    <h2>Memory Usage</h2>
    <div class="chart-container">
      <canvas id="memoryChart"></canvas>
    </div>
    
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Scenario</th>
          <th>JS Heap Used (MB)</th>
          <th>JS Heap Total (MB)</th>
          <th>Usage Ratio</th>
        </tr>
      </thead>
      <tbody>
        ${generateMemoryTableRows(allData)}
      </tbody>
    </table>
  </div>

  <div id="cpu" class="tab-content">
    <h2>CPU Performance</h2>
    <div class="chart-container">
      <canvas id="cpuChart"></canvas>
    </div>
    
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Scenario</th>
          <th>CPU Usage (%)</th>
          <th>Idle Wakeups/sec</th>
          <th>Frame Rate (fps)</th>
        </tr>
      </thead>
      <tbody>
        ${generateCpuTableRows(allData)}
      </tbody>
    </table>
  </div>

  <div id="javascript" class="tab-content">
    <h2>JavaScript Performance</h2>
    <div class="chart-container">
      <canvas id="jsChart"></canvas>
    </div>
    
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Scenario</th>
          <th>Task Duration (ms)</th>
          <th>GC Time (ms)</th>
          <th>GC Time (%)</th>
        </tr>
      </thead>
      <tbody>
        ${generateJsTableRows(allData)}
      </tbody>
    </table>
  </div>

  <div id="lighthouse" class="tab-content">
    <h2>Lighthouse Metrics</h2>
    <div class="chart-container">
      <canvas id="lighthouseChart"></canvas>
    </div>
    
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Performance Score</th>
          <th>First Contentful Paint</th>
          <th>Speed Index</th>
          <th>Largest Contentful Paint</th>
          <th>Total Blocking Time</th>
          <th>Cumulative Layout Shift</th>
        </tr>
      </thead>
      <tbody>
        ${generateLighthouseTableRows(allData)}
      </tbody>
    </table>
  </div>

  <div id="raw" class="tab-content">
    <h2>Raw Data</h2>
    <pre id="rawData" style="overflow-x: auto; background: #f5f5f5; padding: 15px; border-radius: 5px;">
${JSON.stringify(allData, null, 2)}
    </pre>
  </div>

  <script>
    // Tab switching logic
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        // Deactivate all tabs
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        // Activate clicked tab
        tab.classList.add('active');
        const tabId = tab.getAttribute('data-tab');
        document.getElementById(tabId).classList.add('active');
      });
    });

    document.addEventListener('DOMContentLoaded', () => {
      console.log('DOM loaded, Chart.js available:', typeof Chart !== 'undefined');
      console.log('Luxon available:', typeof luxon !== 'undefined');
      console.log('Chart adapter:', Chart.defaults.adapters);
      
      // Check if adapter is registered
      if (!Chart.defaults._adapters._date) {
        console.log('Date adapter not found, registering manually');
        Chart._adapters._date = {
          _id: 'luxon',
          formats: function() { return {}; },
          parse: function(value) { 
            return luxon.DateTime.fromISO(value).toMillis();
          },
          format: function(time, fmt) {
            return luxon.DateTime.fromMillis(time).toISO();
          },
          add: function(time, amount, unit) {
            return luxon.DateTime.fromMillis(time).plus({ [unit]: amount }).toMillis();
          },
          diff: function(max, min, unit) {
            return luxon.DateTime.fromMillis(max).diff(luxon.DateTime.fromMillis(min), unit).toObject()[unit];
          },
          startOf: function(time, unit) {
            return luxon.DateTime.fromMillis(time).startOf(unit).toMillis();
          },
          endOf: function(time, unit) {
            return luxon.DateTime.fromMillis(time).endOf(unit).toMillis();
          }
        };
      }
      
      // Helper function to prepare chart data
      function prepareChartData(data) {
        const timeToInteractive = [];
        const firstContentfulPaint = [];
        const domContentLoaded = [];
        const scriptDuration = [];
        const layoutDuration = [];
        const jsHeapUsedSize = [];
        const jsHeapTotalSize = [];
        const cpuUsage = [];
        const idleWakeups = [];
        const frameRate = [];
        const taskDuration = [];
        const gcTime = [];
        const lighthouseScore = [];
        const lighthouseFCP = [];
        const lighthouseLCP = [];
        const lighthouseTBT = [];
        const appStartupTime = [];
      
        data.forEach((run) => {
          const timestamp = new Date(run.timestamp).getTime();
          
          // Process all scenarios in metrics
          Object.entries(run.metrics).forEach(([scenario, metrics]) => {
            // App startup time
            if (scenario === 'app-startup' && metrics.appStartupTime) {
              appStartupTime.push({
                x: timestamp,
                y: metrics.appStartupTime,
                scenario
              });
            }
            
            // Navigation timing metrics
            if (metrics.navigationTiming) {
              if (metrics.navigationTiming.timeToInteractive) {
                timeToInteractive.push({
                  x: timestamp,
                  y: metrics.navigationTiming.timeToInteractive,
                  scenario
                });
              }
              
              if (metrics.navigationTiming.firstContentfulPaint) {
                firstContentfulPaint.push({
                  x: timestamp,
                  y: metrics.navigationTiming.firstContentfulPaint,
                  scenario
                });
              }
              
              if (metrics.navigationTiming.domContentLoaded) {
                domContentLoaded.push({
                  x: timestamp,
                  y: metrics.navigationTiming.domContentLoaded,
                  scenario
                });
              }
            }
            
            // Memory metrics
            if (metrics.jsMemoryUsage) {
              if (metrics.jsMemoryUsage.jsHeapUsedSize) {
                jsHeapUsedSize.push({
                  x: timestamp,
                  y: metrics.jsMemoryUsage.jsHeapUsedSize / (1024 * 1024), // Convert to MB
                  scenario
                });
              }
              
              if (metrics.jsMemoryUsage.jsHeapTotalSize) {
                jsHeapTotalSize.push({
                  x: timestamp,
                  y: metrics.jsMemoryUsage.jsHeapTotalSize / (1024 * 1024), // Convert to MB
                  scenario
                });
              }
            }
            
            // CPU metrics
            if (metrics.cpuUsage) {
              cpuUsage.push({
                x: timestamp,
                y: metrics.cpuUsage.percentCPUUsage || 0,
                scenario
              });
              
              idleWakeups.push({
                x: timestamp,
                y: metrics.cpuUsage.idleWakeupsPerSecond || 0,
                scenario
              });
            }
            
            // Frame rate
            if (metrics.frameRate) {
              frameRate.push({
                x: timestamp,
                y: metrics.frameRate,
                scenario
              });
            }
            
            // JavaScript execution metrics
            if (metrics.taskDuration) {
              taskDuration.push({
                x: timestamp,
                y: metrics.taskDuration,
                scenario
              });
            }
            
            if (metrics.gcTime) {
              gcTime.push({
                x: timestamp,
                y: metrics.gcTime,
                scenario
              });
            }
            
            // Lighthouse metrics
            if (metrics.lighthouse) {
              if (metrics.lighthouse.performanceScore) {
                lighthouseScore.push({
                  x: timestamp,
                  y: metrics.lighthouse.performanceScore,
                  scenario
                });
              }
              
              if (metrics.lighthouse.firstContentfulPaint) {
                lighthouseFCP.push({
                  x: timestamp,
                  y: metrics.lighthouse.firstContentfulPaint,
                  scenario
                });
              }
              
              if (metrics.lighthouse.largestContentfulPaint) {
                lighthouseLCP.push({
                  x: timestamp,
                  y: metrics.lighthouse.largestContentfulPaint,
                  scenario
                });
              }
              
              if (metrics.lighthouse.totalBlockingTime) {
                lighthouseTBT.push({
                  x: timestamp,
                  y: metrics.lighthouse.totalBlockingTime,
                  scenario
                });
              }
            }
          });
        });
      
        return {
          timeToInteractive,
          firstContentfulPaint,
          domContentLoaded,
          scriptDuration,
          layoutDuration,
          jsHeapUsedSize,
          jsHeapTotalSize,
          cpuUsage,
          idleWakeups,
          frameRate,
          taskDuration,
          gcTime,
          lighthouseScore,
          lighthouseFCP,
          lighthouseLCP,
          lighthouseTBT,
          appStartupTime
        };
      }
      
      // Load and process the data
      const allData = ${JSON.stringify(allData)};
      const chartData = prepareChartData(allData);
      
      // Trends Chart
      const trendsCtx = document.getElementById('trendsChart').getContext('2d');
      new Chart(trendsCtx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Time to Interactive',
              data: chartData.timeToInteractive,
              borderColor: '#3498db',
              tension: 0.1
            },
            {
              label: 'First Contentful Paint',
              data: chartData.firstContentfulPaint,
              borderColor: '#2ecc71',
              tension: 0.1
            },
            {
              label: 'App Startup Time',
              data: chartData.appStartupTime,
              borderColor: '#e74c3c',
              tension: 0.1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'time',
              time: {
                unit: 'day'
              }
            }
          }
        }
      });
      
      // Startup Chart
      const startupCtx = document.getElementById('startupChart').getContext('2d');
      new Chart(startupCtx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Time to Interactive',
              data: chartData.timeToInteractive,
              borderColor: '#3498db',
              tension: 0.1
            },
            {
              label: 'DOM Content Loaded',
              data: chartData.domContentLoaded,
              borderColor: '#e67e22',
              tension: 0.1
            },
            {
              label: 'App Startup Time',
              data: chartData.appStartupTime,
              borderColor: '#e74c3c',
              tension: 0.1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'time',
              time: {
                unit: 'day'
              }
            }
          }
        }
      });
      
      // Navigation Chart
      const navigationCtx = document.getElementById('navigationChart').getContext('2d');
      new Chart(navigationCtx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Script Duration',
              data: chartData.scriptDuration,
              borderColor: '#9b59b6',
              tension: 0.1
            },
            {
              label: 'Layout Duration',
              data: chartData.layoutDuration,
              borderColor: '#f1c40f',
              tension: 0.1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'time',
              time: {
                unit: 'day'
              }
            }
          }
        }
      });
      
      // Memory Chart
      const memoryCtx = document.getElementById('memoryChart').getContext('2d');
      new Chart(memoryCtx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'JS Heap Used (MB)',
              data: chartData.jsHeapUsedSize,
              borderColor: '#16a085',
              tension: 0.1
            },
            {
              label: 'JS Heap Total (MB)',
              data: chartData.jsHeapTotalSize,
              borderColor: '#27ae60',
              tension: 0.1,
              borderDash: [5, 5]
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'time',
              time: {
                unit: 'day'
              }
            }
          }
        }
      });
      
      // CPU Chart
      const cpuCtx = document.getElementById('cpuChart').getContext('2d');
      new Chart(cpuCtx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'CPU Usage (%)',
              data: chartData.cpuUsage,
              borderColor: '#d35400',
              tension: 0.1,
              yAxisID: 'y'
            },
            {
              label: 'Frame Rate (fps)',
              data: chartData.frameRate,
              borderColor: '#2980b9',
              tension: 0.1,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'time',
              time: {
                unit: 'day'
              }
            },
            y: {
              type: 'linear',
              display: true,
              position: 'left',
              title: {
                display: true,
                text: 'CPU Usage (%)'
              }
            },
            y1: {
              type: 'linear',
              display: true,
              position: 'right',
              title: {
                display: true,
                text: 'Frame Rate (fps)'
              },
              grid: {
                drawOnChartArea: false
              }
            }
          }
        }
      });
      
      // JavaScript Chart
      const jsCtx = document.getElementById('jsChart').getContext('2d');
      new Chart(jsCtx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Task Duration (ms)',
              data: chartData.taskDuration,
              borderColor: '#8e44ad',
              tension: 0.1
            },
            {
              label: 'GC Time (ms)',
              data: chartData.gcTime,
              borderColor: '#c0392b',
              tension: 0.1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'time',
              time: {
                unit: 'day'
              }
            }
          }
        }
      });
      
      // Lighthouse Chart
      const lighthouseCtx = document.getElementById('lighthouseChart').getContext('2d');
      new Chart(lighthouseCtx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Performance Score',
              data: chartData.lighthouseScore,
              borderColor: '#1abc9c',
              tension: 0.1,
              yAxisID: 'y'
            },
            {
              label: 'First Contentful Paint',
              data: chartData.lighthouseFCP,
              borderColor: '#e74c3c',
              tension: 0.1,
              yAxisID: 'y1'
            },
            {
              label: 'Largest Contentful Paint',
              data: chartData.lighthouseLCP,
              borderColor: '#34495e',
              tension: 0.1,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              type: 'time',
              time: {
                unit: 'day'
              }
            },
            y: {
              type: 'linear',
              display: true,
              position: 'left',
              title: {
                display: true,
                text: 'Score (0-100)'
              },
              min: 0,
              max: 100
            },
            y1: {
              type: 'linear',
              display: true,
              position: 'right',
              title: {
                display: true,
                text: 'Time (ms)'
              },
              grid: {
                drawOnChartArea: false
              }
            }
          }
        }
      });
    });
  </script>
</body>
</html>
  `;

  // Write HTML file
  fs.writeFileSync(outputPath, html);
  console.log(`Dashboard generated at: ${outputPath}`);
}

// Helper function to generate latest metrics summary
function generateLatestMetricsSummary(data: DashboardData): string {
  let html = "";

  Object.entries(data.metrics).forEach(([scenario, metrics]) => {
    let metricItems = [];

    // Core metrics
    if (metrics.timeToInteractive) {
      metricItems.push(
        `<p>Time to Interactive: <span class="metric-value">${metrics.timeToInteractive.toFixed(
          2
        )} ms</span></p>`
      );
    }

    if (metrics.firstContentfulPaint) {
      metricItems.push(
        `<p>First Contentful Paint: <span class="metric-value">${metrics.firstContentfulPaint.toFixed(
          2
        )} ms</span></p>`
      );
    }

    if (metrics.loadTime) {
      metricItems.push(
        `<p>Load Time: <span class="metric-value">${metrics.loadTime.toFixed(
          2
        )} ms</span></p>`
      );
    }

    // Electron-specific metrics
    if (metrics.appStartupTime) {
      metricItems.push(
        `<p>App Startup Time: <span class="metric-value">${metrics.appStartupTime.toFixed(
          2
        )} ms</span></p>`
      );
    }

    if (metrics.jsHeapUsedSize) {
      const mbUsed = (metrics.jsHeapUsedSize / (1024 * 1024)).toFixed(2);
      metricItems.push(
        `<p>JS Heap Used: <span class="metric-value">${mbUsed} MB</span></p>`
      );
    }

    if (metrics.cpuUsage) {
      metricItems.push(
        `<p>CPU Usage: <span class="metric-value">${metrics.cpuUsage.percentCPUUsage.toFixed(
          2
        )}%</span></p>`
      );
    }

    if (metrics.frameRate) {
      const fpsClass =
        metrics.frameRate >= 50
          ? "metric-value-good"
          : metrics.frameRate >= 30
          ? "metric-value-warning"
          : "metric-value-bad";
      metricItems.push(
        `<p>Frame Rate: <span class="metric-value ${fpsClass}">${metrics.frameRate.toFixed(
          1
        )} fps</span></p>`
      );
    }

    if (metrics.lighthouse?.performanceScore) {
      const scoreClass =
        metrics.lighthouse.performanceScore >= 90
          ? "metric-value-good"
          : metrics.lighthouse.performanceScore >= 50
          ? "metric-value-warning"
          : "metric-value-bad";
      metricItems.push(
        `<p>Performance Score: <span class="metric-value ${scoreClass}">${metrics.lighthouse.performanceScore.toFixed(
          0
        )}</span></p>`
      );
    }

    if (metricItems.length > 0) {
      html += `
        <div class="metric-card">
          <h3>${formatScenarioName(scenario)}</h3>
          ${metricItems.join("")}
        </div>
      `;
    }
  });

  return html;
}

// Helper function to generate startup table rows
function generateStartupTableRows(data: DashboardData[]): string {
  let html = "";

  data.forEach((run) => {
    const metrics = run.metrics["app-startup"];
    if (metrics) {
      html += `
        <tr>
          <td>${new Date(run.timestamp).toLocaleString()}</td>
          <td>${run.platform}-${run.arch}</td>
          <td>${metrics.timeToInteractive?.toFixed(2) || "N/A"}</td>
          <td>${metrics.firstPaint?.toFixed(2) || "N/A"}</td>
          <td>${metrics.firstContentfulPaint?.toFixed(2) || "N/A"}</td>
          <td>${metrics.appStartupTime?.toFixed(2) || "N/A"}</td>
        </tr>
      `;
    }
  });

  return html;
}

// Helper function to generate navigation table rows
function generateNavigationTableRows(data: DashboardData[]): string {
  let html = "";

  data.forEach((run) => {
    Object.entries(run.metrics).forEach(([scenario, metrics]) => {
      if (scenario !== "app-startup" && metrics.scriptDuration) {
        html += `
          <tr>
            <td>${new Date(run.timestamp).toLocaleString()}</td>
            <td>${formatScenarioName(scenario)}</td>
            <td>${metrics.scriptDuration?.toFixed(2) || "N/A"}</td>
            <td>${metrics.layoutDuration?.toFixed(2) || "N/A"}</td>
            <td>${metrics.recalcStyleDuration?.toFixed(2) || "N/A"}</td>
          </tr>
        `;
      }
    });
  });

  return html;
}

// Helper function to generate memory table rows
function generateMemoryTableRows(data: DashboardData[]): string {
  let html = "";

  data.forEach((run) => {
    Object.entries(run.metrics).forEach(([scenario, metrics]) => {
      if (metrics.jsHeapUsedSize) {
        const jsHeapUsedMB = (metrics.jsHeapUsedSize / (1024 * 1024)).toFixed(
          2
        );
        const jsHeapTotalMB = metrics.jsHeapTotalSize
          ? (metrics.jsHeapTotalSize / (1024 * 1024)).toFixed(2)
          : "N/A";

        const ratio = metrics.jsHeapTotalSize
          ? ((metrics.jsHeapUsedSize / metrics.jsHeapTotalSize) * 100).toFixed(
              1
            ) + "%"
          : "N/A";

        html += `
          <tr>
            <td>${new Date(run.timestamp).toLocaleString()}</td>
            <td>${formatScenarioName(scenario)}</td>
            <td>${jsHeapUsedMB}</td>
            <td>${jsHeapTotalMB}</td>
            <td>${ratio}</td>
          </tr>
        `;
      }
    });
  });

  return html;
}

// Helper function to generate CPU table rows
function generateCpuTableRows(data: DashboardData[]): string {
  let html = "";

  data.forEach((run) => {
    Object.entries(run.metrics).forEach(([scenario, metrics]) => {
      if (metrics.cpuUsage || metrics.frameRate) {
        const cpuUsage = metrics.cpuUsage
          ? metrics.cpuUsage.percentCPUUsage.toFixed(2) + "%"
          : "N/A";

        const idleWakeups = metrics.cpuUsage
          ? metrics.cpuUsage.idleWakeupsPerSecond.toFixed(0)
          : "N/A";

        const frameRate = metrics.frameRate
          ? metrics.frameRate.toFixed(1)
          : "N/A";

        html += `
          <tr>
            <td>${new Date(run.timestamp).toLocaleString()}</td>
            <td>${formatScenarioName(scenario)}</td>
            <td>${cpuUsage}</td>
            <td>${idleWakeups}</td>
            <td>${frameRate}</td>
          </tr>
        `;
      }
    });
  });

  return html;
}

// Helper function to generate JavaScript table rows
function generateJsTableRows(data: DashboardData[]): string {
  let html = "";

  data.forEach((run) => {
    Object.entries(run.metrics).forEach(([scenario, metrics]) => {
      if (metrics.taskDuration || metrics.gcTime) {
        const taskDuration = metrics.taskDuration
          ? metrics.taskDuration.toFixed(2)
          : "N/A";

        const gcTime = metrics.gcTime ? metrics.gcTime.toFixed(2) : "N/A";

        const gcPercentage =
          metrics.taskDuration && metrics.gcTime
            ? ((metrics.gcTime / metrics.taskDuration) * 100).toFixed(1) + "%"
            : "N/A";

        html += `
          <tr>
            <td>${new Date(run.timestamp).toLocaleString()}</td>
            <td>${formatScenarioName(scenario)}</td>
            <td>${taskDuration}</td>
            <td>${gcTime}</td>
            <td>${gcPercentage}</td>
          </tr>
        `;
      }
    });
  });

  return html;
}

// Helper function to generate lighthouse table rows
function generateLighthouseTableRows(data: DashboardData[]): string {
  let html = "";

  data.forEach((run) => {
    Object.entries(run.metrics).forEach(([scenario, metrics]) => {
      if (metrics.lighthouse) {
        const lighthouse = metrics.lighthouse;

        html += `
          <tr>
            <td>${new Date(
              run.timestamp
            ).toLocaleString()} (${formatScenarioName(scenario)})</td>
            <td>${lighthouse.performanceScore?.toFixed(0) || "N/A"}</td>
            <td>${lighthouse.firstContentfulPaint?.toFixed(2) || "N/A"}</td>
            <td>${lighthouse.speedIndex?.toFixed(2) || "N/A"}</td>
            <td>${lighthouse.largestContentfulPaint?.toFixed(2) || "N/A"}</td>
            <td>${lighthouse.totalBlockingTime?.toFixed(2) || "N/A"}</td>
            <td>${lighthouse.cumulativeLayoutShift?.toFixed(2) || "N/A"}</td>
          </tr>
        `;
      }
    });
  });

  return html;
}

// Helper function to format scenario names for display
function formatScenarioName(name: string): string {
  // Convert kebab-case to Title Case
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

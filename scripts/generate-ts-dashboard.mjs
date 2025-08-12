#!/usr/bin/env node

/**
 * Script to generate a TypeScript directives tracking dashboard.
 * Creates historical data storage and generates HTML dashboard with charts.
 *
 * Usage:
 *   node scripts/generate-ts-dashboard.mjs
 *
 * The script will:
 * 1. Read current TypeScript directive counts
 * 2. Append to historical data (CSV format)
 * 3. Generate HTML dashboard with charts and tables
 * 4. Create static files for deployment
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from "fs";

const REPORTS_DIR = "reports/ts-directives";
const DASHBOARD_DIR = `${REPORTS_DIR}/dashboard`;
const EXISTING_DATA_FILE = `${REPORTS_DIR}/existing-data.json`;
const CURRENT_DATA_FILE = `${REPORTS_DIR}/current.json`;

function ensureDirectoryExists(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, {recursive: true});
  }
}

function getCurrentData() {
  try {
    const data = readFileSync(CURRENT_DATA_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading current data:", error.message);
    process.exit(1);
  }
}

function appendToHistoricalData(currentData) {
  const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format

  // Read existing historical data
  let historicalData = [];
  if (existsSync(EXISTING_DATA_FILE)) {
    try {
      const existingContent = readFileSync(EXISTING_DATA_FILE, "utf8");
      historicalData = JSON.parse(existingContent);
      if (!Array.isArray(historicalData)) {
        historicalData = [];
      }
    } catch (error) {
      console.log("📝 Creating new historical data array");
      historicalData = [];
    }
  }

  // Check if we already have data for today and remove it
  historicalData = historicalData.filter((entry) => entry.date !== date);

  // Prepare new data entry
  const newEntry = {
    date,
    timestamp: currentData.timestamp,
    totalDirectives: currentData.totalDirectives,
    filesWithDirectives: currentData.filesWithDirectives,
    totalFiles: currentData.totalFiles,
    tsExpectError: currentData.byType["@ts-expect-error"],
    tsNocheck: currentData.byType["@ts-nocheck"],
    tsIgnore: currentData.byType["@ts-ignore"],
    tsFiles: currentData.byExtension.ts || 0,
    tsxFiles: currentData.byExtension.tsx || 0,
    jsFiles: currentData.byExtension.js || 0,
  };

  // Add new entry and sort by date
  historicalData.push(newEntry);
  historicalData.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Keep only last 365 days of data to prevent unlimited growth
  const oneYearAgo = new Date();
  oneYearAgo.setDate(oneYearAgo.getDate() - 365);
  historicalData = historicalData.filter(
    (entry) => new Date(entry.date) >= oneYearAgo
  );

  console.log(
    `✅ Added data for ${date} to historical tracking (${historicalData.length} total entries)`
  );
  return historicalData;
}

function generateDashboardHTML(historicalData, currentData) {
  const chartData = historicalData.map((row) => ({
    date: row.date,
    totalDirectives: row.totalDirectives,
    tsExpectError: row.tsExpectError,
    tsIgnore: row.tsIgnore,
    tsNocheck: row.tsNocheck,
    filesWithDirectives: row.filesWithDirectives,
  }));

  const latestData = historicalData[historicalData.length - 1] || {};
  const previousData = historicalData[historicalData.length - 2] || {};

  const totalChange =
    latestData.totalDirectives && previousData.totalDirectives
      ? latestData.totalDirectives - previousData.totalDirectives
      : 0;

  const filesChange =
    latestData.filesWithDirectives && previousData.filesWithDirectives
      ? latestData.filesWithDirectives - previousData.filesWithDirectives
      : 0;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TypeScript Directives Tracking Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/date-fns@2.29.3/index.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 2.5em;
            margin-bottom: 10px;
            font-weight: 300;
        }
        
        .header p {
            opacity: 0.9;
            font-size: 1.1em;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            padding: 30px;
            background: #f8f9fa;
        }
        
        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
            text-align: center;
            border-left: 4px solid;
        }
        
        .stat-card.total { border-left-color: #e74c3c; }
        .stat-card.files { border-left-color: #3498db; }
        .stat-card.expect-error { border-left-color: #f39c12; }
        .stat-card.ignore { border-left-color: #9b59b6; }
        
        .stat-number {
            font-size: 2.5em;
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .stat-label {
            color: #666;
            font-size: 0.9em;
            margin-bottom: 10px;
        }
        
        .stat-change {
            font-size: 0.8em;
            padding: 4px 8px;
            border-radius: 12px;
            font-weight: 500;
        }
        
        .stat-change.positive {
            background: #fee;
            color: #c53030;
        }
        
        .stat-change.negative {
            background: #f0fff4;
            color: #38a169;
        }
        
        .stat-change.neutral {
            background: #f7fafc;
            color: #4a5568;
        }
        
        .chart-container {
            padding: 30px;
        }
        
        .chart-wrapper {
            position: relative;
            height: 400px;
            margin-bottom: 30px;
        }
        
        .section-title {
            font-size: 1.5em;
            margin-bottom: 20px;
            color: #2c3e50;
            text-align: center;
        }
        
        .table-container {
            padding: 0 30px 30px;
            overflow-x: auto;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        
        th, td {
            padding: 12px 15px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        
        th {
            background: #f8f9fa;
            font-weight: 600;
            color: #2c3e50;
        }
        
        tr:hover {
            background: #f8f9fa;
        }
        
        .footer {
            text-align: center;
            padding: 20px;
            color: #666;
            border-top: 1px solid #eee;
        }
        
        @media (max-width: 768px) {
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .header h1 {
                font-size: 2em;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 TypeScript Directives Tracker</h1>
            <p>Monitoring @ts-ignore, @ts-expect-error, and @ts-nocheck usage over time</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card total">
                <div class="stat-number">${currentData.totalDirectives}</div>
                <div class="stat-label">Total Directives</div>
                <div class="stat-change ${
                  totalChange > 0
                    ? "positive"
                    : totalChange < 0
                    ? "negative"
                    : "neutral"
                }">
                    ${totalChange > 0 ? "+" : ""}${totalChange} from yesterday
                </div>
            </div>
            
            <div class="stat-card files">
                <div class="stat-number">${
                  currentData.filesWithDirectives
                }</div>
                <div class="stat-label">Files with Directives</div>
                <div class="stat-change ${
                  filesChange > 0
                    ? "positive"
                    : filesChange < 0
                    ? "negative"
                    : "neutral"
                }">
                    ${filesChange > 0 ? "+" : ""}${filesChange} from yesterday
                </div>
            </div>
            
            <div class="stat-card expect-error">
                <div class="stat-number">${
                  currentData.byType["@ts-expect-error"]
                }</div>
                <div class="stat-label">@ts-expect-error</div>
                <div class="stat-change neutral">
                    ${(
                      (currentData.byType["@ts-expect-error"] /
                        currentData.totalDirectives) *
                      100
                    ).toFixed(1)}% of total
                </div>
            </div>
            
            <div class="stat-card ignore">
                <div class="stat-number">${
                  currentData.byType["@ts-ignore"]
                }</div>
                <div class="stat-label">@ts-ignore</div>
                <div class="stat-change neutral">
                    ${(
                      (currentData.byType["@ts-ignore"] /
                        currentData.totalDirectives) *
                      100
                    ).toFixed(1)}% of total
                </div>
            </div>
        </div>
        
        <div class="chart-container">
            <h2 class="section-title">📈 Historical Trend</h2>
            <div class="chart-wrapper">
                <canvas id="trendChart"></canvas>
            </div>
        </div>
        
        <div class="table-container">
            <h2 class="section-title">📋 Historical Data</h2>
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Total Directives</th>
                        <th>Files Affected</th>
                        <th>@ts-expect-error</th>
                        <th>@ts-ignore</th>
                        <th>@ts-nocheck</th>
                        <th>Change</th>
                    </tr>
                </thead>
                <tbody>
                    ${historicalData
                      .slice(-30)
                      .reverse()
                      .map((row, index, array) => {
                        const prevRow = array[index + 1];
                        const change = prevRow
                          ? row.totalDirectives - prevRow.totalDirectives
                          : 0;
                        const changeClass =
                          change > 0
                            ? "positive"
                            : change < 0
                            ? "negative"
                            : "neutral";

                        return `
                        <tr>
                            <td>${new Date(row.date).toLocaleDateString()}</td>
                            <td>${row.totalDirectives}</td>
                            <td>${row.filesWithDirectives}</td>
                            <td>${row.tsExpectError}</td>
                            <td>${row.tsIgnore}</td>
                            <td>${row.tsNocheck}</td>
                            <td class="stat-change ${changeClass}">${
                              change > 0 ? "+" : ""
                            }${change}</td>
                        </tr>
                      `;
                      })
                      .join("")}
                </tbody>
            </table>
        </div>
        
        <div class="footer">
            <p>Last updated: ${new Date(
              currentData.timestamp
            ).toLocaleString()}</p>
            <p>Generated automatically by GitHub Actions • <a href="https://github.com/${
              process.env.GITHUB_REPOSITORY || "your-repo"
            }" target="_blank">View Repository</a></p>
        </div>
    </div>
    
    <script>
        const chartData = ${JSON.stringify(chartData)};
        
        const ctx = document.getElementById('trendChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: chartData.map(d => new Date(d.date).toLocaleDateString()),
                datasets: [
                    {
                        label: 'Total Directives',
                        data: chartData.map(d => d.totalDirectives),
                        borderColor: '#e74c3c',
                        backgroundColor: 'rgba(231, 76, 60, 0.1)',
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: '@ts-expect-error',
                        data: chartData.map(d => d.tsExpectError),
                        borderColor: '#f39c12',
                        backgroundColor: 'rgba(243, 156, 18, 0.1)',
                        tension: 0.4
                    },
                    {
                        label: '@ts-ignore',
                        data: chartData.map(d => d.tsIgnore),
                        borderColor: '#9b59b6',
                        backgroundColor: 'rgba(155, 89, 182, 0.1)',
                        tension: 0.4
                    },
                    {
                        label: 'Files with Directives',
                        data: chartData.map(d => d.filesWithDirectives),
                        borderColor: '#3498db',
                        backgroundColor: 'rgba(52, 152, 219, 0.1)',
                        tension: 0.4,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Number of Directives'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Number of Files'
                        },
                        grid: {
                            drawOnChartArea: false,
                        },
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'TypeScript Directives Trend Over Time'
                    },
                    legend: {
                        position: 'top'
                    }
                }
            }
        });
    </script>
</body>
</html>`;

  return html;
}

function main() {
  console.log("🚀 Generating TypeScript directives dashboard...");

  // Ensure directories exist
  ensureDirectoryExists(REPORTS_DIR);
  ensureDirectoryExists(DASHBOARD_DIR);

  // Get current data
  const currentData = getCurrentData();
  console.log(
    `📊 Current metrics: ${currentData.totalDirectives} directives in ${currentData.filesWithDirectives} files`
  );

  // Append to historical data and get the updated array
  const historicalData = appendToHistoricalData(currentData);
  console.log(`📈 Historical data points: ${historicalData.length}`);

  // Generate dashboard HTML
  const dashboardHTML = generateDashboardHTML(historicalData, currentData);

  // Write dashboard files
  writeFileSync(`${DASHBOARD_DIR}/index.html`, dashboardHTML);

  // Copy current data for dashboard access
  writeFileSync(
    `${DASHBOARD_DIR}/current-data.json`,
    JSON.stringify(currentData, null, 2)
  );

  // Copy historical data as JSON for potential API access
  writeFileSync(
    `${DASHBOARD_DIR}/historical-data.json`,
    JSON.stringify(historicalData, null, 2)
  );

  console.log("✅ Dashboard generated successfully!");
  console.log(`📁 Dashboard files created in: ${DASHBOARD_DIR}/`);
  console.log(
    `🌐 Dashboard will be available at GitHub Pages after deployment`
  );
}

main();

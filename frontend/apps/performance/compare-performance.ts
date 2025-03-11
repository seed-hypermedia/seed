#!/usr/bin/env node

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { PerformanceMetrics } from './perf-utils';

interface PerformanceData {
  timestamp: string;
  metrics: Record<string, PerformanceMetrics>;
  platform: string;
  arch: string;
}

interface ComparisonResult {
  scenario: string;
  metric: string;
  baselineValue: number;
  currentValue: number;
  difference: number;
  percentChange: number;
  improved: boolean;
}

// Set up CLI options
program
  .name('compare-performance')
  .description('Compare performance results between different runs')
  .version('1.0.0');

program
  .requiredOption('-c, --current <path>', 'Path to current performance metrics JSON file')
  .requiredOption('-b, --baseline <path>', 'Path to baseline performance metrics JSON file')
  .requiredOption('-o, --output <path>', 'Output path for comparison report HTML')
  .option('-t, --threshold <percent>', 'Percentage threshold for highlighting significant changes', '5');

program.parse();

const options = program.opts();

function loadPerformanceData(filePath: string): PerformanceData {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as PerformanceData;
}

function compareMetrics(
  baseline: Record<string, PerformanceMetrics>,
  current: Record<string, PerformanceMetrics>,
  significanceThreshold: number
): ComparisonResult[] {
  const results: ComparisonResult[] = [];
  
  // Get all scenario names from both baseline and current
  const allScenarios = new Set([
    ...Object.keys(baseline),
    ...Object.keys(current)
  ]);
  
  for (const scenario of allScenarios) {
    const baselineMetrics = baseline[scenario];
    const currentMetrics = current[scenario];
    
    // Skip if either baseline or current doesn't have this scenario
    if (!baselineMetrics || !currentMetrics) {
      continue;
    }
    
    // Get all metric names to compare
    const allMetrics = new Set<string>();
    
    // Add all regular metrics
    Object.keys(baselineMetrics).forEach(key => {
      if (typeof baselineMetrics[key] === 'number') {
        allMetrics.add(key);
      }
    });
    
    Object.keys(currentMetrics).forEach(key => {
      if (typeof currentMetrics[key] === 'number') {
        allMetrics.add(key);
      }
    });
    
    // Add nested metrics (like cpuUsage.percentCPUUsage)
    Object.keys(baselineMetrics).forEach(key => {
      if (typeof baselineMetrics[key] === 'object' && baselineMetrics[key] !== null) {
        Object.keys(baselineMetrics[key]).forEach(nestedKey => {
          if (typeof baselineMetrics[key][nestedKey] === 'number') {
            allMetrics.add(`${key}.${nestedKey}`);
          }
        });
      }
    });
    
    Object.keys(currentMetrics).forEach(key => {
      if (typeof currentMetrics[key] === 'object' && currentMetrics[key] !== null) {
        Object.keys(currentMetrics[key]).forEach(nestedKey => {
          if (typeof currentMetrics[key][nestedKey] === 'number') {
            allMetrics.add(`${key}.${nestedKey}`);
          }
        });
      }
    });
    
    // Compare each metric
    for (const metric of allMetrics) {
      let baselineValue: number | undefined;
      let currentValue: number | undefined;
      
      // Handle nested metrics
      if (metric.includes('.')) {
        const [parent, child] = metric.split('.');
        baselineValue = baselineMetrics[parent]?.[child];
        currentValue = currentMetrics[parent]?.[child];
      } else {
        baselineValue = baselineMetrics[metric];
        currentValue = currentMetrics[metric];
      }
      
      // Skip if either value is missing
      if (baselineValue === undefined || currentValue === undefined) {
        continue;
      }
      
      // Calculate differences
      const difference = currentValue - baselineValue;
      const percentChange = (difference / baselineValue) * 100;
      
      // Only include if the change is significant (above threshold)
      if (Math.abs(percentChange) >= significanceThreshold) {
        // Determine if the change is an improvement based on the metric
        // For most metrics, lower is better (e.g., load times)
        // But for some metrics higher is better (e.g., frame rate, scores)
        let improved: boolean;
        
        if (
          metric === 'frameRate' || 
          metric.includes('Score') || 
          metric.includes('score')
        ) {
          // For these metrics, higher is better
          improved = difference > 0;
        } else {
          // For most performance metrics, lower is better
          improved = difference < 0;
        }
        
        results.push({
          scenario,
          metric,
          baselineValue,
          currentValue,
          difference,
          percentChange,
          improved
        });
      }
    }
  }
  
  // Sort by absolute percentage change (largest first)
  return results.sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));
}

function formatMetricName(metric: string): string {
  // Handle nested metrics
  if (metric.includes('.')) {
    const parts = metric.split('.');
    return `${formatMetricName(parts[0])} - ${formatMetricName(parts[1])}`;
  }
  
  // Convert camelCase to Title Case with spaces
  const words = metric.replace(/([A-Z])/g, ' $1').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatScenarioName(scenario: string): string {
  // Convert kebab-case to Title Case
  return scenario.split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatValue(value: number, metric: string): string {
  // Apply units based on metric type
  if (metric.includes('Time') || metric.endsWith('Duration')) {
    return `${value.toFixed(2)} ms`;
  } else if (metric.includes('Size')) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  } else if (metric.includes('CPU')) {
    return `${value.toFixed(2)}%`;
  } else if (metric === 'frameRate') {
    return `${value.toFixed(1)} fps`;
  } else if (metric.includes('Score') || metric.includes('score')) {
    return value.toFixed(0);
  }
  return value.toFixed(2);
}

function generateComparisonReport(
  results: ComparisonResult[],
  baselineData: PerformanceData,
  currentData: PerformanceData,
  outputPath: string
): void {
  // Separate improvements and regressions
  const improvements = results.filter(r => r.improved);
  const regressions = results.filter(r => !r.improved);
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Performance Comparison Report</title>
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
    .summary {
      display: flex;
      justify-content: space-between;
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 30px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    .summary-box {
      text-align: center;
      flex: 1;
    }
    .summary-number {
      font-size: 2.5rem;
      font-weight: bold;
    }
    .regression-number {
      color: #e74c3c;
    }
    .improvement-number {
      color: #2ecc71;
    }
    .comparison-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    .comparison-table th, .comparison-table td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    .comparison-table th {
      background-color: #f2f2f2;
    }
    tr.regression {
      background-color: #ffeaea;
    }
    tr.improvement {
      background-color: #eaffea;
    }
    .change-cell {
      font-weight: bold;
    }
    .change-positive {
      color: #2ecc71;
    }
    .change-negative {
      color: #e74c3c;
    }
    .metadata {
      margin-bottom: 20px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 8px;
    }
    .metadata-title {
      font-weight: bold;
      margin-bottom: 5px;
    }
    .badge {
      display: inline-block;
      padding: 3px 7px;
      border-radius: 3px;
      font-size: 0.8rem;
      color: white;
      margin-right: 5px;
    }
    .badge-regression {
      background-color: #e74c3c;
    }
    .badge-improvement {
      background-color: #2ecc71;
    }
    .empty-state {
      text-align: center;
      padding: 30px;
      background: #f8f9fa;
      border-radius: 8px;
      color: #7f8c8d;
    }
  </style>
</head>
<body>
  <h1>Performance Comparison Report</h1>
  
  <div class="metadata">
    <div class="metadata-title">Baseline:</div>
    <div>Date: ${new Date(baselineData.timestamp).toLocaleString()}</div>
    <div>Platform: ${baselineData.platform} (${baselineData.arch})</div>
    
    <div class="metadata-title" style="margin-top: 15px;">Current:</div>
    <div>Date: ${new Date(currentData.timestamp).toLocaleString()}</div>
    <div>Platform: ${currentData.platform} (${currentData.arch})</div>
  </div>
  
  <div class="summary">
    <div class="summary-box">
      <div class="summary-number regression-number">${regressions.length}</div>
      <div>Regressions</div>
    </div>
    <div class="summary-box">
      <div class="summary-number improvement-number">${improvements.length}</div>
      <div>Improvements</div>
    </div>
    <div class="summary-box">
      <div class="summary-number">${results.length}</div>
      <div>Total Changes</div>
    </div>
  </div>

  <h2>Performance Regressions</h2>
  
  ${regressions.length > 0 ? `
  <table class="comparison-table">
    <thead>
      <tr>
        <th>Scenario</th>
        <th>Metric</th>
        <th>Baseline</th>
        <th>Current</th>
        <th>Change</th>
      </tr>
    </thead>
    <tbody>
      ${regressions.map(r => `
      <tr class="regression">
        <td>${formatScenarioName(r.scenario)}</td>
        <td>${formatMetricName(r.metric)}</td>
        <td>${formatValue(r.baselineValue, r.metric)}</td>
        <td>${formatValue(r.currentValue, r.metric)}</td>
        <td class="change-cell change-negative">
          ${r.percentChange >= 0 ? '+' : ''}${r.percentChange.toFixed(2)}%
        </td>
      </tr>
      `).join('')}
    </tbody>
  </table>
  ` : `
  <div class="empty-state">
    <p>No performance regressions detected! 🎉</p>
  </div>
  `}

  <h2>Performance Improvements</h2>
  
  ${improvements.length > 0 ? `
  <table class="comparison-table">
    <thead>
      <tr>
        <th>Scenario</th>
        <th>Metric</th>
        <th>Baseline</th>
        <th>Current</th>
        <th>Change</th>
      </tr>
    </thead>
    <tbody>
      ${improvements.map(r => `
      <tr class="improvement">
        <td>${formatScenarioName(r.scenario)}</td>
        <td>${formatMetricName(r.metric)}</td>
        <td>${formatValue(r.baselineValue, r.metric)}</td>
        <td>${formatValue(r.currentValue, r.metric)}</td>
        <td class="change-cell change-positive">
          ${r.percentChange >= 0 ? '+' : ''}${r.percentChange.toFixed(2)}%
        </td>
      </tr>
      `).join('')}
    </tbody>
  </table>
  ` : `
  <div class="empty-state">
    <p>No performance improvements detected.</p>
  </div>
  `}

  <h2>All Metrics</h2>
  
  <p>This table shows all metrics that were compared, including those that didn't change significantly.</p>
  
  <table class="comparison-table">
    <thead>
      <tr>
        <th>Scenario</th>
        <th>Metric</th>
        <th>Baseline</th>
        <th>Current</th>
        <th>Change</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${generateAllMetricsRows(baselineData.metrics, currentData.metrics)}
    </tbody>
  </table>
</body>
</html>
  `;
  
  // Create directory if it doesn't exist
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Write HTML to file
  fs.writeFileSync(outputPath, html);
  console.log(`Comparison report generated at: ${outputPath}`);
}

function generateAllMetricsRows(
  baseline: Record<string, PerformanceMetrics>,
  current: Record<string, PerformanceMetrics>
): string {
  const rows: string[] = [];
  
  // Get all scenario names from both baseline and current
  const allScenarios = new Set([
    ...Object.keys(baseline),
    ...Object.keys(current)
  ]);
  
  for (const scenario of allScenarios) {
    const baselineMetrics = baseline[scenario];
    const currentMetrics = current[scenario];
    
    // Skip if either baseline or current doesn't have this scenario
    if (!baselineMetrics || !currentMetrics) {
      continue;
    }
    
    // Process regular metrics
    for (const metric of getAllMetricsInObject(baselineMetrics, currentMetrics)) {
      let baselineValue: number | undefined;
      let currentValue: number | undefined;
      
      // Handle nested metrics
      if (metric.includes('.')) {
        const [parent, child] = metric.split('.');
        baselineValue = baselineMetrics[parent]?.[child];
        currentValue = currentMetrics[parent]?.[child];
      } else {
        baselineValue = baselineMetrics[metric];
        currentValue = currentMetrics[metric];
      }
      
      // Skip if either value is not a number
      if (
        baselineValue === undefined || 
        currentValue === undefined || 
        typeof baselineValue !== 'number' ||
        typeof currentValue !== 'number'
      ) {
        continue;
      }
      
      // Calculate differences
      const difference = currentValue - baselineValue;
      const percentChange = (difference / baselineValue) * 100;
      
      // Determine if the change is an improvement based on the metric
      let improved: boolean;
      if (
        metric === 'frameRate' || 
        metric.includes('Score') || 
        metric.includes('score')
      ) {
        // For these metrics, higher is better
        improved = difference > 0;
      } else {
        // For most performance metrics, lower is better
        improved = difference < 0;
      }
      
      // Determine the status badge
      let statusBadge = '';
      if (Math.abs(percentChange) >= parseFloat(options.threshold)) {
        statusBadge = improved
          ? '<span class="badge badge-improvement">Improved</span>'
          : '<span class="badge badge-regression">Regressed</span>';
      }
      
      // Add row to the table
      rows.push(`
        <tr class="${Math.abs(percentChange) >= parseFloat(options.threshold) ? (improved ? 'improvement' : 'regression') : ''}">
          <td>${formatScenarioName(scenario)}</td>
          <td>${formatMetricName(metric)}</td>
          <td>${formatValue(baselineValue, metric)}</td>
          <td>${formatValue(currentValue, metric)}</td>
          <td class="change-cell ${improved ? 'change-positive' : 'change-negative'}">
            ${percentChange >= 0 ? '+' : ''}${percentChange.toFixed(2)}%
          </td>
          <td>${statusBadge}</td>
        </tr>
      `);
    }
  }
  
  return rows.join('');
}

function getAllMetricsInObject(obj1: any, obj2: any, prefix = ''): string[] {
  const metrics: string[] = [];
  
  // Get all keys from both objects
  const allKeys = new Set([
    ...Object.keys(obj1 || {}),
    ...Object.keys(obj2 || {})
  ]);
  
  for (const key of allKeys) {
    const value1 = obj1?.[key];
    const value2 = obj2?.[key];
    
    // If both are objects, recursively get metrics with prefix
    if (
      typeof value1 === 'object' && value1 !== null && 
      typeof value2 === 'object' && value2 !== null &&
      !Array.isArray(value1) && !Array.isArray(value2)
    ) {
      const nestedMetrics = getAllMetricsInObject(
        value1, 
        value2,
        prefix ? `${prefix}.${key}` : key
      );
      metrics.push(...nestedMetrics);
    } 
    // If both are numbers, add the key with prefix
    else if (
      typeof value1 === 'number' && 
      typeof value2 === 'number'
    ) {
      metrics.push(prefix ? `${prefix}.${key}` : key);
    }
  }
  
  return metrics;
}

async function main() {
  try {
    // Load baseline and current data
    let baselineData: PerformanceData;
    let currentData: PerformanceData;
    
    try {
      if (fs.statSync(options.baseline).isDirectory()) {
        // Find the most recent JSON file in the directory
        const baselineFiles = fs.readdirSync(options.baseline)
          .filter(file => file.endsWith('.json') && file.startsWith('perf-metrics-'))
          .map(file => path.join(options.baseline, file));
        
        if (baselineFiles.length === 0) {
          throw new Error(`No performance metrics JSON files found in ${options.baseline}`);
        }
        
        // Sort by file modification time (newest first)
        baselineFiles.sort((a, b) => {
          return fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime();
        });
        
        baselineData = loadPerformanceData(baselineFiles[0]);
        console.log(`Loaded baseline from ${baselineFiles[0]}`);
      } else {
        baselineData = loadPerformanceData(options.baseline);
        console.log(`Loaded baseline from ${options.baseline}`);
      }
    } catch (error) {
      console.error('Error loading baseline data:', error);
      process.exit(1);
    }
    
    try {
      if (fs.statSync(options.current).isDirectory()) {
        // Find the most recent JSON file in the directory
        const currentFiles = fs.readdirSync(options.current)
          .filter(file => file.endsWith('.json') && file.startsWith('perf-metrics-'))
          .map(file => path.join(options.current, file));
        
        if (currentFiles.length === 0) {
          throw new Error(`No performance metrics JSON files found in ${options.current}`);
        }
        
        // Sort by file modification time (newest first)
        currentFiles.sort((a, b) => {
          return fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime();
        });
        
        currentData = loadPerformanceData(currentFiles[0]);
        console.log(`Loaded current data from ${currentFiles[0]}`);
      } else {
        currentData = loadPerformanceData(options.current);
        console.log(`Loaded current data from ${options.current}`);
      }
    } catch (error) {
      console.error('Error loading current data:', error);
      process.exit(1);
    }
    
    // Compare metrics
    const significanceThreshold = parseFloat(options.threshold);
    const comparisonResults = compareMetrics(
      baselineData.metrics,
      currentData.metrics,
      significanceThreshold
    );
    
    // Generate HTML report
    generateComparisonReport(
      comparisonResults,
      baselineData,
      currentData,
      options.output
    );
    
    // Log results
    const regressions = comparisonResults.filter(r => !r.improved);
    const improvements = comparisonResults.filter(r => r.improved);
    
    console.log(`Found ${comparisonResults.length} significant changes:`);
    console.log(`- ${regressions.length} regressions`);
    console.log(`- ${improvements.length} improvements`);
    console.log(`Comparison report generated at: ${options.output}`);
    
    // Exit with status code based on regressions
    process.exit(regressions.length > 0 ? 1 : 0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the script
main();

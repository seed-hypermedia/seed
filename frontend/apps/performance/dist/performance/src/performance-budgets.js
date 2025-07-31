"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultBudgets = void 0;
exports.checkPerformanceBudgets = checkPerformanceBudgets;
exports.generateBudgetReport = generateBudgetReport;
exports.loadBudgetsFromFile = loadBudgetsFromFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Default performance budgets
 */
exports.defaultBudgets = [
    // App startup budgets
    {
        metric: 'appStartupTime',
        scenario: 'app-startup',
        threshold: 3000, // 3 seconds
        operator: 'lt',
        severity: 'error',
        description: 'App startup time should be less than 3 seconds',
    },
    {
        metric: 'firstContentfulPaint',
        scenario: 'app-startup',
        threshold: 1500, // 1.5 seconds
        operator: 'lt',
        severity: 'warning',
        description: 'First Contentful Paint should be less than 1.5 seconds',
    },
    // Memory budgets
    {
        metric: 'jsHeapUsedSize',
        scenario: 'app-startup',
        threshold: 100 * 1024 * 1024, // 100 MB
        operator: 'lt',
        severity: 'warning',
        description: 'JS Heap usage should be less than 100 MB after startup',
    },
    // CPU usage budgets
    {
        metric: 'cpuUsage.percentCPUUsage',
        scenario: 'app-startup',
        threshold: 30, // 30%
        operator: 'lt',
        severity: 'warning',
        description: 'CPU usage should be less than 30% during startup',
    },
    // Navigation budgets
    {
        metric: 'loadTime',
        scenario: 'navigation-performance',
        threshold: 1000, // 1 second
        operator: 'lt',
        severity: 'warning',
        description: 'Navigation between views should take less than 1 second',
    },
    // JavaScript execution budgets
    {
        metric: 'scriptDuration',
        scenario: 'heavy-operation',
        threshold: 500, // 500 ms
        operator: 'lt',
        severity: 'warning',
        description: 'Script execution time should be less than 500ms during heavy operations',
    },
    // Lighthouse score budgets
    {
        metric: 'lighthouse.performanceScore',
        scenario: 'lighthouse',
        threshold: 80, // Score out of 100
        operator: 'gte',
        severity: 'warning',
        description: 'Lighthouse performance score should be at least 80',
    },
    // Frame rate budgets
    {
        metric: 'frameRate',
        scenario: 'heavy-operation',
        threshold: 30, // 30 FPS
        operator: 'gte',
        severity: 'error',
        description: 'Frame rate should be at least 30 FPS during heavy operations',
    },
];
/**
 * Checks metrics against defined performance budgets
 */
function checkPerformanceBudgets(metrics, budgets = exports.defaultBudgets) {
    const violations = [];
    const passed = [];
    for (const budget of budgets) {
        // Get the scenario metrics
        const scenarioMetrics = metrics[budget.scenario];
        // Skip if scenario is not found
        if (!scenarioMetrics) {
            continue;
        }
        // Handle nested metrics (e.g., cpuUsage.percentCPUUsage)
        let actualValue;
        if (budget.metric.includes('.')) {
            const [parent, child] = budget.metric.split('.');
            // Use indexing with assertion
            const parentValue = scenarioMetrics[parent];
            actualValue =
                parentValue && typeof parentValue === 'object'
                    ? parentValue[child]
                    : undefined;
        }
        else {
            // Use indexing with assertion
            actualValue = scenarioMetrics[budget.metric];
        }
        // Skip if metric is not found
        if (actualValue === undefined) {
            continue;
        }
        // Check against threshold
        let budgetViolated = false;
        switch (budget.operator) {
            case 'lt':
                budgetViolated = !(actualValue < budget.threshold);
                break;
            case 'lte':
                budgetViolated = !(actualValue <= budget.threshold);
                break;
            case 'gt':
                budgetViolated = !(actualValue > budget.threshold);
                break;
            case 'gte':
                budgetViolated = !(actualValue >= budget.threshold);
                break;
        }
        // Calculate percentage difference
        const percentageDiff = ((actualValue - budget.threshold) / budget.threshold) * 100;
        // Create violation or passed record
        const result = {
            budget,
            actualValue,
            expectedValue: budget.threshold,
            percentageDiff,
        };
        if (budgetViolated) {
            violations.push(result);
        }
        else {
            passed.push(result);
        }
    }
    return {
        violations,
        passed,
        timestamp: new Date().toISOString(),
    };
}
/**
 * Generates an HTML report for budget violations
 */
function generateBudgetReport(result, outputPath) {
    const errorViolations = result.violations.filter((v) => v.budget.severity === 'error');
    const warningViolations = result.violations.filter((v) => v.budget.severity === 'warning');
    // Sort violations by percentage difference (worst first)
    errorViolations.sort((a, b) => Math.abs(b.percentageDiff) - Math.abs(a.percentageDiff));
    warningViolations.sort((a, b) => Math.abs(b.percentageDiff) - Math.abs(a.percentageDiff));
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Performance Budget Report</title>
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
    .error-number {
      color: #e74c3c;
    }
    .warning-number {
      color: #f39c12;
    }
    .success-number {
      color: #2ecc71;
    }
    .violations {
      margin-bottom: 30px;
    }
    .violation-card {
      background: #fff;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      border-left: 5px solid #e74c3c;
    }
    .violation-card.warning {
      border-left-color: #f39c12;
    }
    .violation-header {
      display: flex;
      justify-content: space-between;
    }
    .violation-metric {
      font-weight: bold;
      font-size: 1.1rem;
    }
    .violation-scenario {
      color: #7f8c8d;
    }
    .violation-value {
      display: flex;
      margin-top: 10px;
      font-family: monospace;
    }
    .violation-values {
      display: flex;
      margin-top: 10px;
      justify-content: space-between;
    }
    .value-box {
      text-align: center;
      background: #f8f9fa;
      border-radius: 5px;
      padding: 10px;
      flex: 1;
      margin: 0 5px;
    }
    .value-label {
      font-size: 0.8rem;
      color: #7f8c8d;
    }
    .value-number {
      font-size: 1.2rem;
      font-weight: bold;
    }
    .actual-value {
      color: #e74c3c;
    }
    .expected-value {
      color: #2ecc71;
    }
    .diff-value {
      color: #7f8c8d;
    }
    .diff-value.bad {
      color: #e74c3c;
    }
    .diff-value.good {
      color: #2ecc71;
    }
    .badge {
      display: inline-block;
      padding: 3px 7px;
      border-radius: 3px;
      font-size: 0.8rem;
      font-weight: bold;
      color: white;
    }
    .badge-error {
      background-color: #e74c3c;
    }
    .badge-warning {
      background-color: #f39c12;
    }
    .passed-budgets {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin-top: 30px;
    }
    .passed-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
    }
    .passed-table th, .passed-table td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    .passed-table th {
      background-color: #f2f2f2;
    }
  </style>
</head>
<body>
  <h1>Performance Budget Report</h1>
  <p>Generated on ${new Date().toLocaleString()}</p>
  
  <div class="summary">
    <div class="summary-box">
      <div class="summary-number error-number">${errorViolations.length}</div>
      <div>Error Violations</div>
    </div>
    <div class="summary-box">
      <div class="summary-number warning-number">${warningViolations.length}</div>
      <div>Warning Violations</div>
    </div>
    <div class="summary-box">
      <div class="summary-number success-number">${result.passed.length}</div>
      <div>Passed Budgets</div>
    </div>
  </div>

  ${errorViolations.length > 0
        ? `
  <div class="violations">
    <h2>Error Violations</h2>
    ${errorViolations.map((v) => generateViolationCard(v, 'error')).join('')}
  </div>
  `
        : ''}

  ${warningViolations.length > 0
        ? `
  <div class="violations">
    <h2>Warning Violations</h2>
    ${warningViolations
            .map((v) => generateViolationCard(v, 'warning'))
            .join('')}
  </div>
  `
        : ''}

  ${result.passed.length > 0
        ? `
  <div class="passed-budgets">
    <h2>Passed Budgets</h2>
    <table class="passed-table">
      <thead>
        <tr>
          <th>Metric</th>
          <th>Scenario</th>
          <th>Actual Value</th>
          <th>Budget</th>
          <th>Difference</th>
        </tr>
      </thead>
      <tbody>
        ${result.passed
            .map((p) => `
        <tr>
          <td>${formatMetricName(p.budget.metric)}</td>
          <td>${formatScenarioName(p.budget.scenario)}</td>
          <td>${formatValue(p.actualValue, p.budget.metric)}</td>
          <td>${formatOperator(p.budget.operator)} ${formatValue(p.budget.threshold, p.budget.metric)}</td>
          <td class="${getDiffClass(p.percentageDiff, p.budget.operator)}">${formatDiff(p.percentageDiff, p.budget.operator)}</td>
        </tr>
        `)
            .join('')}
      </tbody>
    </table>
  </div>
  `
        : ''}
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
    console.log(`Budget report generated at: ${outputPath}`);
}
/**
 * Helper to generate a violation card
 */
function generateViolationCard(violation, type) {
    const { budget, actualValue, expectedValue, percentageDiff } = violation;
    return `
    <div class="violation-card ${type}">
      <div class="violation-header">
        <div>
          <div class="violation-metric">${formatMetricName(budget.metric)}</div>
          <div class="violation-scenario">Scenario: ${formatScenarioName(budget.scenario)}</div>
        </div>
        <div>
          <span class="badge badge-${type}">${type.toUpperCase()}</span>
        </div>
      </div>
      <p>${budget.description}</p>
      <div class="violation-values">
        <div class="value-box">
          <div class="value-label">Actual</div>
          <div class="value-number actual-value">${formatValue(actualValue, budget.metric)}</div>
        </div>
        <div class="value-box">
          <div class="value-label">Budget</div>
          <div class="value-number expected-value">${formatOperator(budget.operator)} ${formatValue(expectedValue, budget.metric)}</div>
        </div>
        <div class="value-box">
          <div class="value-label">Difference</div>
          <div class="value-number diff-value ${getDiffClass(percentageDiff, budget.operator)}">${formatDiff(percentageDiff, budget.operator)}</div>
        </div>
      </div>
    </div>
  `;
}
/**
 * Helper to format metric names
 */
function formatMetricName(metric) {
    // Handle nested metrics
    if (metric.includes('.')) {
        const parts = metric.split('.');
        return `${formatMetricName(parts[0])} - ${formatMetricName(parts[1])}`;
    }
    // Convert camelCase to Title Case with spaces
    const words = metric.replace(/([A-Z])/g, ' $1').trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
}
/**
 * Helper to format scenario names
 */
function formatScenarioName(scenario) {
    // Convert kebab-case to Title Case
    return scenario
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
/**
 * Helper to format values with units
 */
function formatValue(value, metric) {
    // Apply units based on metric type
    if (metric.includes('Time') || metric.endsWith('Duration')) {
        return `${value.toFixed(2)} ms`;
    }
    else if (metric.includes('Size')) {
        return `${(value / (1024 * 1024)).toFixed(2)} MB`;
    }
    else if (metric.includes('CPU')) {
        return `${value.toFixed(2)}%`;
    }
    else if (metric === 'frameRate') {
        return `${value.toFixed(1)} fps`;
    }
    else if (metric.includes('Score')) {
        return value.toFixed(0);
    }
    return value.toFixed(2);
}
/**
 * Helper to format operators
 */
function formatOperator(operator) {
    switch (operator) {
        case 'lt':
            return '<';
        case 'lte':
            return '≤';
        case 'gt':
            return '>';
        case 'gte':
            return '≥';
        default:
            return operator;
    }
}
/**
 * Helper to format difference values
 */
function formatDiff(diff, operator) {
    const sign = diff >= 0 ? '+' : '';
    return `${sign}${diff.toFixed(2)}%`;
}
/**
 * Helper to get diff class
 */
function getDiffClass(diff, operator) {
    // For 'less than' operators, negative diffs are good
    if (operator === 'lt' || operator === 'lte') {
        return diff <= 0 ? 'good' : 'bad';
    }
    // For 'greater than' operators, positive diffs are good
    else {
        return diff >= 0 ? 'good' : 'bad';
    }
}
/**
 * Load custom performance budgets from a JSON file
 */
function loadBudgetsFromFile(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const budgets = JSON.parse(content);
        return budgets;
    }
    catch (error) {
        console.error(`Error loading performance budgets from ${filePath}:`, error);
        return exports.defaultBudgets;
    }
}

# Desktop Performance Testing

This directory contains tools and utilities for measuring, analyzing, and monitoring the performance of the desktop Electron application.

## Overview

This is a comprehensive performance testing framework designed for an Electron desktop application. It's used to measure, monitor, and analyze various performance aspects of the application.

### What run-performance-tests.ts Does:

This script is the main entry point for the performance testing framework and performs the following actions:

#### Test Configuration:

- Parses command-line options that control which tests to run and how
- Sets up output directories for test results
- Loads performance budgets (threshold values for acceptable performance)

#### Performance Measurement:

- Always measures app startup time
- Runs specified performance scenarios, which can include:
- Dashboard loading performance
- Navigation between views
- Other custom scenarios
- Optionally runs Lighthouse audits for web performance metrics
- Optionally runs best practices checks for the app

#### Metrics Collection:

- The framework collects an extensive set of performance metrics, including:
- Rendering metrics (paint times, layout durations)
- Memory usage metrics
- CPU usage statistics
- Frame rates
- JavaScript execution metrics (task durations, garbage collection time)
- Web performance metrics (via Lighthouse)

#### Results Processing and Reporting:
- Saves all metrics to JSON files
- Compares results against performance budgets
- Generates HTML reports and dashboards
- Creates CI-friendly summaries

#### Budget Enforcement:

- Can be configured to fail the test run if performance metrics exceed error thresholds
- Helps enforce performance standards in the development process

#### Output of Running the Script:

When you run run-performance-tests.ts, you get:
- JSON Files: Raw performance metrics for each test scenario
- HTML Reports: Visual representations of the performance data
- Dashboard: An interactive dashboard for visualizing performance over time
- Budget Reports: Showing which metrics passed or failed their thresholds
- Trace Files: (If tracing is enabled) For in-depth performance analysis
- Console Output: Summary of test results and any performance budget violations

This framework is designed to be used in both development and CI environments to continually monitor and improve the performance of the desktop application, ensuring it meets defined performance standards.

## Getting Started

### Prerequisites

- Node.js v16 or later
- Electron application must be built and available in the `frontend/apps/desktop/out` directory

### Installation

```bash
# Navigate to the performance directory
cd frontend/apps/performance

# Install dependencies
pnpm install
```

## Running Performance Tests

### Basic Usage

To run all performance tests with default settings:

```bash
# From the project root
pnpm performance

# OR from the performance directory
pnpm test
```

### Advanced Options

The performance testing tool provides several command-line options:

```bash
# Run specific scenarios
pnpm test --scenarios app-startup,dashboard-view,navigation-performance

# Generate HTML dashboard
pnpm test:dashboard
# OR
pnpm test --dashboard

# Check performance against budgets
pnpm test --budget

# Use a custom budget file
pnpm test --budget --budget-file ./custom-budgets.json

# Enable Chrome DevTools tracing
pnpm test --trace

# Run Lighthouse audits
pnpm test --lighthouse --url http://localhost:9222

# Check adherence to performance best practices
pnpm test --best-practices

# Specify output directory
pnpm test --output ./custom-results

# Fail CI if budget violations are found
pnpm test --budget --fail-on-budget-error

# Run in CI mode
pnpm test:ci
# OR
pnpm test --ci --dashboard --upload
```

## Available Scenarios

The framework includes several pre-defined performance scenarios:

- **app-startup**: Measures the time it takes for the app to start up
- **dashboard-view**: Measures the performance of the main dashboard view
- **navigation-performance**: Measures the performance of navigating between different app sections
- **heavy-operation**: Measures performance during resource-intensive operations
- **ipc-communication**: Measures performance of IPC communication between main and renderer processes
- **memory-usage**: Measures memory consumption during typical usage
- **window-management**: Measures performance when opening, closing, and managing windows
- **large-content**: Measures performance when loading and rendering large content

## Comparing Performance Results

You can compare performance results between different runs to identify regressions:

```bash
# Compare current results with a baseline
pnpm test:performance-compare \
  --baseline ./baseline-metrics/perf-metrics-latest.json \
  --current ./current-metrics/perf-metrics-latest.json \
  --output ./comparison-report.html

# Set a custom threshold for significant changes (default: 5%)
pnpm test:performance-compare --threshold 3
```

## Performance Metrics

The framework captures a wide range of performance metrics:

### Application Metrics
- **App Startup Time**: Time from application launch to ready state
- **Load Time**: Time to load and render pages
- **Navigation Time**: Time to navigate between pages
- **First Paint**: Time to first paint
- **First Contentful Paint**: Time to first contentful paint
- **Largest Contentful Paint**: Time to largest contentful paint

### Memory Metrics
- **JS Heap Used Size**: Amount of memory used by the JavaScript heap
- **JS Heap Total Size**: Total size of the JavaScript heap
- **Process Memory Usage**: Memory used by the Electron processes

### CPU Metrics
- **Percent CPU Usage**: Percentage of CPU utilized
- **Idle Wakeups Per Second**: Number of times CPU wakes from idle state
- **Task Duration**: Time spent on CPU tasks

### Frame Rate Metrics
- **Frame Rate**: Frames per second during animations and interactions
- **Dropped Frames**: Number of frames dropped during rendering

### JavaScript Metrics
- **Script Execution Time**: Time spent executing JavaScript
- **GC Time**: Time spent in garbage collection

### Lighthouse Metrics
- **Performance Score**: Overall performance score from Lighthouse
- **First Contentful Paint**: Time to first contentful paint (Lighthouse)
- **Speed Index**: Speed Index score from Lighthouse
- **Largest Contentful Paint**: Time to largest contentful paint (Lighthouse)
- **Time to Interactive**: Time to interactive score from Lighthouse
- **Total Blocking Time**: Total blocking time score from Lighthouse
- **Cumulative Layout Shift**: Cumulative layout shift score from Lighthouse

## Best Practices Checker

The best practices checker evaluates your application against Electron performance best practices in the following categories:

- JavaScript and memory usage
- Window management
- Renderer process optimizations
- IPC communication
- CPU usage and background tasks

## Performance Budgets

Performance budgets define thresholds for various metrics to prevent regressions. Default budgets are provided, but you can create a custom budget file:

```json
[
  {
    "metric": "appStartupTime",
    "threshold": 2000,
    "operator": "<",
    "scenario": "app-startup",
    "severity": "error",
    "description": "App startup time should be less than 2 seconds"
  },
  {
    "metric": "firstContentfulPaint",
    "threshold": 1000,
    "operator": "<",
    "scenario": "dashboard-view",
    "severity": "warning",
    "description": "First contentful paint should be less than 1 second"
  }
]
```

## Reports and Dashboards

### Performance Dashboard

The project includes a modern visualization dashboard built with Vite, React, and Tailwind CSS. The dashboard reads the performance test results and provides an interactive interface for exploring metrics, traces, and screenshots.

#### Running the Dashboard

```bash
# Navigate to the dashboard directory
cd ../performance-dashboard

# Install dependencies
pnpm install

# Start the development server
pnpm dev
```

#### Building the Dashboard

```bash
# Build the dashboard for production
cd ../performance-dashboard
pnpm build
```

The built dashboard will be available in the `performance-dashboard/dist` directory and can be served by any static file server.

#### Dashboard Features

- View all performance test reports
- Examine detailed metrics for each test scenario
- Access performance traces and screenshots
- Compare results across different test runs

### Legacy HTML Reports

The performance testing framework also generates the following static HTML reports:

- **Performance Dashboard**: Interactive HTML dashboard with charts and tables for all metrics
- **Budget Report**: Report showing passed and violated performance budgets
- **Best Practices Report**: Report showing adherence to performance best practices
- **Comparison Report**: Report comparing performance between different runs

All reports are saved to the `results` directory by default.

## Project Structure

```
frontend/apps/
├── performance/
│   ├── README.md                    # This documentation
│   ├── package.json                 # Project configuration and dependencies
│   ├── tsconfig.json                # TypeScript configuration
│   ├── utils.ts                     # Utility helpers to bridge with desktop app
│   ├── perf-utils.ts                # Core performance utilities
│   ├── run-performance-tests.ts     # Main command-line runner
│   ├── scenarios.ts                 # Performance test scenarios
│   ├── trace-collector.ts           # Chrome DevTools trace utilities
│   ├── dashboard-generator.ts       # HTML dashboard generator
│   ├── best-practices-checker.ts    # Performance best practices checker
│   ├── performance-budgets.ts       # Performance budget utilities
│   ├── compare-performance.ts       # Performance comparison tool
│   └── results/                     # Directory where test results are stored
│
└── performance-dashboard/           # Modern React dashboard for visualizing results
```

## Troubleshooting

### Common Issues

- **Missing Desktop App Build**: Ensure the desktop application is built and available in `frontend/apps/desktop/out` directory.
- **Tests running slowly**: Make sure your machine has sufficient resources. Consider running with fewer scenarios or disabling trace collection for faster runs.
- **Missing metrics**: Some metrics may only be available in certain scenarios or require specific options (e.g., Lighthouse metrics require the `--lighthouse` flag).
- **Browser context errors**: These may indicate issues with Playwright setup or insufficient system resources.
- **Tracing errors**: "Tracing was not running" warnings are generally non-critical and can be ignored.

### Debugging

For more detailed output while running tests:

```bash
DEBUG=electron:*,playwright:* pnpm test
```

## Contributing

When adding new metrics or features to the performance testing framework:

1. Update the appropriate utility files
2. Update the dashboard generator to visualize new metrics
3. Add new metrics to the default performance budgets
4. Update this documentation 

## Lighthouse Audits for Electron Apps

When running Lighthouse audits against an Electron app, you can now use one of two approaches:

### Option 1: Automatic App Launch (Recommended)

The simplest way to run Lighthouse audits is to let the framework automatically launch your Electron app:

```bash
# Run Lighthouse with automatic app launching
pnpm test --lighthouse

# Or use the helper script
./frontend/apps/performance/run-lighthouse.sh
```

This will:
1. Automatically start your Electron app
2. Determine the correct URL to audit
3. Run Lighthouse against that URL
4. Clean up all processes when finished

### Option 2: Manual App Launch

Alternatively, if you need more control or want to test a specific URL:

1. **Start your development server** in a separate terminal:
   ```bash
   # Terminal 1: Start dev server
   cd your-electron-app-root
   pnpm dev   # or npm run dev
   ```

2. **Verify the URL** works in a browser (e.g., http://localhost:5173 for Vite)

3. **Run Lighthouse** with the correct URL:
   ```bash
   # Terminal 2: Run Lighthouse audit
   cd frontend/apps/performance
   pnpm test --lighthouse --url http://localhost:5173
   ```

### Common Issues

- **Chrome Debugging Port**: The URL `http://localhost:9222` is the Chrome debugging port, not your app's content. If you specify this port, the framework will automatically detect this and use the correct URL instead.
- **No Content Painted**: If you see "The page did not paint any content" errors, it may indicate issues with how your app is rendering content in the automated environment.
- **Chrome Interstitial Warnings**: Errors like "Chrome prevented page load with an interstitial" typically mean that Chrome detected a security issue or couldn't connect to the URL.

### Detailed Troubleshooting

#### "Chrome prevented page load with an interstitial" Error

This error occurs when:
1. **Development server isn't running**: Make sure your Vite/Webpack server is running before running Lighthouse tests
   ```bash
   # Start your development server in a separate terminal
   cd your-electron-app
   pnpm dev   # or npm run dev
   ```

2. **Incorrect URL**: Verify the URL in a regular browser first to see if it loads properly
   ```bash
   # In another terminal, run Lighthouse with the correct URL
   pnpm test --lighthouse --url http://localhost:5173
   ```

3. **Port conflict**: Check if something else is using the specified port
   ```bash
   # Check what's using port 5173 (for Vite)
   lsof -i:5173    # On macOS/Linux
   netstat -ano | findstr :5173    # On Windows
   ```

#### Easy Setup with Helper Script

We've included a helper script that handles the common issues automatically:

```bash
# Use the helper script to run Lighthouse tests
./frontend/apps/performance/run-lighthouse.sh
```

This script:
1. Checks if your Vite server is running at http://localhost:5173
2. Provides clear instructions if no server is detected
3. Runs the Lighthouse test only when a working server is confirmed

#### Step-by-Step Process

For reliable Lighthouse audits with Electron apps:

1. **Start your development server** in a separate terminal:
   ```bash
   # Terminal 1: Start dev server
   cd your-electron-app-root
   pnpm dev   # or npm run dev
   ```

2. **Verify the URL** works in a browser (e.g., http://localhost:5173 for Vite)

3. **Run Lighthouse** with the correct URL:
   ```bash
   # Terminal 2: Run Lighthouse audit
   cd frontend/apps/performance
   pnpm test --lighthouse --url http://localhost:5173
   ```

If you continue to have issues, try running Lighthouse directly against your app without the Chrome debugging port:

```bash
npx lighthouse http://localhost:5173 --chrome-flags="--headless" --output=json
```

### Troubleshooting

If Lighthouse audits are failing:

1. Ensure your Electron app is actually running and serving web content
2. Verify the URL is correct by opening it in a regular browser (try http://localhost:5173 for Vite-based apps)
3. For complex Electron apps, consider setting up a dedicated web server that mirrors your app's content 
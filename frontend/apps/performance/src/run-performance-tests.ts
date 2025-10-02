#!/usr/bin/env node

import {program} from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import {
  generateBestPracticesReport,
  runBestPracticeChecks,
} from './best-practices-checker'
import {
  measureAppStartupTime,
  PerformanceMetrics,
  PerformanceScenario,
  runLighthouseAudit,
  runPerformanceScenario,
  saveMetricsToJson,
} from './perf-utils'
import {
  checkPerformanceBudgets,
  defaultBudgets,
  generateBudgetReport,
  loadBudgetsFromFile,
} from './performance-budgets'
import {allScenarios, appStartupScenario, getScenarioByName} from './scenarios'
import {startApp} from './utils'

// Set up CLI options
program
  .name('run-performance-tests')
  .description('Run performance tests on the Electron desktop app')
  .version('0.1.0')

program
  .option(
    '-s, --scenarios <scenarios>',
    'Comma-separated list of scenarios to run (default: all)',
    'all',
  )
  .option(
    '-o, --output-dir <dir>',
    'Output directory for test results',
    'results',
  )
  .option('-b, --best-practices', 'Run best practices checks', false)
  .option('-l, --lighthouse', 'Run Lighthouse audits', false)
  .option('--ci', 'Run in CI mode', false)
  .option(
    '--url <url>',
    'URL to run Lighthouse audit against (required for lighthouse option)',
    'http://localhost:9222',
  )
  .option('--budget', 'Check performance against budgets', false)
  .option('--budget-file <file>', 'Custom performance budget file (JSON)')
  .option('--trace', 'Collect and analyze Chrome DevTools traces', false)
  .option(
    '--fail-on-budget-error',
    'Exit with error code if budget error violations are found',
    false,
  )

program.parse()

const options = program.opts()

async function main() {
  console.log('🚀 Starting Electron app performance tests...')

  // Prepare results directory
  const outputDir = path.resolve(options.outputDir)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, {recursive: true})
  }

  // Create traces directory if tracing is enabled
  const tracesDir = path.join(outputDir, 'traces')
  if (options.trace && !fs.existsSync(tracesDir)) {
    fs.mkdirSync(tracesDir, {recursive: true})
  }

  // Load custom performance budgets if provided
  let performanceBudgets = defaultBudgets
  if (options.budgetFile) {
    try {
      performanceBudgets = loadBudgetsFromFile(options.budgetFile)
      console.log(
        `📋 Loaded custom performance budgets from ${options.budgetFile}`,
      )
    } catch (error) {
      console.error(`❌ Error loading performance budgets:`, error)
      process.exit(1)
    }
  }

  // Determine which scenarios to run
  let scenariosToRun = allScenarios
  if (options.scenarios !== 'all') {
    const scenarioNames = options.scenarios.split(',')
    scenariosToRun = scenarioNames
      .map((name: string) => getScenarioByName(name))
      .filter(
        (scenario: PerformanceScenario | undefined) => !!scenario,
      ) as PerformanceScenario[]

    if (scenariosToRun.length === 0) {
      console.error('Error: No valid scenarios specified')
      process.exit(1)
    }
  }

  // Run the tests
  const results: Record<string, PerformanceMetrics> = {}

  // Always measure startup time
  console.log('📊 Measuring app startup time...')
  results[appStartupScenario.name] = await measureAppStartupTime()

  // Run each scenario
  for (const scenario of scenariosToRun) {
    if (scenario.name === appStartupScenario.name) {
      continue // Already measured
    }

    console.log(`📊 Running scenario: ${scenario.name}`)
    try {
      results[scenario.name] = await runPerformanceScenario(scenario)
      console.log(`✅ Completed scenario: ${scenario.name}`)
    } catch (error) {
      console.error(`❌ Error running scenario ${scenario.name}:`, error)
    }
  }

  // Run Lighthouse audit if requested
  if (options.lighthouse) {
    if (!options.url) {
      console.error('Error: URL is required for Lighthouse audit')
      process.exit(1)
    }

    console.log(`📊 Running Lighthouse audit on ${options.url}...`)
    try {
      // Make sure URL has proper http:// prefix
      let urlToAudit = options.url
      if (
        !urlToAudit.startsWith('http://') &&
        !urlToAudit.startsWith('https://')
      ) {
        urlToAudit = `http://${urlToAudit}`
      }

      console.log(
        'NOTE: For Electron apps, the URL should be the actual web server URL where your app content is served.',
      )
      console.log(
        "      The URL 'localhost:9222' is typically just the Chrome debugging port, not your actual app.",
      )
      console.log(
        "      For Vite-based apps, try 'http://localhost:5173' instead.",
      )

      // Add retry logic for Lighthouse
      let retries = 3
      let lighthouseMetrics: PerformanceMetrics = {}

      while (retries > 0) {
        try {
          lighthouseMetrics = await runLighthouseAudit(urlToAudit)
          // Check if we have valid metrics
          if (
            lighthouseMetrics &&
            'lighthouse' in lighthouseMetrics &&
            lighthouseMetrics.lighthouse &&
            typeof lighthouseMetrics.lighthouse.performanceScore === 'number'
          ) {
            break // Success, exit retry loop
          }
          throw new Error('Invalid Lighthouse metrics result')
        } catch (error) {
          retries--
          if (retries === 0) throw error
          console.log(`Retrying Lighthouse audit (${retries} attempts left)...`)
          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }

      results['lighthouse'] = lighthouseMetrics
      console.log('✅ Lighthouse audit completed')
    } catch (error) {
      console.error('❌ Error running Lighthouse audit:', error)

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
      }

      results['lighthouse'] = fallbackMetrics
      console.log('⚠️ Using fallback Lighthouse metrics due to error')
    }
  }

  // Run best practices checks if requested
  if (options.bestPractices) {
    console.log('📊 Running best practices checks...')
    try {
      // Launch the app again for best practices checks
      const {app, appWindow} = await startApp()
      const bestPracticesResults = await runBestPracticeChecks(app, appWindow)

      // Generate best practices report
      const bestPracticesReportPath = path.join(
        outputDir,
        'best-practices-report.html',
      )
      generateBestPracticesReport(bestPracticesResults, bestPracticesReportPath)
      console.log(
        `✅ Best practices report generated at: ${bestPracticesReportPath}`,
      )

      await app.close()
    } catch (error) {
      console.error('❌ Error running best practices checks:', error)
    }
  }

  // Save results
  const resultsPath = await saveMetricsToJson(results, outputDir)
  console.log(`💾 Results saved to: ${resultsPath}`)

  // Check performance against budgets if requested
  if (options.budget) {
    console.log('📋 Checking performance against budgets...')
    try {
      const budgetResults = checkPerformanceBudgets(results, performanceBudgets)

      // Generate budget report
      const budgetReportPath = path.join(outputDir, 'budget-report.html')
      generateBudgetReport(budgetResults, budgetReportPath)
      console.log(`✅ Budget report generated at: ${budgetReportPath}`)

      // Report violations
      const errorViolations = budgetResults.violations.filter(
        (v) => v.budget.severity === 'error',
      )
      const warningViolations = budgetResults.violations.filter(
        (v) => v.budget.severity === 'warning',
      )

      if (errorViolations.length > 0 || warningViolations.length > 0) {
        console.log(`⚠️ Performance budget violations found:`)
        if (errorViolations.length > 0) {
          console.log(`   - ${errorViolations.length} error violations`)
        }
        if (warningViolations.length > 0) {
          console.log(`   - ${warningViolations.length} warning violations`)
        }
        console.log(`   See the budget report for details: ${budgetReportPath}`)

        // Exit with error if requested and there are error violations
        if (options.failOnBudgetError && errorViolations.length > 0) {
          console.error('❌ Error: Performance budget error violations found.')
          process.exit(1)
        }
      } else {
        console.log('✅ All performance budgets passed!')
      }
    } catch (error) {
      console.error('❌ Error checking performance budgets:', error)
    }
  }

  // Generate summary for CI
  if (options.ci) {
    console.log('📝 Generating CI summary...')
    generateCISummary(results, outputDir)
  }

  console.log('✨ Performance testing complete')
}

/**
 * Generate a summary for CI environments (like GitHub Actions)
 */
function generateCISummary(
  results: Record<string, PerformanceMetrics>,
  outputDir: string,
): void {
  let summary = '## Electron App Performance Test Results\n\n'

  // Add startup metrics
  if (results['app-startup']) {
    const startup = results['app-startup']
    summary += '### App Startup Performance\n\n'
    summary += '| Metric | Value |\n'
    summary += '| ------ | ----- |\n'

    if (startup.appStartupTime) {
      summary += `| App Startup Time | ${startup.appStartupTime.toFixed(
        2,
      )} ms |\n`
    }

    if (startup.firstContentfulPaint) {
      summary += `| First Contentful Paint | ${startup.firstContentfulPaint.toFixed(
        2,
      )} ms |\n`
    }

    if (startup.loadTime) {
      summary += `| Load Time | ${startup.loadTime.toFixed(2)} ms |\n`
    }

    summary += '\n'
  }

  // Add memory metrics if available
  const hasMemoryMetrics = Object.values(results).some(
    (m) => m.jsHeapUsedSize !== undefined,
  )
  if (hasMemoryMetrics) {
    summary += '### Memory Usage\n\n'
    summary += '| Scenario | JS Heap Used (MB) | JS Heap Total (MB) |\n'
    summary += '| -------- | ----------------- | ------------------ |\n'

    for (const [scenario, metrics] of Object.entries(results)) {
      if (metrics.jsHeapUsedSize) {
        const jsHeapUsedMB = (metrics.jsHeapUsedSize / (1024 * 1024)).toFixed(2)
        const jsHeapTotalMB = metrics.jsHeapTotalSize
          ? (metrics.jsHeapTotalSize / (1024 * 1024)).toFixed(2)
          : 'N/A'

        summary += `| ${formatScenarioName(
          scenario,
        )} | ${jsHeapUsedMB} | ${jsHeapTotalMB} |\n`
      }
    }

    summary += '\n'
  }

  // Add CPU metrics if available
  const hasCpuMetrics = Object.values(results).some(
    (m) => m.cpuUsage !== undefined,
  )
  if (hasCpuMetrics) {
    summary += '### CPU Performance\n\n'
    summary += '| Scenario | CPU Usage (%) | Frame Rate (fps) |\n'
    summary += '| -------- | ------------- | ---------------- |\n'

    for (const [scenario, metrics] of Object.entries(results)) {
      if (metrics.cpuUsage || metrics.frameRate) {
        const cpuUsage = metrics.cpuUsage
          ? metrics.cpuUsage.percentCPUUsage.toFixed(2)
          : 'N/A'

        const frameRate = metrics.frameRate
          ? metrics.frameRate.toFixed(1)
          : 'N/A'

        summary += `| ${formatScenarioName(
          scenario,
        )} | ${cpuUsage} | ${frameRate} |\n`
      }
    }

    summary += '\n'
  }
}

// Helper function to format scenario names for display
function formatScenarioName(name: string): string {
  // Convert kebab-case to Title Case
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

main().catch((error) => {
  console.error('❌ Unhandled error:', error)
  process.exit(1)
})

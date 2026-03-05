#!/usr/bin/env node

/**
 * Web performance test runner.
 *
 * Launches a Chromium browser via Playwright, runs web interaction scenarios
 * against a running web app instance, and saves results as JSON.
 *
 * Usage:
 *   pnpm --filter @shm/performance run test:web [--url http://localhost:3000] [--output-dir results/web]
 */

import {program} from 'commander'
import * as fs from 'fs'
import * as path from 'path'
import {chromium} from 'playwright'
import {checkPerformanceBudgets, webBudgets} from './performance-budgets'
import {WebPerfResult, runAllWebScenarios} from './web-scenarios'

program
  .name('run-web-perf')
  .description('Run web performance tests against a live web app')
  .version('0.1.0')
  .option('--url <url>', 'Base URL of the web app', 'http://localhost:3000')
  .option('--doc-path <path>', 'Document path to test', '/')
  .option('--second-doc-path <path>', 'Second document path for navigation tests')
  .option('-o, --output-dir <dir>', 'Output directory for results', 'results/web')
  .option('--compare <baseline>', 'Path to baseline results JSON for comparison')
  .option('--fail-on-regression', 'Exit with error code if regressions detected', false)

program.parse()

const options = program.opts()

async function main() {
  console.log('Starting web performance tests...')
  console.log(`Target: ${options.url}`)

  // Prepare output directory
  const outputDir = path.resolve(options.outputDir)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, {recursive: true})
  }

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const context = await browser.newContext({
    viewport: {width: 1280, height: 720},
  })

  const page = await context.newPage()

  try {
    const results = await runAllWebScenarios(page, options.url, options.docPath, options.secondDocPath)

    // Save results
    const timestamp = new Date().toISOString()
    const data = {
      timestamp,
      url: options.url,
      scenarios: results,
      platform: process.platform,
      arch: process.arch,
    }

    const filePath = path.join(outputDir, `web-perf-${timestamp.replace(/:/g, '-')}.json`)
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
    console.log(`Results saved to: ${filePath}`)

    // Print summary
    printSummary(results)

    // Check budgets
    const budgetResults = checkWebBudgets(results)
    if (budgetResults.violations.length > 0) {
      console.log('\nBudget violations:')
      for (const v of budgetResults.violations) {
        const severity = v.budget.severity === 'error' ? 'ERROR' : 'WARN'
        console.log(`  [${severity}] ${v.budget.description}: ${v.actualValue.toFixed(1)} (budget: ${v.expectedValue})`)
      }
      if (options.failOnRegression && budgetResults.violations.some((v) => v.budget.severity === 'error')) {
        process.exit(1)
      }
    } else {
      console.log('\nAll performance budgets passed!')
    }

    // Compare with baseline if provided
    if (options.compare) {
      compareWithBaseline(results, options.compare)
    }
  } finally {
    await browser.close()
  }

  console.log('Web performance testing complete.')
}

function printSummary(results: WebPerfResult[]) {
  console.log('\n=== Web Performance Results ===\n')

  for (const result of results) {
    console.log(`  ${result.name}:`)

    if (result.lcp !== undefined) console.log(`    LCP: ${result.lcp.toFixed(1)}ms`)
    if (result.fcp !== undefined) console.log(`    FCP: ${result.fcp.toFixed(1)}ms`)
    if (result.cls !== undefined) console.log(`    CLS: ${result.cls.toFixed(4)}`)

    for (const [name, duration] of Object.entries(result.measures)) {
      console.log(`    ${name}: ${duration.toFixed(1)}ms`)
    }
    console.log()
  }
}

function checkWebBudgets(results: WebPerfResult[]) {
  // Convert web results to the format expected by performance-budgets
  const metricsRecord: Record<string, Record<string, number | undefined>> = {}

  for (const result of results) {
    const metrics: Record<string, number | undefined> = {
      ...result.measures,
    }
    if (result.lcp !== undefined) metrics['lcp'] = result.lcp
    if (result.fcp !== undefined) metrics['fcp'] = result.fcp
    if (result.cls !== undefined) metrics['cls'] = result.cls
    metricsRecord[result.name] = metrics
  }

  return checkPerformanceBudgets(metricsRecord as any, webBudgets)
}

function compareWithBaseline(current: WebPerfResult[], baselinePath: string) {
  try {
    const baselineData = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'))
    const baseline: WebPerfResult[] = baselineData.scenarios || []

    console.log('\n=== Comparison with Baseline ===\n')

    for (const currentResult of current) {
      const baselineResult = baseline.find((b) => b.name === currentResult.name)
      if (!baselineResult) {
        console.log(`  ${currentResult.name}: no baseline`)
        continue
      }

      console.log(`  ${currentResult.name}:`)

      // Compare measures
      for (const [name, currentDuration] of Object.entries(currentResult.measures)) {
        const baselineDuration = baselineResult.measures[name]
        if (baselineDuration !== undefined) {
          const diff = currentDuration - baselineDuration
          const pct = ((diff / baselineDuration) * 100).toFixed(1)
          const indicator = diff < 0 ? 'improved' : diff > 0 ? 'regressed' : 'unchanged'
          console.log(
            `    ${name}: ${currentDuration.toFixed(1)}ms (was ${baselineDuration.toFixed(1)}ms, ${pct}% ${indicator})`,
          )
        }
      }

      // Compare vitals
      for (const vital of ['lcp', 'fcp', 'cls'] as const) {
        const curr = currentResult[vital]
        const base = baselineResult[vital]
        if (curr !== undefined && base !== undefined) {
          const diff = curr - base
          const pct = ((diff / base) * 100).toFixed(1)
          const indicator = diff < 0 ? 'improved' : diff > 0 ? 'regressed' : 'unchanged'
          console.log(`    ${vital.toUpperCase()}: ${curr.toFixed(1)} (was ${base.toFixed(1)}, ${pct}% ${indicator})`)
        }
      }
    }
  } catch (e) {
    console.error(`Failed to load baseline from ${baselinePath}:`, e)
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})

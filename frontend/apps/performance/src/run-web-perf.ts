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
  .option('-n, --runs <number>', 'Number of iterations to run', '1')
  .option('-o, --output-dir <dir>', 'Output directory for results', 'results/web')
  .option('--compare <baseline>', 'Path to baseline results JSON for comparison')
  .option('--fail-on-regression', 'Exit with error code if regressions detected', false)

// Filter out bare '--' injected by pnpm before parsing
const argv = process.argv.filter((arg, i) => !(arg === '--' && i >= 2))
program.parse(argv)

const options = program.opts()

async function main() {
  const numRuns = Math.max(1, parseInt(options.runs, 10) || 1)
  console.log('Starting web performance tests...')
  console.log(`Target: ${options.url}`)
  console.log(`Doc path: ${options.docPath}`)
  console.log(`Runs: ${numRuns}`)

  // Prepare output directory
  const outputDir = path.resolve(options.outputDir)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, {recursive: true})
  }

  // Collect results from all runs
  const allRuns: WebPerfResult[][] = []

  for (let i = 0; i < numRuns; i++) {
    console.log(`\n--- Run ${i + 1}/${numRuns} ---`)

    // Fresh browser for each run to avoid cache effects
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
      allRuns.push(results)
      printRunSummary(i + 1, results)
    } finally {
      await browser.close()
    }
  }

  // Aggregate results
  const aggregated = aggregateResults(allRuns)

  // Save results
  const timestamp = new Date().toISOString()
  const data = {
    timestamp,
    url: options.url,
    docPath: options.docPath,
    runs: numRuns,
    scenarios: aggregated,
    allRuns: allRuns,
    platform: process.platform,
    arch: process.arch,
  }

  const filePath = path.join(outputDir, `web-perf-${timestamp.replace(/:/g, '-')}.json`)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
  console.log(`\nResults saved to: ${filePath}`)

  // Print aggregated summary
  printAggregatedSummary(aggregated)

  // Check budgets against median values
  const medianResults = aggregated.map((a) => ({
    name: a.name,
    measures: Object.fromEntries(Object.entries(a.measures).map(([k, v]) => [k, v.median])),
    lcp: a.lcp?.median,
    fcp: a.fcp?.median,
    cls: a.cls?.median,
  })) as WebPerfResult[]

  const budgetResults = checkWebBudgets(medianResults)
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
    compareWithBaseline(aggregated, options.compare)
  }

  console.log('\nWeb performance testing complete.')
}

interface AggregatedMetric {
  mean: number
  median: number
  min: number
  max: number
  stddev: number
  values: number[]
}

interface AggregatedResult {
  name: string
  measures: Record<string, AggregatedMetric>
  lcp?: AggregatedMetric
  fcp?: AggregatedMetric
  cls?: AggregatedMetric
}

function computeStats(values: number[]): AggregatedMetric {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  const stddev = Math.sqrt(variance)
  return {mean, median, min: sorted[0], max: sorted[sorted.length - 1], stddev, values: sorted}
}

function aggregateResults(allRuns: WebPerfResult[][]): AggregatedResult[] {
  if (allRuns.length === 0) return []

  // Use the first run's scenario names as the template
  const scenarioNames = allRuns[0].map((r) => r.name)

  return scenarioNames.map((name) => {
    const scenarioRuns = allRuns.map((run) => run.find((r) => r.name === name)).filter(Boolean) as WebPerfResult[]

    // Aggregate measures
    const allMeasureKeys = new Set<string>()
    for (const run of scenarioRuns) {
      for (const key of Object.keys(run.measures)) {
        allMeasureKeys.add(key)
      }
    }

    const measures: Record<string, AggregatedMetric> = {}
    for (const key of allMeasureKeys) {
      const values = scenarioRuns.map((r) => r.measures[key]).filter((v) => v !== undefined) as number[]
      if (values.length > 0) {
        measures[key] = computeStats(values)
      }
    }

    // Aggregate vitals
    const result: AggregatedResult = {name, measures}

    const lcpValues = scenarioRuns.map((r) => r.lcp).filter((v) => v !== undefined) as number[]
    if (lcpValues.length > 0) result.lcp = computeStats(lcpValues)

    const fcpValues = scenarioRuns.map((r) => r.fcp).filter((v) => v !== undefined) as number[]
    if (fcpValues.length > 0) result.fcp = computeStats(fcpValues)

    const clsValues = scenarioRuns.map((r) => r.cls).filter((v) => v !== undefined) as number[]
    if (clsValues.length > 0) result.cls = computeStats(clsValues)

    return result
  })
}

function printRunSummary(run: number, results: WebPerfResult[]) {
  for (const result of results) {
    const parts: string[] = []
    if (result.fcp !== undefined) parts.push(`FCP=${result.fcp.toFixed(0)}ms`)
    if (result.lcp !== undefined) parts.push(`LCP=${result.lcp.toFixed(0)}ms`)
    for (const [name, duration] of Object.entries(result.measures)) {
      parts.push(`${name}=${duration.toFixed(0)}ms`)
    }
    console.log(`  ${result.name}: ${parts.join(', ')}`)
  }
}

function printAggregatedSummary(results: AggregatedResult[]) {
  console.log('\n=== Aggregated Results ===\n')

  for (const result of results) {
    console.log(`  ${result.name}:`)

    if (result.fcp) {
      console.log(
        `    FCP:          median=${result.fcp.median.toFixed(0)}ms  mean=${result.fcp.mean.toFixed(0)}ms  min=${result.fcp.min.toFixed(0)}ms  max=${result.fcp.max.toFixed(0)}ms  stddev=${result.fcp.stddev.toFixed(0)}ms`,
      )
    }
    if (result.lcp) {
      console.log(
        `    LCP:          median=${result.lcp.median.toFixed(0)}ms  mean=${result.lcp.mean.toFixed(0)}ms  min=${result.lcp.min.toFixed(0)}ms  max=${result.lcp.max.toFixed(0)}ms  stddev=${result.lcp.stddev.toFixed(0)}ms`,
      )
    }
    if (result.cls) {
      console.log(
        `    CLS:          median=${result.cls.median.toFixed(4)}  mean=${result.cls.mean.toFixed(4)}  min=${result.cls.min.toFixed(4)}  max=${result.cls.max.toFixed(4)}  stddev=${result.cls.stddev.toFixed(4)}`,
      )
    }

    for (const [name, stats] of Object.entries(result.measures)) {
      console.log(
        `    ${name.padEnd(14)}median=${stats.median.toFixed(0)}ms  mean=${stats.mean.toFixed(0)}ms  min=${stats.min.toFixed(0)}ms  max=${stats.max.toFixed(0)}ms  stddev=${stats.stddev.toFixed(0)}ms`,
      )
    }
    console.log()
  }
}

function checkWebBudgets(results: WebPerfResult[]) {
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

function compareWithBaseline(current: AggregatedResult[], baselinePath: string) {
  try {
    const baselineData = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'))

    // Support both aggregated and single-run baseline formats
    const baseline: AggregatedResult[] = baselineData.scenarios.map((s: any) => {
      // If already aggregated (has .measures with .median), use directly
      if (s.measures && typeof Object.values(s.measures)[0] === 'object') {
        return s
      }
      // Single-run format: wrap values into stats objects
      return {
        name: s.name,
        measures: Object.fromEntries(
          Object.entries(s.measures).map(([k, v]) => [k, {median: v, mean: v, min: v, max: v, stddev: 0, values: [v]}]),
        ),
        fcp: s.fcp !== undefined ? {median: s.fcp, mean: s.fcp, min: s.fcp, max: s.fcp, stddev: 0, values: [s.fcp]} : undefined,
        lcp: s.lcp !== undefined ? {median: s.lcp, mean: s.lcp, min: s.lcp, max: s.lcp, stddev: 0, values: [s.lcp]} : undefined,
        cls: s.cls !== undefined ? {median: s.cls, mean: s.cls, min: s.cls, max: s.cls, stddev: 0, values: [s.cls]} : undefined,
      } as AggregatedResult
    })

    console.log('\n=== Comparison with Baseline ===\n')

    for (const currentResult of current) {
      const baselineResult = baseline.find((b) => b.name === currentResult.name)
      if (!baselineResult) {
        console.log(`  ${currentResult.name}: no baseline`)
        continue
      }

      console.log(`  ${currentResult.name}:`)

      // Compare measures
      for (const [name, currentStats] of Object.entries(currentResult.measures)) {
        const baselineStats = baselineResult.measures[name]
        if (baselineStats) {
          const diff = currentStats.median - baselineStats.median
          const pct = ((diff / baselineStats.median) * 100).toFixed(1)
          const indicator = diff < -5 ? 'FASTER' : diff > 5 ? 'SLOWER' : '~same'
          console.log(
            `    ${name}: ${currentStats.median.toFixed(0)}ms vs ${baselineStats.median.toFixed(0)}ms (${diff > 0 ? '+' : ''}${pct}%) ${indicator}`,
          )
        }
      }

      // Compare vitals
      for (const vital of ['lcp', 'fcp', 'cls'] as const) {
        const curr = currentResult[vital]
        const base = baselineResult[vital]
        if (curr && base) {
          const diff = curr.median - base.median
          const pct = ((diff / base.median) * 100).toFixed(1)
          const indicator = diff < -5 ? 'FASTER' : diff > 5 ? 'SLOWER' : '~same'
          console.log(
            `    ${vital.toUpperCase()}: ${curr.median.toFixed(0)} vs ${base.median.toFixed(0)} (${diff > 0 ? '+' : ''}${pct}%) ${indicator}`,
          )
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

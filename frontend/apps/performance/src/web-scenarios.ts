/**
 * Playwright-based web interaction scenarios for measuring comment performance.
 *
 * These scenarios run against a live web app instance and collect
 * performance.measure() entries placed by web-perf-marks.ts.
 */

import {Page} from '@playwright/test'

export interface WebPerfResult {
  name: string
  measures: Record<string, number> // measure name -> duration in ms
  lcp?: number
  fcp?: number
  cls?: number
  tti?: number
}

/**
 * Collect all perf:* measures from the page.
 */
async function collectPerfMeasures(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const measures: Record<string, number> = {}
    performance
      .getEntriesByType('measure')
      .filter((e) => e.name.startsWith('perf:'))
      .forEach((m) => {
        measures[m.name] = m.duration
      })
    return measures
  })
}

/**
 * Collect Core Web Vitals via PerformanceObserver entries.
 */
async function collectWebVitals(page: Page): Promise<{lcp?: number; fcp?: number; cls?: number}> {
  return page.evaluate(() => {
    const result: {lcp?: number; fcp?: number; cls?: number} = {}

    // FCP
    const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0]
    if (fcpEntry) result.fcp = fcpEntry.startTime

    // LCP - use last paint entry
    const paintEntries = performance.getEntriesByType('largest-contentful-paint') as any[]
    if (paintEntries.length > 0) {
      result.lcp = paintEntries[paintEntries.length - 1].startTime
    }

    // CLS - sum of layout shift entries
    const layoutShifts = performance.getEntriesByType('layout-shift') as any[]
    if (layoutShifts.length > 0) {
      result.cls = layoutShifts
        .filter((e: any) => !e.hadRecentInput)
        .reduce((sum: number, e: any) => sum + e.value, 0)
    }

    return result
  })
}

/**
 * Scenario: Load a document page and measure initial render performance.
 */
export async function webPageLoadScenario(page: Page, url: string): Promise<WebPerfResult> {
  await page.goto(url, {waitUntil: 'networkidle'})
  await page.waitForLoadState('networkidle')

  const vitals = await collectWebVitals(page)
  const measures = await collectPerfMeasures(page)

  return {
    name: 'web-page-load',
    measures,
    ...vitals,
  }
}

/**
 * Scenario: Open the comments panel and measure time to panel content visible.
 */
export async function webOpenCommentsPanelScenario(page: Page, url: string): Promise<WebPerfResult> {
  await page.goto(url, {waitUntil: 'networkidle'})
  await page.waitForLoadState('networkidle')

  // Clear previous marks
  await page.evaluate(() => performance.clearMarks())
  await page.evaluate(() => performance.clearMeasures())

  // Click the Comments tab button
  const commentsButton = page.locator('button:has-text("Comments"), a:has-text("Comments")').first()
  await commentsButton.click()

  // Wait for panel content to appear
  await page.waitForSelector('[data-panel-content]', {timeout: 10000}).catch(() => {
    // Fallback: wait for any discussion content
    return page.waitForTimeout(3000)
  })

  // Give a moment for measures to be recorded
  await page.waitForTimeout(500)

  const measures = await collectPerfMeasures(page)

  return {
    name: 'web-open-comments-panel',
    measures,
  }
}

/**
 * Scenario: Submit a comment and measure round-trip time.
 * NOTE: This scenario requires a running app with auth configured.
 */
export async function webSubmitCommentScenario(page: Page, url: string): Promise<WebPerfResult> {
  await page.goto(url, {waitUntil: 'networkidle'})

  // Open comments panel first
  const commentsButton = page.locator('button:has-text("Comments"), a:has-text("Comments")').first()
  await commentsButton.click()
  await page.waitForTimeout(2000) // Wait for panel to open

  // Clear marks before measuring submit
  await page.evaluate(() => {
    performance.clearMarks()
    performance.clearMeasures()
  })

  // Type in the comment editor (ProseMirror)
  const editor = page.locator('[contenteditable="true"]').first()
  await editor.click()
  await editor.type('Performance test comment ' + Date.now())

  // Click submit button
  const submitButton = page.locator('button:has(svg.lucide-send-horizontal)').first()
  await submitButton.click()

  // Wait for the comment to appear or mutation to complete
  await page.waitForTimeout(5000)

  const measures = await collectPerfMeasures(page)

  return {
    name: 'web-submit-comment',
    measures,
  }
}

/**
 * Scenario: Navigate between two document pages and measure transition time.
 */
export async function webNavigateBetweenDocsScenario(
  page: Page,
  url1: string,
  url2: string,
): Promise<WebPerfResult> {
  // Load first page
  await page.goto(url1, {waitUntil: 'networkidle'})
  await page.waitForLoadState('networkidle')

  // Clear marks
  await page.evaluate(() => {
    performance.clearMarks()
    performance.clearMeasures()
  })

  // Navigate to second page via client-side navigation
  await page.goto(url2)
  await page.waitForLoadState('networkidle')

  // Wait for navigation measures
  await page.waitForTimeout(1000)

  const measures = await collectPerfMeasures(page)
  const vitals = await collectWebVitals(page)

  return {
    name: 'web-navigate-between-docs',
    measures,
    ...vitals,
  }
}

/**
 * Run all web scenarios and return results.
 */
export async function runAllWebScenarios(
  page: Page,
  baseUrl: string,
  docPath: string = '/',
  secondDocPath?: string,
): Promise<WebPerfResult[]> {
  const results: WebPerfResult[] = []
  const url = `${baseUrl}${docPath}`

  console.log(`Running web-page-load scenario on ${url}...`)
  results.push(await webPageLoadScenario(page, url))

  console.log(`Running web-open-comments-panel scenario...`)
  results.push(await webOpenCommentsPanelScenario(page, url))

  if (secondDocPath) {
    const url2 = `${baseUrl}${secondDocPath}`
    console.log(`Running web-navigate-between-docs scenario...`)
    results.push(await webNavigateBetweenDocsScenario(page, url, url2))
  }

  return results
}

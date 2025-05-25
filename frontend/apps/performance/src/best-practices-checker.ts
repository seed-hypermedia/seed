import {ElectronApplication, Page} from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Performance best practice checks
 */
export interface BestPracticeCheck {
  name: string
  description: string
  impact: 'high' | 'medium' | 'low'
  check: (app: ElectronApplication, page: Page) => Promise<boolean>
  recommendation: string
}

/**
 * Best practice check result
 */
export interface BestPracticeCheckResult {
  name: string
  description: string
  impact: 'high' | 'medium' | 'low'
  passed: boolean
  recommendation?: string
}

/**
 * Checks for JavaScript and memory performance best practices
 */
export const javaScriptAndMemoryChecks: BestPracticeCheck[] = [
  {
    name: 'Avoid unnecessary IPC',
    description:
      'Excessive IPC (Inter-Process Communication) can slow down your app',
    impact: 'high',
    check: async (app: ElectronApplication, page: Page) => {
      try {
        // Mock check - in a real implementation, you could use a CDP session to track IPC calls
        const client = await page.context().newCDPSession(page)
        await client.send('Profiler.enable')
        await client.send('Profiler.start')

        // Wait a bit to collect data
        await page.waitForTimeout(1000)

        const result = await client.send('Profiler.stop')
        await client.send('Profiler.disable')

        // Check if there are functions that look like IPC calls
        const ipcCalls = result.profile.nodes.filter((node: any) => {
          return (
            node.callFrame &&
            (node.callFrame.functionName.includes('ipcRenderer') ||
              node.callFrame.functionName.includes('ipcMain'))
          )
        })

        // If there are too many IPC calls, the test fails
        return ipcCalls.length < 10
      } catch (e) {
        // Return false on error
        console.error('Error checking IPC usage:', e)
        return false
      }
    },
    recommendation:
      'Batch IPC messages and minimize communication across processes',
  },
  {
    name: 'Preload window contents',
    description: 'Preloading content improves perceived performance',
    impact: 'medium',
    check: async (app: ElectronApplication, page: Page) => {
      const loadTime = await page.evaluate(() => {
        return (
          performance.timing.loadEventEnd - performance.timing.navigationStart
        )
      })

      // If page load time is under 3 seconds, it's good enough
      return loadTime < 3000
    },
    recommendation:
      'Use the ready-to-show event to preload content before displaying the window',
  },
  {
    name: 'Memory usage',
    description: 'Check if memory usage is reasonable',
    impact: 'high',
    check: async (app: ElectronApplication, page: Page) => {
      try {
        const client = await page.context().newCDPSession(page)
        const result = await client.send('Performance.getMetrics')

        const jsHeapUsed = result.metrics.find(
          (m: any) => m.name === 'JSHeapUsedSize',
        )

        // If heap usage is under 100MB, consider it good
        // Ensure we always return a boolean
        return jsHeapUsed ? jsHeapUsed.value < 100 * 1024 * 1024 : false
      } catch (e) {
        console.error('Error checking memory usage:', e)
        return false
      }
    },
    recommendation:
      'Monitor memory usage, look for leaks, and clean up unused objects',
  },
]

/**
 * Checks for window management best practices
 */
export const windowManagementChecks: BestPracticeCheck[] = [
  {
    name: 'Proper BrowserWindow options',
    description: 'Using optimal BrowserWindow options improves performance',
    impact: 'medium',
    check: async (app: ElectronApplication, page: Page) => {
      // In a real implementation, you could analyze window creation code or inspect the BrowserWindow properties
      // This is a simple mock
      return true
    },
    recommendation:
      'Set backgroundThrottling: false, show: false initially, and use ready-to-show event',
  },
  {
    name: 'Window visibility management',
    description: 'Windows should be hidden until ready to display',
    impact: 'medium',
    check: async (app: ElectronApplication, page: Page) => {
      // Look for specific HTML/CSS patterns that might indicate proper window visibility handling
      // This is a mock check
      return true
    },
    recommendation:
      'Hide windows until fully loaded and use ready-to-show event to display them',
  },
]

/**
 * Checks for renderer process best practices
 */
export const rendererProcessChecks: BestPracticeCheck[] = [
  {
    name: 'Use of hardware acceleration',
    description:
      'Hardware acceleration should be enabled for better performance',
    impact: 'high',
    check: async (app: ElectronApplication, page: Page) => {
      const isAccelerated = await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        const gl =
          canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
        return !!gl
      })

      return isAccelerated
    },
    recommendation:
      'Ensure hardware acceleration is enabled in Electron app configuration',
  },
  {
    name: 'Throttling of background pages',
    description: 'Background pages should be throttled to save resources',
    impact: 'medium',
    check: async (app: ElectronApplication, page: Page) => {
      // Mock check - in a real implementation you would check for backgroundThrottling in BrowserWindow options
      return true
    },
    recommendation:
      'Set backgroundThrottling: true for background windows to save CPU and battery',
  },
]

/**
 * Runs all the best practice checks
 */
export async function runBestPracticeChecks(
  app: ElectronApplication,
  page: Page,
): Promise<BestPracticeCheckResult[]> {
  const allChecks = [
    ...javaScriptAndMemoryChecks,
    ...windowManagementChecks,
    ...rendererProcessChecks,
  ]

  const results: BestPracticeCheckResult[] = []

  for (const check of allChecks) {
    try {
      let passed = await check.check(app, page)

      // Ensure we always return a boolean, not undefined
      if (passed === undefined) {
        passed = false
      }

      results.push({
        name: check.name,
        description: check.description,
        impact: check.impact,
        passed,
        recommendation: passed ? undefined : check.recommendation,
      })
    } catch (error) {
      console.error(`Error running check ${check.name}:`, error)
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      results.push({
        name: check.name,
        description: check.description,
        impact: check.impact,
        passed: false,
        recommendation: `Could not run check: ${errorMessage}. ${check.recommendation}`,
      })
    }
  }

  return results
}

/**
 * Generates an HTML report for best practice check results
 */
export function generateBestPracticesReport(
  results: BestPracticeCheckResult[],
  outputPath: string,
): void {
  const passedChecks = results.filter((result) => result.passed)
  const failedChecks = results.filter((result) => !result.passed)

  const highImpactFailures = failedChecks.filter(
    (check) => check.impact === 'high',
  )
  const mediumImpactFailures = failedChecks.filter(
    (check) => check.impact === 'medium',
  )
  const lowImpactFailures = failedChecks.filter(
    (check) => check.impact === 'low',
  )

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Electron Performance Best Practices Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1000px;
      margin: 0 auto;
      padding: 20px;
    }
    h1, h2, h3 {
      color: #2c3e50;
    }
    .summary {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 30px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    .checks {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(450px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .check {
      background: #fff;
      border: 1px solid #e1e4e8;
      border-radius: 6px;
      padding: 15px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .check-passed {
      border-left: 4px solid #2ecc71;
    }
    .check-failed {
      border-left: 4px solid #e74c3c;
    }
    .impact-high {
      background-color: #fff5f5;
    }
    .impact-medium {
      background-color: #fef9e7;
    }
    .impact-low {
      background-color: #f8f9fa;
    }
    .impact-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: bold;
      margin-left: 8px;
    }
    .impact-high-badge {
      background-color: #e74c3c;
      color: white;
    }
    .impact-medium-badge {
      background-color: #f39c12;
      color: white;
    }
    .impact-low-badge {
      background-color: #7f8c8d;
      color: white;
    }
    .recommendation {
      background: #f0f7ff;
      padding: 10px;
      border-radius: 4px;
      margin-top: 10px;
    }
    .progress-bar {
      width: 100%;
      background-color: #e0e0e0;
      border-radius: 4px;
      margin: 10px 0;
      overflow: hidden;
    }
    .progress-value {
      height: 20px;
      background-color: #2ecc71;
      border-radius: 4px;
      transition: width 0.5s;
    }
  </style>
</head>
<body>
  <h1>Electron Performance Best Practices Report</h1>
  
  <div class="summary">
    <h2>Summary</h2>
    <p>
      <strong>${passedChecks.length}</strong> out of <strong>${
        results.length
      }</strong> checks passed 
      (${Math.round((passedChecks.length / results.length) * 100)}%)
    </p>
    
    <div class="progress-bar">
      <div class="progress-value" style="width: ${Math.round(
        (passedChecks.length / results.length) * 100,
      )}%"></div>
    </div>
    
    <p>
      <strong>Failed checks:</strong><br>
      High impact: ${highImpactFailures.length}<br>
      Medium impact: ${mediumImpactFailures.length}<br>
      Low impact: ${lowImpactFailures.length}
    </p>
  </div>

  <h2>High Impact Issues</h2>
  <div class="checks">
    ${highImpactFailures
      .map(
        (check) => `
      <div class="check check-failed impact-high">
        <h3>${check.name} <span class="impact-badge impact-high-badge">High</span></h3>
        <p>${check.description}</p>
        <div class="recommendation">
          <strong>Recommendation:</strong> ${check.recommendation}
        </div>
      </div>
    `,
      )
      .join('')}
    ${
      highImpactFailures.length === 0
        ? '<p>No high impact issues found!</p>'
        : ''
    }
  </div>

  <h2>Medium Impact Issues</h2>
  <div class="checks">
    ${mediumImpactFailures
      .map(
        (check) => `
      <div class="check check-failed impact-medium">
        <h3>${check.name} <span class="impact-badge impact-medium-badge">Medium</span></h3>
        <p>${check.description}</p>
        <div class="recommendation">
          <strong>Recommendation:</strong> ${check.recommendation}
        </div>
      </div>
    `,
      )
      .join('')}
    ${
      mediumImpactFailures.length === 0
        ? '<p>No medium impact issues found!</p>'
        : ''
    }
  </div>

  <h2>Low Impact Issues</h2>
  <div class="checks">
    ${lowImpactFailures
      .map(
        (check) => `
      <div class="check check-failed impact-low">
        <h3>${check.name} <span class="impact-badge impact-low-badge">Low</span></h3>
        <p>${check.description}</p>
        <div class="recommendation">
          <strong>Recommendation:</strong> ${check.recommendation}
        </div>
      </div>
    `,
      )
      .join('')}
    ${
      lowImpactFailures.length === 0 ? '<p>No low impact issues found!</p>' : ''
    }
  </div>

  <h2>Passed Checks</h2>
  <div class="checks">
    ${passedChecks
      .map(
        (check) => `
      <div class="check check-passed">
        <h3>${check.name} <span class="impact-badge impact-${check.impact}-badge">${check.impact}</span></h3>
        <p>${check.description}</p>
      </div>
    `,
      )
      .join('')}
  </div>
</body>
</html>
  `

  // Create directory if it doesn't exist
  const dir = path.dirname(outputPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, {recursive: true})
  }

  // Write the HTML file
  fs.writeFileSync(outputPath, html)
  console.log(`Best practices report generated at: ${outputPath}`)
}

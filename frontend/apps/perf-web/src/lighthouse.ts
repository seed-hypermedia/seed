import * as chromeLauncher from 'chrome-launcher'
import type {Config} from 'lighthouse'
import lighthouse from 'lighthouse'
import {LIGHTHOUSE_CONFIG} from './config.js'
import {PerformanceMetrics} from './types.js'

export async function runLighthouseTest(
  url: string,
  isMobile: boolean,
): Promise<PerformanceMetrics> {
  const chrome = await chromeLauncher.launch({chromeFlags: ['--headless']})

  const config: Config = {
    ...LIGHTHOUSE_CONFIG,
    settings: {
      ...LIGHTHOUSE_CONFIG.settings,
      formFactor: isMobile ? ('mobile' as const) : ('desktop' as const),
      screenEmulation: isMobile
        ? {
            mobile: true,
            width: 375,
            height: 667,
            deviceScaleFactor: 2,
          }
        : {
            mobile: false,
            width: 1350,
            height: 940,
            deviceScaleFactor: 1,
          },
      throttling: isMobile
        ? {
            rttMs: 150,
            throughputKbps: 1638.4,
            cpuSlowdownMultiplier: 4,
          }
        : LIGHTHOUSE_CONFIG.settings.throttling,
    },
  }

  try {
    const runnerResult = await lighthouse(
      url,
      {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
      },
      config,
    )

    if (!runnerResult) {
      throw new Error('Lighthouse audit failed to return results')
    }

    const audits = runnerResult.lhr.audits

    const metrics: PerformanceMetrics = {
      lcp: audits['largest-contentful-paint']?.numericValue || 0,
      inp: audits['interaction-to-next-paint']?.numericValue || 0,
      cls: audits['cumulative-layout-shift']?.numericValue || 0,
      ttfb: audits['server-response-time']?.numericValue || 0,
      pageLoadTime: audits['total-blocking-time']?.numericValue || 0,
      pageSize: audits['total-byte-weight']?.numericValue || 0,
      totalRequests:
        (audits['network-requests']?.details as any)?.items?.length || 0,
    }

    return metrics
  } finally {
    await chrome.kill()
  }
}

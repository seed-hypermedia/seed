// Usage: node screenshot.mjs <url> <out.png> [width] [height]
import {chromium} from 'playwright-core'

const [url, out, width = '760', height = '800'] = process.argv.slice(2)
if (!url || !out) {
  console.error('Usage: node screenshot.mjs <url> <out.png> [width] [height]')
  process.exit(1)
}
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH})
const page = await browser.newPage({viewport: {width: Number(width), height: Number(height)}, deviceScaleFactor: 2})
page.on('pageerror', (error) => console.error('pageerror:', error.message))
page.on('console', (message) => message.type() === 'error' && console.error('console:', message.text()))
await page.goto(url, {waitUntil: 'networkidle', timeout: 120_000})
await page.waitForTimeout(1000)
await page.screenshot({path: out, fullPage: true})
await browser.close()

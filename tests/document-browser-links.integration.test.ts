import {chromium} from 'playwright'
import {expect, it} from 'vitest'
import {FIXTURE_HIERARCHY_PATH, FIXTURE_HIERARCHY_TITLE} from '../test-fixtures/minimal-fixtures'
import {setupTestEnv} from './integration'

it('exposes the sidebar document URL and opens modified clicks in another tab', async () => {
  // A pre-seeded fixture server lets developers compare two builds with identical data.
  const env = process.env.SEED_TEST_WEB_URL
    ? undefined
    : await setupTestEnv({skipBuild: process.env.SKIP_BUILD === 'true'})
  const baseUrl = env?.web.baseUrl ?? process.env.SEED_TEST_WEB_URL!
  try {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({viewport: {width: 1440, height: 900}})
      await page.goto(baseUrl)
      await page.waitForFunction(() => document.documentElement.dataset.seedHydrated === 'true')
      const toggle = page.getByRole('button', {name: 'Open sidebar', exact: true})
      if (await toggle.isVisible()) await toggle.click()
      const item = page.getByRole('tree', {name: 'Space documents'}).getByText(FIXTURE_HIERARCHY_TITLE, {exact: true})
      await item.hover()
      const expected = new URL(FIXTURE_HIERARCHY_PATH, baseUrl).href
      const href = await item.evaluate((el) => el.closest<HTMLAnchorElement>('a[href]')?.href ?? null)
      expect.soft(href, 'hovered document has a native link to the fixture document').toBe(expected)
      const source = page.url()
      const [tab] = await Promise.all([
        page.context().waitForEvent('page', {timeout: 5000}),
        item.click({modifiers: ['ControlOrMeta']}),
      ])
      await tab.waitForURL(expected)
      expect(page.url()).toBe(source)
    } finally {
      await browser.close()
    }
  } finally {
    await env?.cleanup()
  }
})

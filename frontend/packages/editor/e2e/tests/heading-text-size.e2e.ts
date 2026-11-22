import {expect, test, type Page} from '@playwright/test'

async function textSizePx(page: Page, blockId: string) {
  const heading = page.locator(`[data-id="${blockId}"] > [data-content-type="heading"]`)
  return {
    level: await heading.getAttribute('data-level'),
    fontSize: await heading.locator('[data-text-size]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  }
}

test.describe('Heading text size', () => {
  for (const size of ['small', 'medium', 'big']) {
    test(`explicit ${size} size renders the same at every heading depth`, async ({page}) => {
      await page.goto('/?real=1&fixture=headingSizes')
      await page.waitForFunction(() => window.TEST_EDITOR)
      await expect(page.getByText(`Deep ${size}`, {exact: true})).toBeVisible()

      const top = await textSizePx(page, `h-top-${size}`)
      const nested = await textSizePx(page, `h-nested-${size}`)
      const deep = await textSizePx(page, `h-deep-${size}`)

      expect([top.level, nested.level, deep.level]).toEqual(['2', '3', '4'])
      expect(nested.fontSize).toBeCloseTo(top.fontSize, 1)
      expect(deep.fontSize).toBeCloseTo(top.fontSize, 1)
    })
  }
})

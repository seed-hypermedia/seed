import {expect, test} from '@playwright/test'

for (const initialView of ['Table', 'List']) {
  test(`changing a trailing query from Card to ${initialView} starts editing without crashing`, async ({page}) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto('/?real=1&fixture=queryAtEnd')
    await page.waitForFunction(() => window.TEST_EDITOR && window.TEST_MACHINE)
    expect(await page.evaluate(() => window.TEST_EDITOR.isEditable())).toBe(false)

    const query = page.locator('[data-id="query-at-end"]').first()
    await query.locator('button:has(svg.lucide-pencil)').click()
    await page.getByRole('combobox').filter({hasText: 'Card'}).click()
    await page.getByRole('option', {name: initialView, exact: true}).click()

    await expect(query.locator('[data-content-type="query"]')).toHaveAttribute('data-style', initialView)
    expect(await page.evaluate(() => window.TEST_EDITOR.isEditable())).toBe(true)
    await expect(page.getByRole('heading', {name: 'Issues', exact: true})).toBeVisible()
    await expect(query.getByText('QueryDocOne', {exact: true})).toBeVisible()
    await expect(query.getByText('QueryDocTwo', {exact: true})).toBeVisible()

    // Continue changing views in the same session, including returning to Card.
    let currentView = initialView
    for (const nextView of [initialView === 'Table' ? 'List' : 'Table', 'Card']) {
      const viewSelect = page.getByRole('combobox').filter({hasText: currentView})
      if (!(await viewSelect.isVisible())) {
        await query.locator('button:has(svg.lucide-pencil)').click()
      }
      await viewSelect.click()
      await page.getByRole('option', {name: nextView, exact: true}).click()
      expect(await page.evaluate(() => window.TEST_EDITOR.editor?.getBlock('query-at-end')?.props.style)).toBe(nextView)
      currentView = nextView
    }

    expect(errors).toEqual([])
    const ids = await page.evaluate(() => window.TEST_EDITOR.getBlocks().map((block) => block.id))
    expect(ids.slice(0, 2)).toEqual(['query-heading', 'query-at-end'])
    expect(new Set(ids).size).toBe(ids.length)
  })
}

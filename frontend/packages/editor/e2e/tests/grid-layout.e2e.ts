import {expect, test} from './fixtures'

test.use({clipboardPermissions: false})

test.describe.skip('Grid Layout', () => {
  test.describe('Slash Menu Insertion', () => {
    test('Should insert a grid with 3 empty children via slash menu', async ({editorHelpers, page}) => {
      await editorHelpers.typeText('Before grid')
      await editorHelpers.pressKey('Enter')

      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Grid')
      await page.waitForTimeout(200)

      // Verify the ProseMirror doc has a blockChildren node with listType=Grid
      const docJSON = await editorHelpers.getDocJSON()
      const doc = docJSON.content

      // Find the blockChildren node with Grid type
      let foundGrid = false
      function findGrid(nodes: any[]) {
        for (const node of nodes) {
          if (node.type === 'blockChildren' && node.attrs?.listType === 'Grid') {
            foundGrid = true
            // Should have 3 children
            expect(node.content.length).toBeGreaterThanOrEqual(3)
            expect(node.attrs.columnCount).toBe('3')
          }
          if (node.content) findGrid(node.content)
        }
      }
      findGrid(doc)
      expect(foundGrid).toBe(true)
    })

    test('Grid should render with CSS grid display', async ({editorHelpers, page}) => {
      await editorHelpers.typeText('Content')
      await editorHelpers.pressKey('Enter')

      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Grid')
      await page.waitForTimeout(200)

      // Check that the grid container has CSS grid display
      const gridContainer = page.locator('[data-list-type="Grid"]').first()
      await expect(gridContainer).toBeVisible()

      const display = await gridContainer.evaluate((el) => window.getComputedStyle(el).display)
      expect(display).toBe('grid')
    })
  })

  test.describe('Formatting Toolbar', () => {
    test('Should show Grid option in group type dropdown', async ({editorHelpers, page}) => {
      // Type some text and select it to show the formatting toolbar
      await editorHelpers.typeText('Some text')
      await editorHelpers.selectText('Some text')
      await page.waitForTimeout(100)

      const toolbar = await editorHelpers.waitForFormattingToolbar()

      // Open the group type dropdown
      const groupDropdown = toolbar.locator('[data-testid="group-type-dropdown"]')
      await groupDropdown.click()
      await page.waitForTimeout(100)

      // Grid option should be visible
      const gridOption = page.locator('text="Grid"')
      await expect(gridOption).toBeVisible()
    })

    test('Should convert block to Grid via formatting toolbar', async ({editorHelpers, page}) => {
      await editorHelpers.typeText('Cell 1')
      await editorHelpers.pressKey('Enter')
      await editorHelpers.typeText('Cell 2')
      await editorHelpers.pressKey('Enter')
      await editorHelpers.typeText('Cell 3')

      // Select first cell text to show toolbar
      await editorHelpers.selectText('Cell 1')
      await page.waitForTimeout(100)

      const toolbar = await editorHelpers.waitForFormattingToolbar()

      // Open group type dropdown and select Grid
      const groupDropdown = toolbar.locator('[data-testid="group-type-dropdown"]')
      await groupDropdown.click()
      await page.waitForTimeout(100)

      const gridOption = page.locator('text="Grid"')
      await gridOption.click()
      await page.waitForTimeout(200)

      // Verify grid was created
      const gridContainer = page.locator('[data-list-type="Grid"]').first()
      await expect(gridContainer).toBeVisible()
    })

    test('Should show column count dropdown when inside Grid', async ({editorHelpers, page}) => {
      await editorHelpers.typeText('Grid content')
      await editorHelpers.pressKey('Enter')

      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Grid')
      await page.waitForTimeout(200)

      // Click inside the grid to place cursor
      const gridContainer = page.locator('[data-list-type="Grid"]').first()
      const firstCell = gridContainer.locator('[data-node-type="blockNode"]').first()
      await firstCell.click()
      await page.waitForTimeout(100)

      // Select text in the grid cell
      await editorHelpers.typeText('Cell text')
      await editorHelpers.selectText('Cell text')
      await page.waitForTimeout(100)

      const toolbar = await editorHelpers.waitForFormattingToolbar()

      // Column count dropdown should be visible
      const colDropdown = toolbar.locator('[data-testid="column-count-dropdown"]')
      await expect(colDropdown).toBeVisible()
    })

    test('Should change column count via dropdown', async ({editorHelpers, page}) => {
      await editorHelpers.typeText('Content')
      await editorHelpers.pressKey('Enter')

      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Grid')
      await page.waitForTimeout(200)

      // Click first grid cell and add text
      const gridContainer = page.locator('[data-list-type="Grid"]').first()
      const firstCell = gridContainer.locator('[data-node-type="blockNode"]').first()
      await firstCell.click()
      await editorHelpers.typeText('Cell')
      await editorHelpers.selectText('Cell')
      await page.waitForTimeout(100)

      const toolbar = await editorHelpers.waitForFormattingToolbar()

      // Change column count to 2
      const colDropdown = toolbar.locator('[data-testid="column-count-dropdown"]')
      await colDropdown.click()
      await page.waitForTimeout(100)

      const twoColOption = page.locator('text="2 Columns"')
      await twoColOption.click()
      await page.waitForTimeout(200)

      // Verify columnCount attribute changed
      const docJSON = await editorHelpers.getDocJSON()
      let foundColumnCount: string | null = null
      function findColumnCount(nodes: any[]) {
        for (const node of nodes) {
          if (node.type === 'blockChildren' && node.attrs?.listType === 'Grid') {
            foundColumnCount = node.attrs.columnCount
          }
          if (node.content) findColumnCount(node.content)
        }
      }
      findColumnCount(docJSON.content)
      expect(foundColumnCount).toBe(2)
    })

    test('Should not show column count dropdown outside Grid', async ({editorHelpers, page}) => {
      await editorHelpers.typeText('Normal text')
      await editorHelpers.selectText('Normal text')
      await page.waitForTimeout(100)

      const toolbar = await editorHelpers.waitForFormattingToolbar()

      // Column count dropdown should NOT be visible
      const colDropdown = toolbar.locator('[data-testid="column-count-dropdown"]')
      await expect(colDropdown).not.toBeVisible()
    })

    test('Should change whole group type from non-first Grid item', async ({editorHelpers, page}) => {
      await editorHelpers.typeText('Content')
      await editorHelpers.pressKey('Enter')

      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Grid')
      await page.waitForTimeout(200)

      // Click inside the second cell
      const gridContainer = page.locator('[data-list-type="Grid"]').first()
      const secondCell = gridContainer.locator('[data-node-type="blockNode"]').nth(1)
      await secondCell.click()
      await editorHelpers.typeText('Cell 2')
      await editorHelpers.selectText('Cell 2')
      await page.waitForTimeout(100)

      const toolbar = await editorHelpers.waitForFormattingToolbar()

      // Change to Bullets from second cell
      const groupDropdown = toolbar.locator('[data-testid="group-type-dropdown"]')
      await groupDropdown.click()
      await page.waitForTimeout(100)

      const bulletsOption = page.locator('text="Bullets"')
      await bulletsOption.click()
      await page.waitForTimeout(200)

      // The group should now have listType Unordered
      const gridAfter = page.locator('[data-list-type="Grid"]')
      await expect(gridAfter).toHaveCount(0)

      const ulContainer = page.locator('[data-list-type="Unordered"]')
      await expect(ulContainer.first()).toBeVisible()
    })
  })

  test.describe('Keyboard Shortcuts', () => {
    test('Tab should not indent blocks inside Grid', async ({editorHelpers, page}) => {
      await editorHelpers.typeText('Content')
      await editorHelpers.pressKey('Enter')

      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Grid')
      await page.waitForTimeout(200)

      // Click the second cell and try Tab
      const gridContainer = page.locator('[data-list-type="Grid"]').first()
      const secondCell = gridContainer.locator('[data-node-type="blockNode"]').nth(1)
      await secondCell.click()
      await editorHelpers.typeText('Cell 2')
      await page.waitForTimeout(50)

      // Get the doc state before Tab
      const beforeDoc = await editorHelpers.getDocJSON()

      await editorHelpers.pressKey('Tab')
      await page.waitForTimeout(100)

      // Get doc state after Tab — should be the same (Tab blocked)
      const afterDoc = await editorHelpers.getDocJSON()

      // The grid should still have the same number of children
      function countGridChildren(nodes: any[], counter: {count: number}) {
        for (const node of nodes) {
          if (node.type === 'blockChildren' && node.attrs?.listType === 'Grid') {
            counter.count = node.content?.length ?? 0
          }
          if (node.content) countGridChildren(node.content, counter)
        }
      }
      const before = {count: 0}
      const after = {count: 0}
      countGridChildren(beforeDoc.content, before)
      countGridChildren(afterDoc.content, after)
      expect(after.count).toBe(before.count)
    })
  })
})

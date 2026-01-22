import {expect, test} from './fixtures'

// Opt out of clipboard permissions for block manipulation tests
test.use({clipboardPermissions: false})

test.describe('Block Manipulation', () => {
  test.describe('Block Insertion', () => {
    test('Should start with content after fixture initialization', async ({
      editorHelpers,
    }) => {
      // The editor should have one empty paragraph node after initialization
      const blocks = await editorHelpers.getAllBlocks()
      expect(blocks.length).toBeGreaterThanOrEqual(1)
      expect(blocks[0].type).toBe('paragraph')
    })

    test('Should create new paragraph block on Enter', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('First paragraph')
      await editorHelpers.pressKey('Enter')
      await editorHelpers.typeText('Second paragraph')
      await page.waitForTimeout(50)

      const blocks = await editorHelpers.getBlocks()
      // Should have at least 2 blocks with content
      expect(blocks.length).toBeGreaterThanOrEqual(2)
      expect(blocks[0].type).toBe('paragraph')
      expect(blocks[1].type).toBe('paragraph')
      expect(blocks[0].content[0].text).toContain('First paragraph')
      expect(blocks[1].content[0].text).toContain('Second paragraph')
    })

    test('Should insert heading with slash menu', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Heading')
      // await page.waitForTimeout(200)

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].type).toBe('heading')
    })

    test('Should insert code block with slash menu', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Code Block')
      // await page.waitForTimeout(200)

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].type).toBe('code-block')
    })

    test('Should insert mermaid block with slash menu', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Mermaid')
      // await page.waitForTimeout(200)

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].type).toBe('mermaid')
    })

    test('Should find mermaid when filtering slash menu with diagram alias', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('/diagram')
      // await page.waitForTimeout(300)

      // Mermaid should be visible in the Mantine Menu
      const mermaidItem = page.locator(
        '.mantine-Menu-dropdown >> text="Mermaid"',
      )
      await expect(mermaidItem).toBeVisible()
    })

    test('Should filter slash menu items when typing after slash', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('/head')
      // await page.waitForTimeout(300)

      // Heading should be visible in the Mantine Menu
      const headingItem = page.locator(
        '.mantine-Menu-dropdown >> text="Heading"',
      )
      await expect(headingItem).toBeVisible()

      // Paragraph should not be visible (filtered out)
      const paragraphItem = page.locator(
        '.mantine-Menu-dropdown >> text="Paragraph"',
      )
      await expect(paragraphItem).not.toBeVisible()
    })
  })

  test.describe('Block Deletion', () => {
    test('Should delete empty block with Backspace', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('First line')

      const initialBlocks = await editorHelpers.getBlocks()
      const initialCount = initialBlocks.length

      await editorHelpers.pressKey('Enter')
      // await page.waitForTimeout(50)

      // Now we have one more block
      let blocks = await editorHelpers.getBlocks()
      expect(blocks.length).toBe(initialCount + 1)

      // Backspace should delete the empty block
      await editorHelpers.pressKey('Backspace')
      // await page.waitForTimeout(50)

      blocks = await editorHelpers.getBlocks()
      expect(blocks.length).toBe(initialCount)
    })

    test('Should merge blocks when backspacing at start', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('First')
      await editorHelpers.pressKey('Enter')
      await editorHelpers.typeText('Second')
      // await page.waitForTimeout(50)

      // Get initial count
      const initialBlocks = await editorHelpers.getBlocks()
      expect(initialBlocks.length).toBeGreaterThanOrEqual(2)

      // Move cursor to start of second paragraph
      await editorHelpers.pressKey('ControlOrMeta+ArrowLeft')
      await page.waitForTimeout(100)

      // Backspace should merge with previous block
      await editorHelpers.pressKey('Backspace')
      await page.waitForTimeout(100)

      // Text should be merged
      const text = await editorHelpers.getEditorText()
      expect(text).toContain('FirstSecond')
    })

    test('Should delete selected text with Delete key', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('Hello World')

      // Select all and delete
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)
      await editorHelpers.pressKey('Delete')
      await page.waitForTimeout(100)

      const text = await editorHelpers.getEditorText()
      // After deleting all content, we should have an empty block
      expect(text.trim()).toBe('')
    })
  })

  test.describe('Block Modification', () => {
    test('Should add a heading after paragraph with slash menu', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('My Paragraph')
      // await page.waitForTimeout(50)

      // Add a space and open slash menu
      await editorHelpers.typeText(' ')
      await page.waitForTimeout(50)

      // Open slash menu and convert to heading
      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Heading')
      await page.waitForTimeout(50)

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[1].type).toBe('heading')
    })

    test('Should preserve text when changing block type', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('My content')
      // await page.waitForTimeout(50)

      // Move to start with Cmd+Left
      // await editorHelpers.pressKey('Meta+ArrowLeft')
      await editorHelpers.typeText(' ')
      // await page.waitForTimeout(50)

      // Convert to heading
      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Heading')
      await page.waitForTimeout(50)

      const text = await editorHelpers.getEditorText()
      expect(text).toContain('My content')
    })
  })
})

import {expect, test} from './fixtures'

test.describe('Selection Behavior', () => {
  test.describe('Text Selection', () => {
    // test('Should select text with keyboard shortcuts', async ({
    //   editorHelpers,
    //   page,
    // }) => {
    //   await editorHelpers.focusEditor()
    //   await editorHelpers.typeText('Hello World')

    //   // Select all with Cmd+A
    //   await editorHelpers.selectAll()
    //   // await page.waitForTimeout(50)

    //   const selectedText = await editorHelpers.getSelectedText()
    //   expect(selectedText).toBe('Hello World')
    // })

    test('Should select text with Shift+Arrow keys', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Hello')

      // Move to start
      await editorHelpers.pressKey('Home')

      // Select first 3 characters
      await editorHelpers.pressKey('Shift+ArrowRight')
      await editorHelpers.pressKey('Shift+ArrowRight')
      await editorHelpers.pressKey('Shift+ArrowRight')
      await page.waitForTimeout(50)

      const selectedText = await editorHelpers.getSelectedText()
      expect(selectedText).toBe('Hel')
    })

    test('Should select word with double-click', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Hello World')

      // Double-click on the first word
      const contentArea = editorHelpers.getContentArea()
      await contentArea.dblclick({position: {x: 30, y: 20}})
      await page.waitForTimeout(50)

      const selectedText = await editorHelpers.getSelectedText()
      // Should select a word
      expect(selectedText.length).toBeGreaterThan(0)
    })

    test('Should select line with triple-click', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Hello World')

      // Triple-click to select line
      const contentArea = editorHelpers.getContentArea()
      await contentArea.click({clickCount: 3, position: {x: 50, y: 20}})
      await page.waitForTimeout(100)

      const selectedText = await editorHelpers.getSelectedText()
      expect(selectedText).toContain('Hello World')
    })
  })

  test.describe('Selection Across Blocks', () => {
    test('Should select text across multiple blocks with Cmd+A', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('First block')
      await editorHelpers.pressKey('Enter')
      await page.waitForTimeout(100)
      await editorHelpers.typeText('Second block')

      await editorHelpers.selectAll()
      await page.waitForTimeout(100)

      const selectedText = await editorHelpers.getSelectedText()
      expect(selectedText).toContain('First block')
      expect(selectedText).toContain('Second block')
    })

    test('Should navigate between blocks with arrow keys', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('First')
      await editorHelpers.pressKey('Enter')
      await editorHelpers.typeText('Second')

      // Move the cursor to the first block with arrow up
      await editorHelpers.pressKey('ArrowUp')

      // Type at cursor position in first block
      await editorHelpers.typeText('!')

      const text = await editorHelpers.getEditorText()
      // The "!" should be either at the start or the end of the first block
      expect(text).toMatch(/First.*!|!.*First/)
    })
  })

  test.describe('Cursor Position', () => {
    test('Should maintain cursor position after typing', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('ABC')

      // Cursor is at end: ABC|
      // Move cursor left once to get: AB|C
      await editorHelpers.pressKey('ArrowLeft')

      // Type at cursor position: ABX|C
      await editorHelpers.typeText('X')

      const text = await editorHelpers.getEditorText()
      expect(text).toContain('ABXC')
    })

    test('Should place cursor at end when clicking empty area', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Hello')

      // Click at the end of the editor content area
      const contentArea = editorHelpers.getContentArea()
      await contentArea.click()
      await page.waitForTimeout(50)

      // Type should append
      await editorHelpers.typeText('!')

      const blocks = await editorHelpers.getBlocks()
      expect(blocks.length).toEqual(2)
      expect(blocks[0].content[0].text).toEqual('Hello')
      expect(blocks[1].content[0].text).toEqual('!')
    })
  })
})

test.describe('Formatting Toolbar', () => {
  test.describe('Text Formatting via Keyboard', () => {
    test('Should apply bold formatting with keyboard shortcut', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Bold text')
      await page.waitForTimeout(100)

      // Select all
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)

      // Apply bold with keyboard shortcut
      await editorHelpers.pressKey('Meta+B')
      await page.waitForTimeout(100)

      // Verify bold mark is applied
      const hasBold = await editorHelpers.hasMarkType('bold')
      expect(hasBold).toBe(true)
    })

    test('Should apply italic formatting with keyboard shortcut', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Italic text')
      await page.waitForTimeout(100)

      // Select all
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)

      // Apply italic with keyboard shortcut
      await editorHelpers.pressKey('Meta+I')
      await page.waitForTimeout(100)

      // Verify italic mark is applied
      const hasItalic = await editorHelpers.hasMarkType('italic')
      expect(hasItalic).toBe(true)
    })

    test('Should toggle formatting on and off', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Toggle test')
      await page.waitForTimeout(100)

      // Select all
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)

      // Apply bold
      await editorHelpers.pressKey('Meta+B')
      await page.waitForTimeout(100)

      // Verify bold is applied
      const hasBoldAfterApply = await editorHelpers.hasMarkType('bold')
      expect(hasBoldAfterApply).toBe(true)

      // Re-select all (selection may have been lost)
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)

      // Remove bold (toggle off)
      await editorHelpers.pressKey('Meta+B')
      await page.waitForTimeout(100)

      // The text should no longer be bold
      const hasBoldAfterRemove = await editorHelpers.hasMarkType('bold')
      expect(hasBoldAfterRemove).toBe(false)
    })
  })
})

test.describe('Slash Menu', () => {
  test('Should open slash menu when typing /', async ({
    editorHelpers,
    page,
  }) => {
    await editorHelpers.focusEditor()
    await editorHelpers.typeText('/')

    // Wait for slash menu - Mantine Menu component
    const slashMenu = page.locator('.mantine-Menu-dropdown')
    await expect(slashMenu).toBeVisible({timeout: 5000})
  })

  test('Should close slash menu on Escape', async ({editorHelpers, page}) => {
    await editorHelpers.focusEditor()
    await editorHelpers.openSlashMenu()

    // Press Escape
    await editorHelpers.pressKey('Escape')
    await page.waitForTimeout(200)

    // Menu should be hidden
    const slashMenu = page.locator('.mantine-Menu-dropdown')
    await expect(slashMenu).not.toBeVisible({timeout: 2000})
  })

  test('Should navigate slash menu with arrow keys', async ({
    editorHelpers,
    page,
  }) => {
    await editorHelpers.focusEditor()
    await editorHelpers.openSlashMenu()

    // Navigate down
    await editorHelpers.pressKey('ArrowDown')
    await page.waitForTimeout(50)

    // Menu should still be visible
    const slashMenu = page.locator('.mantine-Menu-dropdown')
    await expect(slashMenu).toBeVisible()
  })

  test('Should select item with Enter', async ({editorHelpers, page}) => {
    await editorHelpers.focusEditor()
    await editorHelpers.openSlashMenu()

    // Press Enter to select first item (Heading)
    await editorHelpers.pressKey('Enter')
    await page.waitForTimeout(200)

    // Menu should close
    const slashMenu = page.locator('.mantine-Menu-dropdown')
    await expect(slashMenu).not.toBeVisible({timeout: 2000})

    // Block type should change to heading
    const blocks = await editorHelpers.getBlocks()
    expect(blocks[0].type).toBe('heading')
  })
})

import {expect, test} from './fixtures'

// Opt out of clipboard permissions
test.use({clipboardPermissions: false})

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
      await editorHelpers.typeText('First block')
      await editorHelpers.pressKey('Enter')
      await page.waitForTimeout(100)
      await editorHelpers.typeText('Second block')

      await editorHelpers.selectAll()
      await page.waitForTimeout(200)

      const selectedText = await editorHelpers.getSelectedText()
      expect(selectedText).toContain('First block')
      expect(selectedText).toContain('Second block')
    })

    test('Should navigate between blocks with arrow keys', async ({
      editorHelpers,
      page,
    }) => {
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
  test.describe('Text formatting via the formatting toolbar', () => {
    test('Formatting toolbar should show when text is select and hide when selection is collapsed', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('Hello World')

      // Select all
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)

      // Check that the formatting toolbar is visible
      const formattingToolbar = page.getByTestId('formatting-toolbar')
      await expect(formattingToolbar).toBeVisible()

      // Collapse selection by clicking in the editor
      await editorHelpers.getContentArea().click({position: {x: 5, y: 5}})
      await page.waitForTimeout(100)

      // Check that the formatting toolbar is hidden
      await expect(formattingToolbar).not.toBeVisible()
    })

    test('Should toggle bold formatting on and off with toolbar button', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('Bold text')

      // Apply bold formatting with toolbar button
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)
      await expect(page.getByTestId('bold-button')).toBeVisible()
      await page.getByTestId('bold-button').click()
      await editorHelpers.getContentArea().click({position: {x: 5, y: 5}})
      await page.waitForTimeout(100)

      // Verify bold mark is applied
      const hasBoldAfterApply = await editorHelpers.hasMarkType('bold')
      expect(hasBoldAfterApply).toBe(true)

      // Remove bold formatting with toolbar button
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)

      await expect(page.getByTestId('bold-button')).toBeVisible()
      await page.getByTestId('bold-button').click()
      await page.waitForTimeout(100)

      // Verify bold mark is removed
      const hasBoldAfterRemove = await editorHelpers.hasMarkType('bold')
      expect(hasBoldAfterRemove).toBe(false)
    })
  })

  test.describe('Text Formatting via Keyboard', () => {
    test('Should toggle bold formatting on and off with keyboard shortcut', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('Bold text')
      await page.waitForTimeout(100)

      // Select all
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)

      // Apply bold formatting with keyboard shortcut
      await editorHelpers.pressKey('ControlOrMeta+B')
      await page.waitForTimeout(100)

      // Verify bold is applied
      const hasBoldAfterApply = await editorHelpers.hasMarkType('bold')
      expect(hasBoldAfterApply).toBe(true)

      // Remove box formatting with keyboard shortcut
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)
      await editorHelpers.pressKey('ControlOrMeta+B')
      await page.waitForTimeout(100)

      // Verify bold is removed
      const hasBoldAfterRemove = await editorHelpers.hasMarkType('bold')
      expect(hasBoldAfterRemove).toBe(false)
    })

    test('Should toggle italic formatting on and off with keyboard shortcut', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('Italic text')
      await page.waitForTimeout(100)

      // Select all
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)

      // Apply italic with keyboard shortcut
      await editorHelpers.pressKey('ControlOrMeta+I')
      await page.waitForTimeout(100)

      // Verify italic mark is applied
      const hasItalicAfterApply = await editorHelpers.hasMarkType('italic')
      expect(hasItalicAfterApply).toBe(true)

      // Remove italic formatting with keyboard shortcut
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)
      await editorHelpers.pressKey('ControlOrMeta+I')
      await page.waitForTimeout(100)

      // Verify italic is removed
      const hasItalicAfterRemove = await editorHelpers.hasMarkType('italic')
      expect(hasItalicAfterRemove).toBe(false)
    })
  })

  test.describe('Formatting toolbar dropdown tests', () => {
    test('Should switch block type with dropdown', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('Hello World')

      // Select all
      await editorHelpers.selectAll()
      await page.waitForTimeout(100)
      await expect(page.getByTestId('formatting-toolbar')).toBeVisible()

      // Switch block type with dropdown
      await page.getByTestId('block-type-dropdown').click()
      await page.waitForTimeout(100)
      // Click option by visible label
      await page.getByRole('option', {name: 'Heading'}).click()
      await page.waitForTimeout(100)

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].type).toBe('heading')
      expect(blocks[0].content[0].text).toBe('Hello World')
    })

    test('Should switch group type with dropdown', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.typeText('Parent')
      await editorHelpers.pressKey('Enter')
      await editorHelpers.typeText('Child 1')
      await editorHelpers.pressKey('Enter')
      await editorHelpers.typeText('Child 2')
      await editorHelpers.pressKey('Enter')
      await editorHelpers.typeText('Sibling')
      await page.waitForTimeout(100)

      // Select the text between Parent and Sibling
      await editorHelpers.dragSelectText('Parent', 'Sibling')
      await page.waitForTimeout(100)

      // Check that the correct text is selected
      const selectedText = await editorHelpers.getSelectedText()
      expect(selectedText).toContain('Child 1')
      expect(selectedText).toContain('Child 2')

      await expect(page.getByTestId('formatting-toolbar')).toBeVisible()

      // Set group type with dropdown
      await page.getByTestId('group-type-dropdown').click()
      await page.waitForTimeout(200)

      // Click option by visible label
      await page.getByRole('option', {name: 'Bullets'}).click()
      await page.waitForTimeout(200)

      // Check that the list type is set correctly
      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].props.childrenType).toBe('Unordered')
      const listItems = blocks[0].children
      expect(listItems[0].content[0].text).toBe('Child 1')
      expect(listItems[1].content[0].text).toBe('Child 2')
    })
  })

  test("Should add a link with a link button's search input", async ({
    editorHelpers,
    page,
  }) => {
    await editorHelpers.typeText('Hello Link')
    await page.waitForTimeout(100)
    await editorHelpers.selectText('Link')
    await page.waitForTimeout(100)
    const selectedText = await editorHelpers.getSelectedText()
    expect(selectedText).toBe('Link')
    await page.waitForTimeout(100)
    await expect(page.getByTestId('link-button')).toBeVisible()
    await page.getByTestId('link-button').click()
    await page.waitForTimeout(100)
    await expect(page.getByTestId('link-search-input')).toBeVisible()
    await page.getByTestId('link-search-input').focus()
    await editorHelpers.typeText('test')
    await expect(page.getByTestId('search-result-Test HM Doc')).toBeVisible()
    await page.getByTestId('search-result-Test HM Doc').click()
    await page.waitForTimeout(100)
    await expect(page.getByTestId('link-search-input')).not.toBeVisible()
    const blocks = await editorHelpers.getBlocks()
    expect(blocks[0].content[1].content[0].text).toBe('Link')
    expect(blocks[0].content[1].type).toBe('link')
    expect(blocks[0].content[1].href).toContain(
      'hm://bafy-doc-uid/Root/Notes/Test HM Doc',
    )
  })
})
test.describe('Slash Menu', () => {
  test('Should open slash menu when typing /', async ({
    editorHelpers,
    page,
  }) => {
    await editorHelpers.typeText('/')

    // Wait for slash menu - Mantine Menu component
    const slashMenu = page.locator('.mantine-Menu-dropdown')
    await expect(slashMenu).toBeVisible({timeout: 5000})
  })

  test('Should close slash menu on Escape', async ({editorHelpers, page}) => {
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
    await editorHelpers.openSlashMenu()

    // Navigate down
    await editorHelpers.pressKey('ArrowDown')
    await page.waitForTimeout(50)

    // Menu should still be visible
    const slashMenu = page.locator('.mantine-Menu-dropdown')
    await expect(slashMenu).toBeVisible()
  })

  test('Should select item with Enter', async ({editorHelpers, page}) => {
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

test.describe('Link Toolbar', () => {
  // Select the text with a link mark and wait for the link preview to be visible
  async function selectLinkAndExpectPreview(editorHelpers: any, page: any) {
    const contentArea = editorHelpers.getContentArea()
    await contentArea.locator(`span:has-text("Link")`).first().click()
    await page.waitForTimeout(50)
    await expect(page.getByTestId('hm-link-preview')).toBeVisible()
    await expect(page.getByTestId('hm-link-preview-edit-button')).toBeVisible()
  }

  // Open the link form with the edit button in link preview
  async function openEditForm(page: any) {
    await page.getByTestId('hm-link-preview-edit-button').click()
    await page.waitForTimeout(50)
    await expect(page.getByTestId('hm-link-form')).toBeVisible()
  }

  test.describe('External link', () => {
    test.use({editorFixture: 'withExternalLink'})

    test.beforeEach(async ({editorHelpers, page}) => {
      await selectLinkAndExpectPreview(editorHelpers, page)
    })

    test('Should open the link preview form', async ({page}) => {
      await openEditForm(page)
    })

    test('Should edit the link text in the link preview form', async ({
      editorHelpers,
      page,
    }) => {
      await openEditForm(page)

      await expect(page.getByTestId('link-text-input')).toBeVisible()
      await page.getByTestId('link-text-input').fill('New Link')
      await page.waitForTimeout(100)
      await page.getByTestId('link-text-input').blur()

      const text = await editorHelpers.getEditorText()
      expect(text).toBe('Hello New Link')
    })

    test('Should edit the link url in the link preview form', async ({
      editorHelpers,
      page,
    }) => {
      await openEditForm(page)

      await expect(page.getByTestId('link-search-input')).toBeVisible()
      await page
        .getByTestId('link-search-input')
        .fill('https://www.secondexample.com')

      await expect(page.getByTestId('link-resource-type')).toHaveText(
        'Web Address',
      )

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].content[1].content[0].text).toBe('Link')
      expect(blocks[0].content[1].type).toBe('link')
      expect(blocks[0].content[1].href).toContain(
        'https://www.secondexample.com',
      )
    })

    test('Change the link url with the search input', async ({
      editorHelpers,
      page,
    }) => {
      await openEditForm(page)

      await expect(page.getByTestId('link-search-input')).toBeVisible()
      await page.getByTestId('link-search-input').clear()
      await page.getByTestId('link-search-input').focus()

      await editorHelpers.typeText('test')
      await expect(page.getByTestId('search-result-Test HM Doc')).toBeVisible()
      await page.getByTestId('search-result-Test HM Doc').click()

      await expect(page.getByTestId('link-search-input')).not.toBeVisible()

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].content[1].content[0].text).toBe('Link')
      expect(blocks[0].content[1].type).toBe('link')
      expect(blocks[0].content[1].href).toContain(
        'hm://seed.test/doc/test-hm-doc',
      )
    })
  })

  test.describe('HM link', () => {
    test.use({editorFixture: 'withHmLink'})

    test.beforeEach(async ({editorHelpers, page}) => {
      await selectLinkAndExpectPreview(editorHelpers, page)
    })

    test('Should show Seed Resource type for hm link', async ({
      editorHelpers,
      page,
    }) => {
      await openEditForm(page)

      await expect(page.getByTestId('link-resource-type')).toHaveText(
        'Seed Resource',
      )

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].content[1].type).toBe('link')
      expect(blocks[0].content[1].href).toContain(
        'hm://bafy-doc-uid/Root/Notes/Test HM Doc',
      )
    })
  })
})

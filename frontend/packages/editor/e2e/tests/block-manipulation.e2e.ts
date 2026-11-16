import {expect, test} from './fixtures'

// Opt out of clipboard permissions for block manipulation tests
test.use({clipboardPermissions: false})

test.describe('Block Manipulation', () => {
  test.describe('Block Insertion', () => {
    test('Should start with content after fixture initialization', async ({editorHelpers}) => {
      // The editor should have one empty paragraph node after initialization
      const blocks = await editorHelpers.getAllBlocks()
      expect(blocks.length).toBeGreaterThanOrEqual(1)
      expect(blocks[0].type).toBe('paragraph')
    })

    test('Should create new paragraph block on Enter', async ({editorHelpers, page}) => {
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

    test('Should carry text formatting to the block created by Enter', async ({editorHelpers, page}) => {
      await page.evaluate(() => {
        window.TEST_EDITOR?.editor?.addStyles({textSize: 'large', textFamily: 'serif'})
      })
      await editorHelpers.typeText('First paragraph')
      await editorHelpers.pressKey('Enter')
      await editorHelpers.typeText('Second paragraph')

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].content[0].styles).toMatchObject({textSize: 'large', textFamily: 'serif'})
      expect(blocks[1].content[0].styles).toMatchObject({textSize: 'large', textFamily: 'serif'})
    })

    test('Should insert heading with slash menu', async ({editorHelpers, page}) => {
      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Heading')
      // await page.waitForTimeout(200)

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].type).toBe('heading')
    })

    test('Should insert code block with slash menu', async ({editorHelpers}) => {
      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Code Block')
      await editorHelpers.typeText('const answer = 42')

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].type).toBe('code-block')
      expect(blocks[0].content[0].text).toBe('const answer = 42')
    })

    test('Should remove empty code block formatting on Backspace', async ({editorHelpers}) => {
      await editorHelpers.openSlashMenu()
      await editorHelpers.clickSlashMenuItem('Code Block')
      await editorHelpers.pressKey('Backspace')

      const blocks = await editorHelpers.getAllBlocks()
      expect(blocks[0].type).toBe('paragraph')
      expect(blocks[0].content).toEqual([])
    })

    test('Should filter slash menu items when typing after slash', async ({editorHelpers, page}) => {
      await editorHelpers.typeText('/head')
      // await page.waitForTimeout(300)

      // Heading should be visible in the Mantine Menu
      const headingItem = page.locator('.mantine-Menu-dropdown >> text="Heading"')
      await expect(headingItem).toBeVisible()

      // Paragraph should not be visible (filtered out)
      const paragraphItem = page.locator('.mantine-Menu-dropdown >> text="Paragraph"')
      await expect(paragraphItem).not.toBeVisible()
    })
  })

  test.describe('Block Deletion', () => {
    test('Should delete empty block with Backspace', async ({editorHelpers, page}) => {
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

    test('Should merge blocks when backspacing at start', async ({editorHelpers, page}) => {
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

    test('Should keep the list under the block above when Backspace removes the empty line', async ({
      editorHelpers,
      page,
    }) => {
      const parentId: string = await page.evaluate(() => {
        const ed = window.TEST_EDITOR.editor
        if (!ed) throw new Error('TEST_EDITOR.editor not found')
        const inserted = ed.insertBlocks(
          [
            {
              type: 'paragraph',
              content: [{type: 'text', text: 'one block', styles: {}}],
              props: {childrenType: 'Unordered'},
              children: [
                {type: 'paragraph', content: [{type: 'text', text: 'item 1', styles: {}}]},
                {type: 'paragraph', content: [{type: 'text', text: 'item 2', styles: {}}]},
              ],
            },
          ],
          ed.topLevelBlocks[0]!.id,
          'after',
        )
        return inserted[0]!.id
      })
      await page.waitForTimeout(150)
      await page.evaluate((id) => {
        const ed = window.TEST_EDITOR.editor
        if (!ed) throw new Error('TEST_EDITOR.editor not found')
        ed.setTextCursorPosition(id, 'end')
        ed.focus()
      }, parentId)
      await page.waitForTimeout(120)

      const blockCountBefore = await page.evaluate(() => window.TEST_EDITOR.getBlocks().length)

      await editorHelpers.pressKey('Enter')
      await page.waitForTimeout(150)
      await editorHelpers.pressKey('Backspace')
      await page.waitForTimeout(200)

      const result = await page.evaluate((id) => {
        const blocks = window.TEST_EDITOR.getBlocks()
        const parent = blocks.find((b: any) => b.id === id)
        return {
          count: blocks.length,
          parent: parent
            ? {
                childrenType: parent.props?.childrenType,
                children: parent.children.map((c: any) => c.content?.[0]?.text),
              }
            : null,
        }
      }, parentId)

      expect(result.parent).not.toBeNull()
      expect(result.parent!.childrenType).toBe('Unordered')
      expect(result.parent!.children).toEqual(['item 1', 'item 2'])
      expect(result.count).toBe(blockCountBefore)
    })

    test('Should delete selected text with Delete key', async ({editorHelpers, page}) => {
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
    test('Should add a heading after paragraph with slash menu', async ({editorHelpers, page}) => {
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

    test('Should preserve text when changing block type', async ({editorHelpers, page}) => {
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

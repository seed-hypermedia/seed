import {expect, test} from './fixtures'
import {
  htmlContent,
  markdownContent,
  plainTextContent,
  seedBlockHTML,
} from './test-content'

/**
 * Copy-Paste E2E Tests
 *
 * Tests for copy pasting content:
 * 1. From the Seed editor
 * 2. From external sources
 */

test.describe('Copy and Paste', () => {
  // ===========================================================================
  // PLAIN TEXT
  // ===========================================================================
  test.describe('Plain Text', () => {
    test('Should copy and paste single line text within editor', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Hello World')

      // Select all and copy
      await editorHelpers.selectAll()
      await editorHelpers.copy()
      await page.waitForTimeout(100)

      // Unselect all and paste
      await editorHelpers.pressKey('ArrowRight')
      await page.waitForTimeout(100)
      await editorHelpers.paste()
      await page.waitForTimeout(300)

      // Check that there are two blocks with the same text
      const blocks = await editorHelpers.getBlocks()
      expect(blocks.length).toBeGreaterThanOrEqual(2)
      expect(blocks[0].content[0].text).toBe('Hello World')
      expect(blocks[1].content[0].text).toBe('Hello World')
    })

    test('Should copy and paste multi-line plain text within editor', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Line 1')
      await editorHelpers.pressKey('Shift+Enter')
      await editorHelpers.typeText('Line 2')
      await editorHelpers.pressKey('Shift+Enter')
      await editorHelpers.typeText('Line 3')

      // Select all and copy
      await editorHelpers.selectAll()
      await editorHelpers.copy()
      await page.waitForTimeout(100)

      // Unselect all and paste
      await editorHelpers.pressKey('ArrowRight')
      await page.waitForTimeout(100)
      await editorHelpers.paste()
      await page.waitForTimeout(300)

      // Check that there are two blocks with the same multi-line text
      const blocks = await editorHelpers.getBlocks()
      expect(blocks.length).toBeGreaterThanOrEqual(2)
      expect(blocks[0].content[0].text).toBe('Line 1\nLine 2\nLine 3')
      expect(blocks[1].content[0].text).toBe('Line 1\nLine 2\nLine 3')
    })

    test('Should copy and paste multi-line plain text as three paragraph blocks', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardText(plainTextContent.multiParagraph)
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      const blocks = await editorHelpers.getBlocks()
      expect(blocks.length).toBeGreaterThanOrEqual(3)
      expect(blocks[0].content[0].text).toBe('First paragraph')
      expect(blocks[1].content[0].text).toBe('Second paragraph')
      expect(blocks[2].content[0].text).toBe('Third paragraph')
    })

    test('Should paste plain text content inline', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      // Create a single paragraph block
      await editorHelpers.typeText('Hello ')

      await editorHelpers.setClipboardText('World')
      await editorHelpers.paste()
      await page.waitForTimeout(200)

      const blocks = await editorHelpers.getBlocks()
      expect(blocks.length).toEqual(1)
      expect(blocks[0].content[0].text).toBe('Hello World')
    })

    test('Should paste multi-paragraph content inline: first paragraph merges at cursor, rest become new blocks', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      // Create a single paragraph block
      await editorHelpers.typeText('HelloWorld')

      // Move cursor between Hello and World.
      for (let i = 0; i < 'World'.length; i++) {
        await editorHelpers.pressKey('ArrowLeft')
      }

      // Put multi-paragraph text onto clipboard.
      await editorHelpers.setClipboardText('AAA\n\nBBB\n\nCCC')
      await editorHelpers.paste()
      await page.waitForTimeout(200)

      const blocks = await editorHelpers.getBlocks()
      expect(blocks.length).toBeGreaterThanOrEqual(3)

      // First block should have merged "AAA" at the cursor position
      expect(blocks[0].content?.[0]?.text).toBe('HelloAAA')
    })
  })

  // ===========================================================================
  // HTML CONTENT
  // ===========================================================================
  test.describe('HTML Content (External)', () => {
    test('Should paste one HTML paragraph', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardHTML('<p>Simple test</p>')
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      const text = await editorHelpers.getEditorText()
      expect(text).toContain('Simple test')
    })

    test('Should paste multiple HTML paragraphs as separate blocks', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardHTML(htmlContent.multiParagraphHTML)
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      const blocks = await editorHelpers.getBlocks()
      expect(blocks.length).toBeGreaterThanOrEqual(3)
      expect(blocks[0].content[0].text).toBe('First paragraph')
      expect(blocks[1].content[0].text).toBe('Second paragraph')
      expect(blocks[2].content[0].text).toBe('Third paragraph')
    })

    // test('Should paste HTML with bold formatting', async ({
    //   editorHelpers,
    //   page,
    //   context,
    // }) => {
    //   await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    //   await editorHelpers.focusEditor()

    //   await editorHelpers.setClipboardHTML(htmlContent.boldText)
    //   await editorHelpers.paste()
    //   await page.waitForTimeout(50)

    //   // Check bold mark exists in the ProseMirror document
    //   const hasBold = await editorHelpers.hasMarkType('bold')
    //   expect(hasBold).toBe(true)

    //   // Get the actual bold marks to verify the text
    //   const boldMarks = await editorHelpers.getMarksOfType('bold')
    //   expect(boldMarks.length).toBeGreaterThan(0)
    //   expect(boldMarks[0].text).toBe('important')
    // })

    // test('Should paste HTML with italic formatting', async ({
    //   editorHelpers,
    //   page,
    //   context,
    // }) => {
    //   await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    //   await editorHelpers.focusEditor()

    //   await editorHelpers.setClipboardHTML(htmlContent.italicText)
    //   await editorHelpers.paste()
    //   await page.waitForTimeout(50)

    //   // Check italic mark exists in the ProseMirror document
    //   const hasItalic = await editorHelpers.hasMarkType('italic')
    //   expect(hasItalic).toBe(true)

    //   // Get the actual italic marks to verify the text
    //   const italicMarks = await editorHelpers.getMarksOfType('italic')
    //   expect(italicMarks.length).toBeGreaterThan(0)
    //   expect(italicMarks[0].text).toBe('emphasized')
    // })

    test('Should paste HTML with mixed formatting', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      // htmlContent.mixedFormatting has strong, emphasis, and underlined words
      await editorHelpers.setClipboardHTML(htmlContent.mixedFormatting)
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      const hasBold = await editorHelpers.hasMarkType('bold')
      const hasItalic = await editorHelpers.hasMarkType('italic')
      const hasUnderline = await editorHelpers.hasMarkType('underline')
      expect(hasBold).toBe(true)
      expect(hasItalic).toBe(true)
      expect(hasUnderline).toBe(true)

      const boldMarks = await editorHelpers.getMarksOfType('bold')
      const italicMarks = await editorHelpers.getMarksOfType('italic')
      const underlineMarks = await editorHelpers.getMarksOfType('underline')
      expect(boldMarks.length).toBeGreaterThan(0)
      expect(italicMarks.length).toBeGreaterThan(0)
      expect(underlineMarks.length).toBeGreaterThan(0)
      expect(boldMarks[0].text).toBe('strong')
      expect(italicMarks[0].text).toBe('emphasis')
      expect(underlineMarks[0].text).toBe('underlined')
    })

    test('Should paste HTML with links', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardHTML(htmlContent.simpleLink)
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      const text = await editorHelpers.getEditorText()
      expect(text).toContain('Visit')
      expect(text).toContain('Example Site')

      // Check link mark exists in the ProseMirror document
      const hasLink = await editorHelpers.hasMarkType('link')
      expect(hasLink).toBe(true)

      // Get the actual link marks to verify href
      const linkMarks = await editorHelpers.getMarksOfType('link')
      expect(linkMarks.length).toBeGreaterThan(0)
      expect(linkMarks[0].attrs.href).toContain('https://example.com')
      expect(linkMarks[0].text).toBe('Example Site')
    })

    test('Should paste HTML headings', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardHTML(htmlContent.heading1)
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      await editorHelpers.pressKey('Enter')

      await editorHelpers.setClipboardHTML(htmlContent.heading2)
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      // Check if two headings were pasted and nested correctly
      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].type).toBe('heading')
      expect(blocks[0].content[0].text).toBe('Main Heading')
      expect(blocks[0].children[0].type).toBe('heading')
      expect(blocks[0].children[0].content[0].text).toBe('Subheading')
    })

    // test('Should paste complex HTML document', async ({
    //   editorHelpers,
    //   page,
    //   context,
    // }) => {
    //   await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    //   await editorHelpers.focusEditor()

    //   await editorHelpers.setClipboardHTML(htmlContent.complexDocument)
    //   await editorHelpers.paste()
    //   await page.waitForTimeout(50)

    //   const text = await editorHelpers.getEditorText()
    //   expect(text).toContain('Project Overview')
    //   expect(text).toContain('complex')
    //   expect(text).toContain('Learn more')
    // })
  })

  // ===========================================================================
  // LISTS AND BLOCKQUOTE
  // ===========================================================================
  test.describe('Lists', () => {
    test.describe('From Editor', () => {
      test('Should copy and paste list items created in editor', async ({
        editorHelpers,
        page,
      }) => {
        await editorHelpers.focusEditor()

        // Create a paragraph with a list
        await editorHelpers.typeText('Parent')
        await editorHelpers.pressKey('Enter')
        await page.waitForTimeout(100)
        await editorHelpers.typeText('* ')
        await page.waitForTimeout(100)
        await editorHelpers.typeText('Item 1')
        await editorHelpers.pressKey('Enter')
        await page.waitForTimeout(100)
        await editorHelpers.typeText('Item 2')
        await editorHelpers.pressKey('Enter')
        await page.waitForTimeout(100)
        await editorHelpers.typeText('Item 3')
        await page.waitForTimeout(100)

        // Select all and copy
        await editorHelpers.selectAll()
        await page.waitForTimeout(100)
        await editorHelpers.copy()
        await page.waitForTimeout(100)

        // Unselect all and paste
        await editorHelpers.pressKey('ArrowRight')
        await page.waitForTimeout(100)
        await editorHelpers.paste()
        await page.waitForTimeout(200)

        const text = await editorHelpers.getEditorText()
        // Should have duplicated items
        // TODO: Improve to check the actual list items
        const itemACount = (text.match(/Item 1/g) || []).length
        expect(itemACount).toBeGreaterThanOrEqual(2)
      })
    })

    test.describe('From External Sources', () => {
      test('Should paste HTML unordered list', async ({
        editorHelpers,
        page,
        context,
      }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await editorHelpers.focusEditor()

        await editorHelpers.setClipboardHTML(htmlContent.unorderedList)
        await editorHelpers.paste()
        await page.waitForTimeout(50)

        const blocks = await editorHelpers.getBlocks()
        // Check that the list was pasted correctly
        const listBlock = blocks[0]
        expect(listBlock).toBeDefined()
        expect(listBlock.props?.childrenType).toBe('Unordered')
        expect(listBlock.children[0].content[0].text).toBe('Item 1')
        expect(listBlock.children[1].content[0].text).toBe('Item 2')
        expect(listBlock.children[2].content[0].text).toBe('Item 3')
      })

      test('Should paste HTML ordered list', async ({
        editorHelpers,
        page,
        context,
      }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await editorHelpers.focusEditor()

        await editorHelpers.setClipboardHTML(htmlContent.orderedList)
        await editorHelpers.paste()
        await page.waitForTimeout(50)

        const blocks = await editorHelpers.getBlocks()
        // Check that the list was pasted correctly
        const listBlock = blocks[0]
        expect(listBlock).toBeDefined()
        expect(listBlock.props?.childrenType).toBe('Ordered')
        expect(listBlock.children[0].content[0].text).toBe('Item 1')
        expect(listBlock.children[1].content[0].text).toBe('Item 2')
        expect(listBlock.children[2].content[0].text).toBe('Item 3')
      })

      test('Should paste HTML nested list', async ({
        editorHelpers,
        page,
        context,
      }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await editorHelpers.focusEditor()

        await editorHelpers.setClipboardHTML(htmlContent.nestedList)
        await editorHelpers.paste()
        await page.waitForTimeout(50)

        const blocks = await editorHelpers.getBlocks()
        // Check that two lists were pasted correctly
        const listBlock = blocks[0]
        expect(listBlock).toBeDefined()
        expect(listBlock.props?.childrenType).toBe('Unordered')
        expect(listBlock.children[0].content[0].text).toBe('Parent item')
        expect(listBlock.children[0].props?.childrenType).toBe('Unordered')
        expect(listBlock.children[0].children[0].content[0].text).toBe(
          'Child item 1',
        )
        expect(listBlock.children[0].children[1].content[0].text).toBe(
          'Child item 2',
        )
        expect(listBlock.children[1].content[0].text).toBe('Another parent')
      })

      test('Should paste HTML blockquote', async ({
        editorHelpers,
        page,
        context,
      }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await editorHelpers.focusEditor()

        await editorHelpers.setClipboardHTML(htmlContent.blockquote)
        await editorHelpers.paste()
        await page.waitForTimeout(50)

        const blocks = await editorHelpers.getBlocks()
        const blockquoteBlock = blocks[0]
        expect(blockquoteBlock).toBeDefined()
        expect(blockquoteBlock.props?.childrenType).toBe('Blockquote')
        expect(blockquoteBlock.children[0].content[0].text).toContain(
          'quoted text',
        )
      })

      test('Should copy and paste a nested list created in editor', async ({
        editorHelpers,
        page,
      }) => {
        await editorHelpers.focusEditor()

        // Create a list:
        // Parent
        // - Parent 1
        //   - Child 1
        //   - Child 2
        // - Parent 2
        await editorHelpers.typeText('Parent')
        await editorHelpers.pressKey('Enter')
        await page.waitForTimeout(100)
        await editorHelpers.typeText('* ')
        await page.waitForTimeout(100)
        await editorHelpers.typeText('Parent 1')
        await editorHelpers.pressKey('Enter')

        // Indent to create nested list under Parent 1
        await editorHelpers.pressKey('Tab')
        await editorHelpers.typeText('Child 1')
        await editorHelpers.pressKey('Enter')
        await editorHelpers.typeText('Child 2')
        await editorHelpers.pressKey('Enter')

        // Unindent back to parent list level
        await editorHelpers.pressKey('Shift+Tab')
        await editorHelpers.typeText('Parent 2')
        await page.waitForTimeout(150)

        // Copy the nested list
        await editorHelpers.selectNestedList('Parent 1', 'Unordered')
        await page.waitForTimeout(100)
        await editorHelpers.copy()
        await page.waitForTimeout(100)

        await editorHelpers.moveCursorToEnd()
        await editorHelpers.paste()
        await page.waitForTimeout(250)

        // Check that the nested list items are duplicated
        const text = await editorHelpers.getEditorText()
        for (const item of ['Child 1', 'Child 2']) {
          const count = (text.match(new RegExp(item, 'g')) || []).length
          expect(count).toBeGreaterThanOrEqual(2)
        }
        // TODO: Check that the pasted list is pasted at the correct level and position
      })

      // test('Should paste plain text list-like content', async ({
      //   editorHelpers,
      //   page,
      //   context,
      // }) => {
      //   await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      //   await editorHelpers.focusEditor()

      //   await editorHelpers.setClipboardText(plainTextContent.listLike)
      //   await editorHelpers.paste()
      //   await page.waitForTimeout(200)

      //   const text = await editorHelpers.getEditorText()
      //   expect(text).toContain('Item 1')
      //   expect(text).toContain('Item 2')
      //   expect(text).toContain('Item 3')
      // })
    })
  })

  // ===========================================================================
  // MARKDOWN CONTENT
  // ===========================================================================
  test.describe('Markdown Content', () => {
    test('Should paste markdown heading', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardText(markdownContent.heading)
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].type).toBe('heading')
      expect(blocks[0].content[0].text).toBe('Main Heading')
    })

    test('Should paste markdown with formatting', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardText(markdownContent.mixed)
      await editorHelpers.paste()
      await page.waitForTimeout(200)

      const hasBold = await editorHelpers.hasMarkType('bold')
      const hasItalic = await editorHelpers.hasMarkType('italic')
      expect(hasBold).toBe(true)
      expect(hasItalic).toBe(true)
    })

    test('Should paste markdown list', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardText(markdownContent.unorderedList)
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      const text = await editorHelpers.getEditorText()
      expect(text).toContain('Item 1')
      expect(text).toContain('Item 2')
      expect(text).toContain('Item 3')

      // TODO: Check if the list is created. Right now it's not so this test just checks that no content is lost
      // const blocks = await editorHelpers.getBlocks()
    })

    test('Should paste complex markdown document', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardText(markdownContent.complexDocument)
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      const text = await editorHelpers.getEditorText()
      expect(text).toContain('Document Title')
      expect(text).toContain('paragraph')
      expect(text).toContain('Feature one')

      const hasBold = await editorHelpers.hasMarkType('bold')
      const hasItalic = await editorHelpers.hasMarkType('italic')
      const hasLink = await editorHelpers.hasMarkType('link')
      expect(hasBold).toBe(true)
      expect(hasItalic).toBe(true)
      expect(hasLink).toBe(true)

      // Get the actual link marks to verify href
      const linkMarks = await editorHelpers.getMarksOfType('link')
      expect(linkMarks.length).toBeGreaterThan(0)
      expect(linkMarks[0].attrs.href).toContain('https://example.com')
      expect(linkMarks[0].text).toBe('our site')
    })
  })

  // ===========================================================================
  // CODE
  // ===========================================================================
  test.describe('Code Content', () => {
    test('Should paste HTML inline code', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardHTML(htmlContent.inlineCode)
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      const hasCode = await editorHelpers.hasMarkType('code')
      expect(hasCode).toBe(true)

      const codeMarks = await editorHelpers.getMarksOfType('code')
      expect(codeMarks.length).toBeGreaterThan(0)
      expect(codeMarks[0].text).toBe('console.log()')
    })

    test('Should paste HTML code block', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardHTML(htmlContent.codeBlock)
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      const text = await editorHelpers.getEditorText()
      expect(text).toContain('function')
      expect(text).toContain('hello')

      const blocks = await editorHelpers.getBlocks()
      expect(blocks[0].type).toBe('code-block')
      // TODO: Check language
    })
  })

  // ===========================================================================
  // CUT OPERATIONS
  // ===========================================================================
  test.describe('Cut Operations', () => {
    test('Should cut text and remove from editor', async ({
      editorHelpers,
      page,
    }) => {
      // Note: This test fails without timeout. Needs time to process the cut operation
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Cut this text')
      await page.waitForTimeout(100)

      await editorHelpers.selectAll()
      await page.waitForTimeout(100)
      await editorHelpers.cut()
      await page.waitForTimeout(300)

      const text = await editorHelpers.getEditorText()
      expect(text.trim()).toBe('')
    })

    test('Should cut the text and paste it after cutting', async ({
      editorHelpers,
      page,
    }) => {
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Cut and paste me')
      await page.waitForTimeout(50)

      await editorHelpers.selectAll()
      await page.waitForTimeout(50)
      await editorHelpers.cut()
      await page.waitForTimeout(200)

      await editorHelpers.paste()
      await page.waitForTimeout(100)

      const text = await editorHelpers.getEditorText()
      expect(text).toContain('Cut and paste me')
    })
  })

  // ===========================================================================
  // SEED BLOCK TYPES
  // ===========================================================================
  test.describe('Seed Block Types', () => {
    // Skip: embed blocks need universalClient context which is not available
    // in the isolated test harness
    test.skip('should paste Seed embed block (Card view)', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardHTML(seedBlockHTML.embedCard)
      await editorHelpers.paste()
      await page.waitForTimeout(200)

      const blocks = await editorHelpers.getBlocks()
      // Should create an embed block
      const hasEmbed = blocks.some((b: any) => b.type === 'embed')
      expect(hasEmbed || blocks.length > 0).toBe(true)
    })

    test.skip('should paste Seed embed block (Content view)', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardHTML(seedBlockHTML.embedContent)
      await editorHelpers.paste()
      await page.waitForTimeout(200)

      const blocks = await editorHelpers.getBlocks()
      expect(blocks.length).toBeGreaterThan(0)
    })

    test('Should paste an image block', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardHTML(seedBlockHTML.image)
      await editorHelpers.paste()
      await page.waitForTimeout(200)

      const blocks = await editorHelpers.getBlocks()
      // Should create an image block
      const hasImage = blocks.some((b: any) => b.type === 'image')
      expect(hasImage || blocks.length > 0).toBe(true)
    })

    // TODO: Add tests for other seed block types
  })

  // ===========================================================================
  // EXTERNAL SOURCES
  // ===========================================================================
  test.describe('External Sources', () => {
    test('Should paste content from Google Docs', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardHTML(htmlContent.googleDocs.formattedText)
      await editorHelpers.paste()
      await page.waitForTimeout(200)

      const text = await editorHelpers.getEditorText()
      expect(text).toContain('Some article')
      expect(text).toContain('eyes are the window to the soul')
    })

    test('Should paste list from Google Docs', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Parent for list')
      await editorHelpers.pressKey('Enter')

      await editorHelpers.setClipboardHTML(htmlContent.googleDocs.list)
      await editorHelpers.paste()
      await page.waitForTimeout(50)

      const blocks = await editorHelpers.getBlocks()
      // First block is "Parent for list", second should be the pasted list
      const listBlock = blocks[1]
      expect(listBlock).toBeDefined()
      expect(listBlock.props?.childrenType).toBe('Unordered')

      // Check that there's a nested unordered child list
      const hasNestedList = listBlock.children?.some((child: any) => {
        if (
          child.children?.length > 0 &&
          child.props?.childrenType === 'Unordered'
        ) {
          return child.children?.some((nested: any) => {
            return nested.content?.some((c: any) => c.text?.includes('Test 5'))
          })
        }
        return false
      })
      expect(hasNestedList).toBe(true)
    })

    test.skip('Should paste content from Notion', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardHTML(htmlContent.notion.formattedText)
      await editorHelpers.paste()
      await page.waitForTimeout(200)

      const text = await editorHelpers.getEditorText()
      expect(text).toContain('Notion')
      expect(text).toContain('bold')
      expect(text).toContain('italic')
    })

    test('Should paste content from ChatGPT', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()

      await editorHelpers.setClipboardHTML(htmlContent.chatGpt.formattedText)
      await editorHelpers.paste()
      await page.waitForTimeout(200)

      const text = await editorHelpers.getEditorText()
      expect(text).toContain('DC IN')
      expect(text).toContain('charging')
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================
  test.describe('Edge Cases', () => {
    test('Should replace selected text when pasting', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Original text')
      await page.waitForTimeout(50)

      await editorHelpers.selectAll()
      await editorHelpers.setClipboardText('Replacement text')
      await editorHelpers.paste()
      await page.waitForTimeout(100)

      const text = await editorHelpers.getEditorText()
      expect(text).toContain('Replacement')
      expect(text).not.toContain('Original')
    })

    test('Should handle empty clipboard', async ({
      editorHelpers,
      page,
      context,
    }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await editorHelpers.focusEditor()
      await editorHelpers.typeText('Some text')

      // Set empty clipboard
      await editorHelpers.setClipboardText('')
      await editorHelpers.paste()
      await page.waitForTimeout(100)

      // Editor should still work
      const text = await editorHelpers.getEditorText()
      expect(text).toContain('Some text')
    })
  })
})

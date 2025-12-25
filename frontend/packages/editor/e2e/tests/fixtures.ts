import {test as base, Locator} from '@playwright/test'

/**
 * Custom test fixture for editor E2E tests.
 * Provides helper methods for interacting with the editor.
 */

// Store clipboard content for direct paste dispatch
let _clipboardHTML = ''
let _clipboardText = ''

export type EditorTestHelpers = {
  /** Wait for the editor to be ready */
  waitForEditorReady: () => Promise<void>
  /** Get the editable content area */
  getContentArea: () => Locator
  /** Get the current block count via the exposed test API */
  getBlockCount: () => Promise<number>
  /** Get all blocks before trailing empty ones */
  getBlocks: () => Promise<any[]>
  /** Get all blocks including trailing empty ones */
  getAllBlocks: () => Promise<any[]>
  /** Type text in the editor */
  typeText: (text: string) => Promise<void>
  /** Press a keyboard key or combination */
  pressKey: (key: string) => Promise<void>
  /** Focus the editor */
  focusEditor: () => Promise<void>
  /** Get selected text */
  getSelectedText: () => Promise<string>
  /** Select all text */
  selectAll: () => Promise<void>
  /** Select range between elements */
  selectRangeBetweenElements: (
    startEl: Locator,
    endEl: Locator,
  ) => Promise<void>
  /** Select nested list under item */
  selectNestedList: (
    itemText: string,
    listType: 'Unordered' | 'Ordered' | 'Blockquote',
  ) => Promise<void>
  /** Select text by dragging */
  dragSelectText: (fromText: string, toText: string) => Promise<void>
  /** Open slash menu by typing '/' */
  openSlashMenu: () => Promise<void>
  /** Click on a slash menu item by name */
  clickSlashMenuItem: (name: string) => Promise<void>
  /** Get text content from the editor */
  getEditorText: () => Promise<string>
  /** Wait for formatting toolbar to appear */
  waitForFormattingToolbar: () => Promise<Locator>
  /** Click a toolbar button by aria-label or data-testid */
  clickToolbarButton: (identifier: string) => Promise<void>
  /** Create a text selection by dragging */
  selectText: () => Promise<void>
  /** Move cursor to the end of the document */
  moveCursorToEnd: () => Promise<void>
  /** Set clipboard with plain text content */
  setClipboardText: (text: string) => Promise<void>
  /** Set clipboard with HTML content (also sets plain text fallback) */
  setClipboardHTML: (html: string, plainText?: string) => Promise<void>
  /** Paste from clipboard */
  paste: () => Promise<void>
  /** Copy current selection to clipboard */
  copy: () => Promise<void>
  /** Cut current selection to clipboard */
  cut: () => Promise<void>
  /** Get the ProseMirror document JSON for detailed inspection */
  getDocJSON: () => Promise<any>
  /** Check if document contains a specific mark type */
  hasMarkType: (markType: string) => Promise<boolean>
  /** Get all marks of a specific type from the document */
  getMarksOfType: (markType: string) => Promise<any[]>
}

export const test = base.extend<{
  editorHelpers: EditorTestHelpers
}>({
  editorHelpers: async ({page}, use) => {
    const helpers: EditorTestHelpers = {
      async waitForEditorReady() {
        await page.waitForSelector('[data-testid="editor-harness"]')
        // Wait for the ProseMirror editor to be rendered
        await page.waitForSelector(
          '[data-testid="editor-container"] .ProseMirror, [data-testid="editor-container"] [contenteditable="true"]',
          {timeout: 10000},
        )
        await page.waitForTimeout(200)
        // Click on the editor to trigger initialization and focus
        const contentArea = page
          .locator(
            '[data-testid="editor-container"] .ProseMirror, [data-testid="editor-container"] [contenteditable="true"]',
          )
          .first()
        await contentArea.click()
        // Wait for ready flag to be set after first interaction
        await page.waitForFunction(
          () => {
            return window.TEST_EDITOR?.editor?.ready === true
          },
          {timeout: 10000},
        )
      },

      getContentArea() {
        return page
          .locator('[data-testid="editor-container"] [contenteditable="true"]')
          .first()
      },

      async getBlockCount() {
        return page.evaluate(() => {
          return window.TEST_EDITOR?.getBlocks()?.length ?? 0
        })
      },

      async getBlocks() {
        // Get blocks, filtering out trailing empty paragraphs
        return page.evaluate(() => {
          const blocks = window.TEST_EDITOR?.getBlocks() ?? []
          // Filter out trailing empty paragraphs
          return blocks.filter((block: any, index: number) => {
            const isLast = index === blocks.length - 1
            const isEmpty = !block.content || block.content.length === 0
            const isParagraph = block.type === 'paragraph'
            return !(isLast && isEmpty && isParagraph)
          })
        })
      },

      async getAllBlocks() {
        // Get all blocks including trailing empty ones
        return page.evaluate(() => {
          return window.TEST_EDITOR?.getBlocks() ?? []
        })
      },

      async typeText(text: string) {
        await page.keyboard.type(text)
      },

      async pressKey(key: string) {
        await page.keyboard.press(key)
      },

      async focusEditor() {
        await this.waitForEditorReady()
        await page.evaluate(() => {
          window.TEST_EDITOR?.focus()
        })
      },

      async getSelectedText() {
        return page.evaluate(() => {
          return window.TEST_EDITOR?.getSelectedText() ?? ''
        })
      },

      async selectAll() {
        await this.focusEditor()
        await page.keyboard.press('ControlOrMeta+A')
      },

      async selectRangeBetweenElements(startEl: Locator, endEl: Locator) {
        const startHandle = await startEl.elementHandle()
        const endHandle = await endEl.elementHandle()
        if (!startHandle || !endHandle)
          throw new Error('Missing element handle')

        await page.evaluate(
          ([start, end]) => {
            if (!start || !end) {
              throw new Error('Missing start or end element')
            }
            const sel = window.getSelection()
            if (!sel) return
            sel.removeAllRanges()

            const range = document.createRange()
            range.setStart(start, 0)
            range.setEnd(end, end.childNodes.length)

            sel.addRange(range)
          },
          [startHandle, endHandle],
        )
      },

      async selectNestedList(
        parentText: string,
        listType: 'Unordered' | 'Ordered' | 'Blockquote' = 'Unordered',
      ) {
        const contentArea = this.getContentArea()

        // Find the blockContainer that contains the parent list item text
        const parentItem = contentArea
          .locator('[data-node-type="blockContainer"]', {hasText: parentText})
          .first()

        // The nested list under that item is the child blockGroup inside that blockContainer.
        const nestedGroup = parentItem
          .locator(
            `[data-node-type="blockGroup"][data-list-type="${listType}"], ${
              listType === 'Unordered' ? 'ul' : 'ol'
            }`,
          )
          .last()

        await nestedGroup.waitFor({state: 'visible'})

        const handle = await nestedGroup.elementHandle()
        if (!handle) throw new Error('Nested list group element not found')
        await page.evaluate((groupEl) => {
          const bnEditor = (window as any).TEST_EDITOR?.editor
          if (!bnEditor) throw new Error('window.TEST_EDITOR.editor not found')

          const tiptap = (bnEditor as any)._tiptapEditor
          if (!tiptap?.view) throw new Error('tiptap editor/view not found')

          const view = tiptap.view

          let from = view.posAtDOM(groupEl as any, 0)
          let to = view.posAtDOM(
            groupEl as any,
            (groupEl as any).childNodes.length,
          )

          // Swap from and to if reversed
          if (from > to) [from, to] = [to, from]

          // Set selection
          tiptap.commands.setTextSelection({from, to})
          view.focus()
        }, handle)
      },

      async dragSelectText(fromText: string, toText: string) {
        const area = this.getContentArea()

        const from = area.locator(`:text("${fromText}")`).first()
        const to = area.locator(`:text("${toText}")`).first()

        const fromBox = await from.boundingBox()
        const toBox = await to.boundingBox()
        if (!fromBox || !toBox) throw new Error('Could not get bounding boxes')

        const startX = fromBox.x + Math.min(20, fromBox.width / 2)
        const endX = toBox.x + Math.min(20, toBox.width / 2)

        // Start slightly below the from box, so anchor is in the next block
        const startY = fromBox.y + fromBox.height + 6

        // End slightly above the to box, so head is in the previous block from the "to" block
        const endY = toBox.y - toBox.height / 2

        await page.mouse.move(startX, startY)
        await page.mouse.down()
        await page.mouse.move(endX, endY)
        await page.mouse.up()
      },

      async openSlashMenu() {
        await this.typeText('/')
        await page.waitForSelector(
          '.mantine-Menu-dropdown, [class*="mantine-"][class*="Menu"]',
          {timeout: 5000},
        )
      },

      async clickSlashMenuItem(name: string) {
        const menuItem = page.locator(
          `.mantine-Menu-dropdown >> text="${name}"`,
        )
        await menuItem.click()
      },

      async getEditorText() {
        return page.evaluate(() => {
          const editor = window.TEST_EDITOR?.editor
          if (!editor) return ''

          // Extract text from content items, handling links and nested content
          const extractContentText = (content: any[]): string => {
            return content
              .map((c: any) => {
                if (c.type === 'text') {
                  return c.text || ''
                } else if (c.type === 'link' && c.content) {
                  return extractContentText(c.content)
                }
                return ''
              })
              .join('')
          }

          // Recursive function to extract text from blocks and their children
          const extractText = (blocks: any[]): string[] => {
            const texts: string[] = []
            for (const block of blocks) {
              // Get text from this block's content
              if (block.content && block.content.length > 0) {
                const blockText = extractContentText(block.content)
                if (blockText) texts.push(blockText)
              }
              // Recursively get text from children
              if (block.children && block.children.length > 0) {
                texts.push(...extractText(block.children))
              }
            }
            return texts
          }

          return extractText(editor.topLevelBlocks).join('\n')
        })
      },

      async waitForFormattingToolbar() {
        const toolbar = page.locator('[class*="formattingToolbar"]')
        await toolbar.waitFor({state: 'visible', timeout: 5000})
        return toolbar
      },

      async clickToolbarButton(identifier: string) {
        const toolbar = await this.waitForFormattingToolbar()
        const button = toolbar.locator(
          `[aria-label="${identifier}"], [data-testid="${identifier}"], button:has-text("${identifier}")`,
        )
        await button.click()
      },

      async selectText() {
        const contentArea = this.getContentArea()
        const box = await contentArea.boundingBox()
        if (!box) throw new Error('Could not get content area bounding box')

        await contentArea.click({clickCount: 3})
      },

      async moveCursorToEnd() {
        await this.focusEditor()
        await page.evaluate(() => {
          const bnEditor = (window as any).TEST_EDITOR?.editor
          if (!bnEditor) throw new Error('window.TEST_EDITOR.editor not found')

          const tiptap = (bnEditor as any)._tiptapEditor
          if (!tiptap?.state) throw new Error('tiptap editor not found')

          const endPos = tiptap.state.doc.content.size
          tiptap.commands.setTextSelection(endPos)
          tiptap.view?.focus()
        })
      },

      async setClipboardText(text: string) {
        _clipboardHTML = ''
        _clipboardText = text

        // Write to clipboard - requires clipboard permissions granted via context.grantPermissions
        await page.evaluate(async (t) => {
          await navigator.clipboard.writeText(t)
        }, text)
      },

      async setClipboardHTML(html: string, plainText?: string) {
        const plain = plainText || html.replace(/<[^>]*>/g, '').trim()
        _clipboardHTML = html
        _clipboardText = plain

        // Write to clipboard - requires clipboard permissions granted via context.grantPermissions
        await page.evaluate(
          async ({h, p}) => {
            const htmlBlob = new Blob([h], {type: 'text/html'})
            const textBlob = new Blob([p], {type: 'text/plain'})
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/html': htmlBlob,
                'text/plain': textBlob,
              }),
            ])
          },
          {h: html, p: plain},
        )
      },

      async paste() {
        await page.keyboard.press('ControlOrMeta+V')
        await page.waitForTimeout(50)
      },

      async copy() {
        await page.keyboard.press('ControlOrMeta+C')
      },

      async cut() {
        await page.keyboard.press('ControlOrMeta+X')
      },

      async getDocJSON() {
        return page.evaluate(() => {
          const editor = window.TEST_EDITOR?.editor
          if (!editor) return null
          const state = editor._tiptapEditor?.state
          if (!state) return null
          return state.doc.toJSON()
        })
      },

      async hasMarkType(markType: string) {
        return page.evaluate((type) => {
          const editor = window.TEST_EDITOR?.editor
          if (!editor) return false
          const state = editor._tiptapEditor?.state
          if (!state) return false

          let found = false
          state.doc.descendants((node: any) => {
            if (node.marks) {
              node.marks.forEach((mark: any) => {
                if (mark.type.name === type) {
                  found = true
                }
              })
            }
            return !found // Stop if found
          })
          return found
        }, markType)
      },

      async getMarksOfType(markType: string) {
        return page.evaluate((type) => {
          const editor = window.TEST_EDITOR?.editor
          if (!editor) return []
          const state = editor._tiptapEditor?.state
          if (!state) return []

          const marks: any[] = []
          state.doc.descendants((node: any) => {
            if (node.marks) {
              node.marks.forEach((mark: any) => {
                if (mark.type.name === type) {
                  marks.push({
                    type: mark.type.name,
                    attrs: mark.attrs,
                    text: node.text,
                  })
                }
              })
            }
          })
          return marks
        }, markType)
      },
    }

    // Navigate to the test app before each test
    await page.goto('/')
    await helpers.waitForEditorReady()

    await use(helpers)
  },
})

export {expect} from '@playwright/test'

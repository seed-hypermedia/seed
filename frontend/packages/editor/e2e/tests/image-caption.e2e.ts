import {expect, test} from './fixtures'

test.use({clipboardPermissions: false})

test.describe('Image caption editing', () => {
  test('keeps the cursor in the caption and preserves the image when typing below it', async ({
    editorHelpers,
    page,
  }) => {
    await page.evaluate(() => {
      const editor = window.TEST_EDITOR?.editor
      const firstBlock = editor?.topLevelBlocks?.[0]
      if (!editor || !firstBlock) throw new Error('Editor not ready')

      editor.insertBlocks(
        [
          {
            type: 'image',
            props: {
              url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
              name: 'caption-test.gif',
              alt: 'Caption test image',
            },
            content: [],
          },
        ],
        firstBlock.id,
        'after',
      )
    })

    const caption = page.locator('.image-caption').first()
    await expect(caption).toBeVisible()
    await caption.click()
    await page.keyboard.type('A visible caption')

    await expect(page.locator('.bn-media-selected')).toHaveCount(0)

    const blocks = await editorHelpers.getAllBlocks()
    const imageBlock = blocks.find((block: any) => block.type === 'image')
    expect(imageBlock).toBeTruthy()
    expect(imageBlock.content).toEqual([{type: 'text', text: 'A visible caption', styles: {}}])
  })

  test('moves from the caption to the next block on Enter', async ({editorHelpers, page}) => {
    await page.evaluate(() => {
      const editor = window.TEST_EDITOR?.editor
      const firstBlock = editor?.topLevelBlocks?.[0]
      if (!editor || !firstBlock) throw new Error('Editor not ready')

      editor.insertBlocks(
        [
          {
            type: 'image',
            props: {
              url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
              name: 'caption-enter-test.gif',
              alt: 'Caption enter test image',
            },
            content: [],
          },
        ],
        firstBlock.id,
        'after',
      )
    })

    const caption = page.locator('.image-caption').first()
    await expect(caption).toBeVisible()
    await caption.click()
    await page.keyboard.type('Caption text')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Text below image')

    const blocks = await editorHelpers.getAllBlocks()
    const imageIndex = blocks.findIndex((block: any) => block.type === 'image')
    expect(imageIndex).toBeGreaterThanOrEqual(0)
    expect(blocks[imageIndex].content).toEqual([{type: 'text', text: 'Caption text', styles: {}}])

    const followingParagraph = blocks.slice(imageIndex + 1).find((block: any) => block.type === 'paragraph')
    expect(followingParagraph?.content).toEqual([{type: 'text', text: 'Text below image', styles: {}}])
  })
})

test.describe('Pasting into an image caption', () => {
  test.use({clipboardPermissions: true})

  // The caption is its own editable element, so a click moves focus there without ProseMirror reading the caret. A
  // paste right after the click used to land in the block that had the cursor before.
  for (const caption of ['', 'Old']) {
    test(`pastes into ${caption ? 'a caption with text' : 'an empty caption'} right after clicking it`, async ({
      editorHelpers,
      page,
    }) => {
      await page.evaluate((caption) => {
        const editor = window.TEST_EDITOR?.editor
        const firstBlock = editor?.topLevelBlocks?.[0]
        if (!editor || !firstBlock) throw new Error('Editor not ready')
        editor.insertBlocks(
          [
            {
              type: 'image',
              props: {url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', name: 'paste.gif'},
              content: caption,
            },
          ],
          firstBlock.id,
          'after',
        )
      }, caption)

      await page.locator('.image-caption').first().click()
      await editorHelpers.setClipboardText('Pasted caption')
      await editorHelpers.paste()
      await page.waitForTimeout(200)

      const blocks = await editorHelpers.getAllBlocks()
      const imageText = blocks
        .find((block: any) => block.type === 'image')
        .content.map((inline: any) => inline.text)
        .join('')
      expect(imageText).toContain('Pasted caption')
      expect(imageText.replace('Pasted caption', '')).toBe(caption)
      expect(blocks[0].content).toEqual([])
    })
  }

  // ProseMirror never sees keydown from a caption, so Mod-Z used to run the browser's own undo, which left the paste
  // in place or replayed old edits into the caption.
  test('undoes and redoes a caption paste with the editor history', async ({editorHelpers, page}) => {
    await page.evaluate(() => {
      const editor = window.TEST_EDITOR?.editor
      const firstBlock = editor?.topLevelBlocks?.[0]
      if (!editor || !firstBlock) throw new Error('Editor not ready')
      editor.insertBlocks(
        [{type: 'image', props: {url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', name: 'undo.gif'}, content: 'Old'}],
        firstBlock.id,
        'after',
      )
    })
    const allText = async () => JSON.stringify(await editorHelpers.getAllBlocks())

    await page.locator('.image-caption').first().click()
    await editorHelpers.setClipboardText('Pasted caption')
    await editorHelpers.paste()
    await expect.poll(allText).toContain('Pasted caption')

    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(allText).not.toContain('Pasted caption')

    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect.poll(allText).toContain('Pasted caption')
  })
})

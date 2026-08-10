import {expect, test} from './fixtures'

test.use({clipboardPermissions: false})

async function insertImageBlock(page: any, name: string) {
  await page.evaluate((fileName: string) => {
    const editor = window.TEST_EDITOR?.editor
    const firstBlock = editor?.topLevelBlocks?.[0]
    if (!editor || !firstBlock) throw new Error('Editor not ready')

    editor.insertBlocks(
      [
        {
          type: 'image',
          props: {
            url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
            name: fileName,
            alt: 'Caption test image',
          },
          content: [],
        },
      ],
      firstBlock.id,
      'after',
    )
  }, name)
}

/**
 * The ProseMirror selection, resolved against the block it belongs to — the
 * same shape the fragment actions read when they build `#blockId[start:end]`.
 */
async function getSelectionInfo(page: any) {
  return page.evaluate(() => {
    const view = (window.TEST_EDITOR?.editor as any)?._tiptapEditor?.view
    if (!view) throw new Error('tiptap view not found')
    const {from, to, empty} = view.state.selection
    let blockId: string | null = null
    let blockType: string | null = null
    view.state.doc.nodesBetween(from, to, (node: any) => {
      if (node.type.name !== 'blockNode' || blockId) return true
      blockId = node.attrs?.id ?? null
      blockType = node.firstChild?.type?.name ?? null
      return true
    })
    return {empty, text: view.state.doc.textBetween(from, to), hasFocus: view.hasFocus(), blockId, blockType}
  })
}

test.describe('Image caption selection', () => {
  test.use({editorEditMode: true})

  test('selects caption text with the keyboard and shows the formatting toolbar', async ({editorHelpers, page}) => {
    await insertImageBlock(page, 'caption-keyboard.gif')

    const caption = page.locator('.image-caption').first()
    await expect(caption).toBeVisible()
    await caption.click()
    await page.keyboard.type('Caption words')

    await page.keyboard.press('Home')
    for (let i = 0; i < 7; i++) await page.keyboard.press('Shift+ArrowRight')
    await page.waitForTimeout(100)

    const selection = await getSelectionInfo(page)
    expect(selection.hasFocus).toBe(true)
    expect(selection.empty).toBe(false)
    expect(selection.text).toBe('Caption')
    expect(selection.blockType).toBe('image')

    await expect(page.getByTestId('formatting-toolbar')).toBeVisible()
  })

  test('selects caption text by dragging with the mouse', async ({editorHelpers, page}) => {
    await insertImageBlock(page, 'caption-mouse.gif')

    const caption = page.locator('.image-caption').first()
    await expect(caption).toBeVisible()
    await caption.click()
    await page.keyboard.type('Caption words')
    await page.waitForTimeout(100)

    const box = await caption.boundingBox()
    if (!box) throw new Error('Caption has no bounding box')
    await page.mouse.move(box.x + 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, {steps: 10})
    await page.mouse.up()
    await page.waitForTimeout(100)

    const selection = await getSelectionInfo(page)
    expect(selection.empty).toBe(false)
    expect(selection.text.length).toBeGreaterThan(0)
    expect('Caption words').toContain(selection.text)
    expect(selection.blockType).toBe('image')
  })

  test('applies bold to a caption selection', async ({editorHelpers, page}) => {
    await insertImageBlock(page, 'caption-bold.gif')

    const caption = page.locator('.image-caption').first()
    await expect(caption).toBeVisible()
    await caption.click()
    await page.keyboard.type('Bold caption')

    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ControlOrMeta+ArrowRight')
    await page.waitForTimeout(100)
    await page.keyboard.press('ControlOrMeta+B')
    await page.waitForTimeout(100)

    const blocks = await editorHelpers.getAllBlocks()
    const imageBlock = blocks.find((block: any) => block.type === 'image')
    expect(imageBlock.content[0]).toMatchObject({text: 'Bold', styles: {bold: true}})
    expect(imageBlock.content[1]).toMatchObject({text: ' caption'})
  })
})

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

  test('creates a paragraph below the image on Enter when the image is the last block', async ({
    editorHelpers,
    page,
  }) => {
    await page.evaluate(() => {
      const editor = window.TEST_EDITOR?.editor
      const blocks = editor?.topLevelBlocks
      const lastBlock = blocks?.[blocks.length - 1]
      if (!editor || !lastBlock) throw new Error('Editor not ready')

      editor.insertBlocks(
        [
          {
            type: 'image',
            props: {
              url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
              name: 'caption-last-block.gif',
              alt: 'Caption last block image',
            },
            content: [],
          },
        ],
        lastBlock.id,
        'after',
      )
    })

    const caption = page.locator('.image-caption').first()
    await expect(caption).toBeVisible()
    await caption.click()
    await page.keyboard.type('Trailing caption')
    await page.keyboard.press('Enter')
    await page.keyboard.type('New paragraph')

    const blocks = await editorHelpers.getAllBlocks()
    const imageIndex = blocks.findIndex((block: any) => block.type === 'image')
    expect(blocks[imageIndex].content).toEqual([{type: 'text', text: 'Trailing caption', styles: {}}])
    expect(blocks[imageIndex + 1].type).toBe('paragraph')
    expect(blocks[imageIndex + 1].content).toEqual([{type: 'text', text: 'New paragraph', styles: {}}])
  })

  test('selects the next block as a node on Enter when it has no text to hold a cursor', async ({
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
              name: 'caption-before-file.gif',
              alt: 'Caption before file image',
            },
            content: [],
          },
          {
            type: 'file',
            props: {url: 'ipfs://bafyfile', name: 'attachment.pdf', size: '1024'},
            content: [],
          },
        ],
        firstBlock.id,
        'after',
      )
    })

    const errors: string[] = []
    page.on('pageerror', (error: Error) => errors.push(error.message))

    const blocksBefore = await editorHelpers.getAllBlocks()

    const caption = page.locator('.image-caption').first()
    await expect(caption).toBeVisible()
    await caption.click()
    await page.keyboard.type('Caption before a file')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)

    const selection = await page.evaluate(() => {
      const view = (window.TEST_EDITOR?.editor as any)?._tiptapEditor?.view
      const {selection: sel} = view.state
      return {isNodeSelection: Boolean((sel as any).node), nodeType: (sel as any).node?.type?.name ?? null}
    })
    expect(selection.isNodeSelection).toBe(true)
    expect(selection.nodeType).toBe('file')
    expect(errors).toEqual([])

    const blocksAfter = await editorHelpers.getAllBlocks()
    expect(blocksAfter.length).toBe(blocksBefore.length)
    const imageIndex = blocksAfter.findIndex((block: any) => block.type === 'image')
    expect(blocksAfter[imageIndex].content).toEqual([{type: 'text', text: 'Caption before a file', styles: {}}])
    expect(blocksAfter[imageIndex + 1].type).toBe('file')
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

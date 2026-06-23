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

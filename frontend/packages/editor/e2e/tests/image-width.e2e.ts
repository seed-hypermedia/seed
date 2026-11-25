import {expect, test, type Locator, type Page} from '@playwright/test'

const imageWidths = ['70.36%', '36.23%', '320', '']

async function loadImages(page: Page, edit: boolean) {
  await page.setViewportSize({width: 1280, height: 800})
  await page.goto(`/?fixture=empty${edit ? '&edit=1' : ''}`)
  await page.waitForFunction(() => !!window.TEST_EDITOR?.editor)
  await page.evaluate(
    ({widths, edit}) => {
      const editor = window.TEST_EDITOR!.editor!
      const url = `data:image/svg+xml,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160"><rect width="640" height="160" fill="#b6d5db"/><circle cx="320" cy="80" r="48" fill="#3c7580"/></svg>',
      )}`
      editor.replaceBlocks(
        editor.topLevelBlocks,
        widths.map((width, index) => ({
          id: `image-width-${index}`,
          type: 'image',
          props: {url, width, name: `Image width ${width || '100%'}`},
          content: [{type: 'text', text: `Saved width: ${width || '100%'}`, styles: {}}],
        })),
      )
      editor.isEditable = edit
    },
    {widths: imageWidths, edit},
  )
  await expect(page.locator('[data-content-type="image"] img')).toHaveCount(imageWidths.length)
}

async function expectWidth(frame: Locator, savedWidth: string) {
  const expectedStyle = savedWidth.endsWith('%') ? savedWidth : savedWidth ? `${savedWidth}px` : '100%'
  await expect(frame).toHaveCSS('width', /px$/)
  const size = await frame.evaluate((element) => ({
    style: (element as HTMLElement).style.width,
    actual: element.getBoundingClientRect().width,
    available: element.parentElement!.clientWidth,
  }))
  expect(size.style).toBe(expectedStyle)
  const expected = savedWidth.endsWith('%')
    ? (parseFloat(savedWidth) / 100) * size.available
    : savedWidth
      ? Math.min(Number(savedWidth), size.available)
      : size.available
  expect(Math.abs(size.actual - expected)).toBeLessThan(1)
}

for (const edit of [false, true]) {
  test(`image widths stay correct while scrolling and changing viewport in ${
    edit ? 'editing' : 'reading'
  } mode`, async ({page}, testInfo) => {
    await loadImages(page, edit)

    for (const viewportWidth of [1280, 640, 390, 1280]) {
      await page.setViewportSize({width: viewportWidth, height: 800})
      // Both directions make images pass under the pointer, triggering hover
      // renders with the latest layout after the viewport has changed.
      for (const index of [0, 1, 2, 3, 2, 1, 0]) {
        const frame = page.locator(`[data-id="image-width-${index}"] .image`)
        await frame.scrollIntoViewIfNeeded()
        await frame.locator('img').hover()
        await expectWidth(frame, imageWidths[index]!)
      }
    }
    await page.screenshot({path: testInfo.outputPath('image-widths.png')})
    expect(
      await page.evaluate(() => window.TEST_EDITOR!.editor!.topLevelBlocks.slice(0, 4).map((b) => b.props.width)),
    ).toEqual(imageWidths)
  })
}

test('resizing uses the current layout and remains stable after release and undo', async ({page}) => {
  await loadImages(page, true)
  await page.setViewportSize({width: 640, height: 800})
  const frame = page.locator('[data-id="image-width-0"] .image')
  await frame.locator('img').hover()
  const before = await frame.boundingBox()
  expect(before).not.toBeNull()
  const handle = frame.locator('.cursor-col-resize').last()
  const handleBox = await handle.boundingBox()
  expect(handleBox).not.toBeNull()
  const x = handleBox!.x + handleBox!.width / 2
  const y = handleBox!.y + handleBox!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 30, y, {steps: 5})
  await page.mouse.up()

  const savedWidth = await page.evaluate(() => window.TEST_EDITOR!.editor!.getBlock('image-width-0')!.props.width!)
  expect(savedWidth).toMatch(/%$/)
  await expectWidth(frame, savedWidth)
  expect(Math.abs((await frame.boundingBox())!.width - (before!.width - 60))).toBeLessThan(1)
  await page.mouse.move(0, 0)
  await frame.locator('img').hover()
  await expectWidth(frame, savedWidth)

  await page.evaluate(() => window.TEST_EDITOR!.editor!._tiptapEditor.commands.undo())
  await expectWidth(frame, imageWidths[0]!)
})

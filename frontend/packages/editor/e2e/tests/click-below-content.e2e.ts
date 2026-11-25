import {expect, test, type Page} from '@playwright/test'

declare global {
  interface Window {
    TEST_MACHINE: any
  }
}

async function setup(page: Page) {
  await page.goto('/?fixture=longText&real=1')
  await page.waitForFunction(() => !!window.TEST_EDITOR && !!window.TEST_MACHINE, {timeout: 15000})
}

async function scrollToBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const pre = await page.evaluate(() => ({
    scrollY: window.scrollY,
    scrollable: document.documentElement.scrollHeight > window.innerHeight,
  }))
  expect(pre.scrollable).toBe(true)
  expect(pre.scrollY).toBeGreaterThan(0)
  return pre.scrollY
}

async function visibleButtonPoint(page: Page, yOffset?: number) {
  const box = await page.locator('button[aria-label="Focus editor at end"]').boundingBox()
  if (!box) throw new Error('focus-at-end button not found')
  const viewport = page.viewportSize()!
  const visibleTop = Math.max(box.y, 0)
  const visibleBottom = Math.min(box.y + box.height, viewport.height)
  expect(visibleBottom - visibleTop).toBeGreaterThan(40)
  return {
    x: box.x + box.width / 2,
    y: yOffset !== undefined ? visibleTop + yOffset : visibleTop + (visibleBottom - visibleTop) / 2,
  }
}

async function expectCursorAtEnd(page: Page) {
  await expect.poll(() => page.evaluate(() => window.TEST_MACHINE.matches('editing'))).toBe(true)
  const state = await page.evaluate(() => {
    const editor = window.TEST_EDITOR.editor!
    return {
      hasFocus: editor._tiptapEditor.view.hasFocus(),
      selectionEmpty: editor._tiptapEditor.state.selection.empty,
      cursorBlockId: editor.getTextCursorPosition().block.id,
      lastBlockId: editor.topLevelBlocks.at(-1)!.id,
    }
  })
  expect(state.hasFocus).toBe(true)
  expect(state.selectionEmpty).toBe(true)
  expect(state.cursorBlockId).toBe(state.lastBlockId)
}

test.describe('mobile: tapping below the content', () => {
  test.use({hasTouch: true, isMobile: true, viewport: {width: 390, height: 844}})

  test('a swipe that starts below the content scrolls without entering edit mode', async ({page}) => {
    await setup(page)
    const scrollYBefore = await scrollToBottom(page)
    const start = await visibleButtonPoint(page, 50)

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{x: start.x, y: start.y}],
    })
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{x: start.x, y: start.y + (300 * i) / 10}],
      })
    }
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []})

    const editingAfterFrames = await page.evaluate(
      () =>
        new Promise<boolean>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.TEST_MACHINE.matches('editing')))),
        ),
    )
    expect(editingAfterFrames).toBe(false)

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(scrollYBefore)

    const after = await page.evaluate(() => ({
      editing: window.TEST_MACHINE.matches('editing'),
      activeInPM: !!document.activeElement?.closest('.ProseMirror[contenteditable="true"]'),
    }))
    expect(after.editing).toBe(false)
    expect(after.activeInPM).toBe(false)
  })

  test('a tap below the content enters edit mode with the cursor at the end', async ({page}) => {
    await setup(page)
    await scrollToBottom(page)
    const point = await visibleButtonPoint(page)
    await page.touchscreen.tap(point.x, point.y)
    await expectCursorAtEnd(page)
  })
})

test('a mouse click below the content enters edit mode with the cursor at the end', async ({page}) => {
  await setup(page)
  await scrollToBottom(page)
  const point = await visibleButtonPoint(page)
  await page.mouse.click(point.x, point.y)
  await expectCursorAtEnd(page)
})

import {expect, test, type Page} from '@playwright/test'

async function setupRealEditor(page: Page, fixture: string) {
  await page.goto(`/?fixture=${fixture}&real=1`)
  await page.waitForFunction(() => !!window.TEST_EDITOR && !!(window as any).TEST_MACHINE, {timeout: 15000})
  await page.waitForTimeout(400)
  await page.evaluate(() => (window as any).TEST_MACHINE.send({type: 'edit.start'}))
  await page.waitForTimeout(300)
}

/** Window rectangles of the top-level blocks, in document order. */
function blockRects(page: Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll('.ProseMirror > [data-node-type="blockChildren"] > [data-node-type="blockNode"]'),
    ].map((block) => block.getBoundingClientRect().toJSON() as DOMRect),
  )
}

/** Clicks the middle of the space between top-level blocks `index` and `index + 1`. */
async function clickBetweenBlocks(page: Page, index: number) {
  const rects = await blockRects(page)
  const above = rects[index]!
  const below = rects[index + 1]!
  await page.mouse.click(above.left + above.width / 2, (above.bottom + below.top) / 2)
  await page.waitForTimeout(250)
}

/** Window rectangle of the block with id. */
function blockRect(page: Page, id: string) {
  return page.evaluate(
    (id) => document.querySelector(`[data-node-type="blockNode"][data-id="${id}"]`)!.getBoundingClientRect().toJSON(),
    id,
  ) as Promise<DOMRect>
}

/** Window rectangle of the content of block with id, without its nested blocks. */
function blockContentRect(page: Page, id: string) {
  return page.evaluate(
    (id) =>
      document
        .querySelector(`[data-node-type="blockNode"][data-id="${id}"]`)!
        .firstElementChild!.getBoundingClientRect()
        .toJSON(),
    id,
  ) as Promise<DOMRect>
}

/** Replaces the document with blocks. */
async function setBlocks(page: Page, blocks: unknown[]) {
  await page.evaluate((blocks) => {
    const editor = window.TEST_EDITOR.editor!
    editor.replaceBlocks(editor.topLevelBlocks, blocks as any)
  }, blocks)
  await page.waitForTimeout(300)
}

/** An embed card block, with children nested under it as a numbered list. */
function card(id: string, children: unknown[] = []) {
  const props = {url: 'hm://bafy-doc-uid/Root', view: 'Card', ...(children.length ? {childrenType: 'Ordered'} : {})}
  return {id, type: 'embed', props, children}
}

/** Expects the gap cursor line, drawn on block `belowId`, to sit in the middle of the gap under `above`. */
async function expectLineCentredInGap(page: Page, above: DOMRect, belowId: string) {
  const below = await blockRect(page, belowId)
  const line = await page.evaluate((id) => {
    const style = getComputedStyle(document.querySelector(`[data-node-type="blockNode"][data-id="${id}"]`)!, '::after')
    return {top: parseFloat(style.top), height: parseFloat(style.height)}
  }, belowId)
  const lineTop = below.top + line.top
  expect(lineTop).toBeGreaterThan(above.bottom)
  expect(lineTop + line.height).toBeLessThan(below.top)
  expect(Math.abs(lineTop + line.height / 2 - (above.bottom + below.top) / 2)).toBeLessThan(1)
}

function selectionType(page: Page) {
  return page.evaluate(() => window.TEST_EDITOR.editor!._tiptapEditor.state.selection.toJSON().type as string)
}

function blockOutline(page: Page) {
  return page.evaluate(() =>
    window.TEST_EDITOR.getBlocks().map((block: any) => {
      const text = (block.content ?? []).map((inline: any) => inline.text ?? '').join('')
      return `${block.type}:${text}`
    }),
  )
}

test.describe('Gap cursor between cards', () => {
  test('a click between two cards places a gap cursor without moving them', async ({page}) => {
    await setupRealEditor(page, 'withTwoEmbeds')
    const before = await blockRects(page)

    await clickBetweenBlocks(page, 1)

    expect(await selectionType(page)).toBe('gapcursor')
    // The line is drawn on the card below the gap, not as an element between the cards.
    await expect(page.locator('[data-gap-cursor="before"]')).toHaveAttribute('data-id', 'embed-2')
    expect(await blockRects(page)).toEqual(before)
    await expectLineCentredInGap(page, await blockRect(page, 'embed-1'), 'embed-2')
  })

  test('cards in a numbered list keep the normal block gap, with the line in its middle', async ({page}) => {
    await setupRealEditor(page, 'withTwoEmbeds')
    await setBlocks(page, [
      {
        id: 'list',
        type: 'paragraph',
        content: 'Steps',
        props: {childrenType: 'Ordered'},
        children: [card('card-1'), card('card-2')],
      },
    ])
    const above = await blockRect(page, 'card-1')
    const below = await blockRect(page, 'card-2')

    await page.mouse.click(above.left + above.width / 2, (above.bottom + below.top) / 2)
    await page.waitForTimeout(250)

    // List items are otherwise 0.25rem apart, too little to click between.
    expect(below.top - above.bottom).toBeCloseTo(12, 0)
    expect(await selectionType(page)).toBe('gapcursor')
    await expectLineCentredInGap(page, above, 'card-2')
  })

  // Inside a numbered list, the space above a nested card belongs to its parent card's block, so the click resolves
  // inside that block; at the top level it belongs to the nested list.
  for (const inList of [false, true]) {
    test(`a click between a card and its nested card starts the nested list there${
      inList ? ', in a list' : ''
    }`, async ({page}) => {
      await setupRealEditor(page, 'withTwoEmbeds')
      const cards = [card('parent', [card('child')]), card('next')]
      await setBlocks(
        page,
        inList
          ? [{id: 'list', type: 'paragraph', content: 'List', props: {childrenType: 'Ordered'}, children: cards}]
          : cards,
      )
      const parent = await blockContentRect(page, 'parent')
      const child = await blockRect(page, 'child')
      expect(child.top - parent.bottom).toBeCloseTo(12, 0)

      await page.mouse.click(child.left + child.width / 2, (parent.bottom + child.top) / 2)
      await page.waitForTimeout(250)

      expect(await selectionType(page)).toBe('gapcursor')
      await expect(page.locator('[data-gap-cursor="before"]')).toHaveAttribute('data-id', 'child')
      await expectLineCentredInGap(page, parent, 'child')

      await page.keyboard.type('First item')
      await page.waitForTimeout(200)
      const nested = await page.evaluate(() => {
        const findParent = (blocks: any[]): any =>
          blocks.find((block) => block.id === 'parent') ?? findParent(blocks.flatMap((block) => block.children))
        return findParent(window.TEST_EDITOR.getBlocks()).children.map(
          (block: any) => `${block.type}:${block.content.map((inline: any) => inline.text).join('')}`,
        )
      })
      expect(nested).toEqual(['paragraph:First item', 'embed:'])
    })
  }

  test('typing at the gap cursor writes a new paragraph between the cards', async ({page}) => {
    await setupRealEditor(page, 'withTwoEmbeds')
    await clickBetweenBlocks(page, 1)

    await page.keyboard.type('Between')
    await page.waitForTimeout(200)

    expect((await blockOutline(page)).slice(0, 5)).toEqual([
      'paragraph:Above the cards',
      'embed:',
      'paragraph:Between',
      'embed:',
      'paragraph:Below the cards',
    ])
    const ids = await page.evaluate(() => window.TEST_EDITOR.getBlocks().map((block: any) => block.id))
    expect(ids[2]).toBeTruthy()
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('Enter at the gap cursor starts an empty paragraph between the cards', async ({page}) => {
    await setupRealEditor(page, 'withTwoEmbeds')
    await clickBetweenBlocks(page, 1)

    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    expect((await blockOutline(page)).slice(0, 4)).toEqual([
      'paragraph:Above the cards',
      'embed:',
      'paragraph:',
      'embed:',
    ])
    expect(await selectionType(page)).toBe('text')

    await page.keyboard.type('Typed after Enter')
    await page.waitForTimeout(200)
    expect((await blockOutline(page))[2]).toBe('paragraph:Typed after Enter')
  })

  // One click per test: a second click on the same spot within 500ms would count as a double-click.
  for (const [key, blockId] of [
    ['ArrowDown', 'embed-2'],
    ['ArrowRight', 'embed-2'],
    ['ArrowUp', 'embed-1'],
    ['ArrowLeft', 'embed-1'],
  ]) {
    test(`${key} from the gap selects the card on that side without adding blocks`, async ({page}) => {
      await setupRealEditor(page, 'withTwoEmbeds')
      const blocks = await blockOutline(page)
      await clickBetweenBlocks(page, 1)

      await page.keyboard.press(key!)
      await page.waitForTimeout(200)
      expect(await page.evaluate(() => window.TEST_EDITOR.pmSelection())).toMatchObject({
        kind: 'NodeSelection',
        blockId,
      })
      expect(await blockOutline(page)).toEqual(blocks)
    })
  }

  for (const [key, selected, gapAbove] of [
    ['ArrowRight', 'embed-1', 'embed-2'],
    ['ArrowLeft', 'embed-2', 'embed-2'],
  ]) {
    test(`${key} from a selected card stops in the gap on that side`, async ({page}) => {
      await setupRealEditor(page, 'withTwoEmbeds')
      // Select the card by clicking its left padding, away from its title link.
      const card = await blockRect(page, selected!)
      await page.mouse.click(card.left + 8, card.top + card.height / 2)
      await page.waitForTimeout(250)
      expect(await page.evaluate(() => window.TEST_EDITOR.pmSelection())).toMatchObject({blockId: selected})

      await page.keyboard.press(key!)
      await page.waitForTimeout(200)
      expect(await selectionType(page)).toBe('gapcursor')
      await expect(page.locator('[data-gap-cursor="before"]')).toHaveAttribute('data-id', gapAbove!)
    })
  }

  test('ArrowLeft from a card below a paragraph has no gap to stop in', async ({page}) => {
    await setupRealEditor(page, 'withTwoEmbeds')
    const card = await blockRect(page, 'embed-1')
    await page.mouse.click(card.left + 8, card.top + card.height / 2)
    await page.waitForTimeout(250)

    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(200)
    expect(await selectionType(page)).not.toBe('gapcursor')
  })

  test('a click between a paragraph and a card still places a text cursor', async ({page}) => {
    await setupRealEditor(page, 'withTwoEmbeds')
    await clickBetweenBlocks(page, 0)

    expect(await selectionType(page)).toBe('text')
    await expect(page.locator('[data-gap-cursor]')).toHaveCount(0)
  })
})

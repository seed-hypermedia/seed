import {expect, test, type Page} from '@playwright/test'

/**
 * Cross-block-type selection consistency, verified against the REAL
 * DocumentEditor + document machine (harness `?real=1&fixture=allBlocks`).
 *
 * Eric's spec (#857 follow-on): for EVERY selectable block type,
 *  1. the FIRST click on the block body selects it: blue outline + block
 *     tools (the copy-link/comment card) + side menu, in one click;
 *  2. ArrowUp/ArrowDown move the selection between blocks;
 *  3. the block tools are visible whenever the block is selected;
 *  4. everything derives from ONE selection source, so all indicators agree.
 *
 * The block tools here are the real BlockHoverActionsPositioner — the harness
 * mounts it through DocumentEditor exactly like desktop does.
 */

declare global {
  interface Window {
    TEST_MACHINE: any
    TEST_BLOCK_TOOL_CALLS: {copyLink: any[]; comment: any[]}
  }
}

/** All selectable blocks in the allBlocks fixture, in document order. */
const SELECTABLE = [
  {id: 'blk-image', type: 'image'},
  {id: 'blk-video', type: 'video'},
  {id: 'blk-file', type: 'file'},
  {id: 'blk-embed', type: 'embed'},
  {id: 'blk-draft', type: 'embed (draft)'},
  {id: 'blk-web', type: 'web-embed'},
  {id: 'blk-button', type: 'button'},
  {id: 'blk-math', type: 'math'},
  {id: 'blk-query', type: 'query'},
] as const

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const T = window.TEST_EDITOR
    const sideMenu = document.querySelector('.side-menu') as HTMLElement | null
    const sideMenuBox = sideMenu?.getBoundingClientRect()
    const toolsCard = document.querySelector('[data-bn-block-hover-actions="true"]') as HTMLElement | null
    const toolsBox = toolsCard?.getBoundingClientRect()
    return {
      pm: T.pmSelection(),
      fullBlockIds: T.fullBlockIds(),
      outlined: T.outlinedBlockIds(),
      sideMenuBlock: T.blockToolsBlockId(),
      sideMenuVisible: !!sideMenuBox && sideMenuBox.width > 0 && sideMenuBox.height > 0 && sideMenuBox.y > -50,
      tools: T.hoverActionsBlockId(),
      toolsTop: toolsBox?.top ?? null,
      copyLinkCalls: window.TEST_BLOCK_TOOL_CALLS?.copyLink.length ?? 0,
      commentCalls: window.TEST_BLOCK_TOOL_CALLS?.comment.length ?? 0,
    }
  })
}

async function setupAllBlocks(page: Page, opts: {published?: 'all' | 'none'} = {}) {
  const params = new URLSearchParams({fixture: 'allBlocks', real: '1'})
  if (opts.published) params.set('published', opts.published)
  await page.goto(`/?${params}`)
  await page.waitForFunction(() => !!window.TEST_EDITOR && !!window.TEST_MACHINE, {timeout: 15000})
  await page.waitForTimeout(400)
  await page.evaluate(() => window.TEST_MACHINE.send({type: 'edit.start'}))
  await page.waitForTimeout(300)
}

async function clickBlockBody(page: Page, blockId: string) {
  const content = page.locator(`[data-id="${blockId}"] [data-content-type]`).first()
  // Retry the scroll+measure: KaTeX/media blocks can re-layout while
  // Playwright polls for a stable box under CPU contention.
  let box: {x: number; y: number; width: number; height: number} | null = null
  for (let attempt = 0; attempt < 3 && !box; attempt++) {
    try {
      await content.scrollIntoViewIfNeeded({timeout: 5000})
      await page.waitForTimeout(100)
      box = await content.boundingBox({timeout: 5000})
    } catch {
      await page.waitForTimeout(300)
    }
  }
  if (!box) throw new Error(`could not measure block ${blockId}`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(250)
}

test.describe('Block selection consistency across block types (real editor)', () => {
  for (const {id, type} of SELECTABLE) {
    test(`first click selects ${type} (${id}): outline + block tools + side menu agree`, async ({page}) => {
      await setupAllBlocks(page)
      // Park the mouse away first so nothing is hover-revealed.
      await page.mouse.move(5, 5)
      await clickBlockBody(page, id)

      const s = await snapshot(page)
      expect(s.fullBlockIds, 'selection source must report exactly this block').toEqual([id])
      expect(s.pm.kind).toBe('NodeSelection')
      expect(s.outlined, 'blue outline must show on first click').toEqual([id])
      expect(s.tools, 'block tools (copy link / comment) must show for the selected block').toBe(id)
      expect(s.sideMenuBlock, 'side menu must anchor to the selected block').toBe(id)
      expect(s.sideMenuVisible).toBe(true)
    })
  }

  test('arrow keys walk the selection through every selectable block, all indicators following', async ({page}) => {
    await setupAllBlocks(page)
    // Start with a cursor in the first paragraph.
    await page.locator('p:has-text("First paragraph")').first().click()
    await page.waitForTimeout(150)

    const visited: string[] = []
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(150)
      const s = await snapshot(page)
      if (s.fullBlockIds.length === 1) {
        const id = s.fullBlockIds[0]!
        if (visited.at(-1) !== id) {
          visited.push(id)
          // Every selected block shows outline + tools + side menu, in sync.
          expect(s.outlined, `outline for ${id}`).toEqual([id])
          expect(s.tools, `block tools for ${id}`).toBe(id)
          expect(s.sideMenuBlock, `side menu for ${id}`).toBe(id)
        }
      }
      // Stop once the cursor reaches the last paragraph.
      if (s.fullBlockIds.length === 0 && s.pm.blockId === 'p-bottom') break
    }

    expect(visited).toEqual(SELECTABLE.map((b) => b.id))

    // And back up: ArrowUp re-selects the last selectable block.
    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(150)
    const s = await snapshot(page)
    expect(s.fullBlockIds).toEqual(['blk-query'])
    expect(s.tools).toBe('blk-query')
  })

  test('a text-block cursor shows block tools without any outline', async ({page}) => {
    await setupAllBlocks(page)
    await page.locator('p:has-text("First paragraph")').first().click()
    await page.waitForTimeout(250)

    const s = await snapshot(page)
    expect(s.fullBlockIds).toEqual([])
    expect(s.outlined).toEqual([])
    expect(s.tools, 'block tools follow the text cursor').toBe('p-top')
  })

  test('Backspace deletes each selectable block type when selected', async ({page}) => {
    await setupAllBlocks(page)
    for (const {id} of SELECTABLE) {
      await page.mouse.move(5, 5)
      await clickBlockBody(page, id)
      const s = await snapshot(page)
      expect(s.fullBlockIds, `${id} must be selected before Backspace`).toEqual([id])
      await page.keyboard.press('Backspace')
      await page.waitForTimeout(200)
      const stillThere = await page.evaluate(
        (blockId) => window.TEST_EDITOR.getBlocks().some((b: any) => b.id === blockId),
        id,
      )
      expect(stillThere, `${id} must be deleted by Backspace`).toBe(false)
    }
  })

  test('Backspace at the start of a non-empty paragraph below a selectable block selects it without dropping text', async ({
    page,
  }) => {
    await setupAllBlocks(page)
    // Insert a paragraph with text directly below a selectable block, then put
    // the caret at its very start (setTextCursorPosition is reliable in headless
    // Chromium, unlike pressing Home).
    const newBlockId: string = await page.evaluate(() => {
      const ed = window.TEST_EDITOR.editor
      if (!ed) throw new Error('TEST_EDITOR.editor not found')
      const inserted = ed.insertBlocks(
        [{type: 'paragraph', content: [{type: 'text', text: 'keep this text', styles: {}}]}],
        'blk-button',
        'after',
      )
      return inserted[0]!.id
    })
    await page.waitForTimeout(150)
    await page.evaluate((id) => {
      const ed = window.TEST_EDITOR.editor
      if (!ed) throw new Error('TEST_EDITOR.editor not found')
      ed.setTextCursorPosition(id, 'start')
      ed.focus()
    }, newBlockId)
    await page.waitForTimeout(120)

    await page.keyboard.press('Backspace')
    await page.waitForTimeout(200)

    // The paragraph text must survive: Backspace should select the block above,
    // not merge/delete the paragraph's content into the block's invisible
    // inline content.
    const paragraphKept = await page.evaluate(
      (id) =>
        window.TEST_EDITOR.getBlocks().some(
          (b: any) => b.id === id && (b.content || []).some((c: any) => c.text === 'keep this text'),
        ),
      newBlockId,
    )
    expect(paragraphKept, 'paragraph text must be preserved').toBe(true)

    // And the selectable block above must now be NodeSelected.
    const s = await snapshot(page)
    expect(s.pm.kind, 'block above must be node-selected').toBe('NodeSelection')
    expect(s.fullBlockIds).toEqual(['blk-button'])
  })

  test('scrolling repositions the block tools instead of hiding them', async ({page}) => {
    await setupAllBlocks(page)
    await page.mouse.move(5, 5)
    await clickBlockBody(page, 'blk-image')

    let s = await snapshot(page)
    expect(s.tools).toBe('blk-image')
    const topBefore = s.toolsTop!

    await page.evaluate(() => window.scrollBy(0, 120))
    await page.waitForTimeout(300)

    s = await snapshot(page)
    expect(s.tools, 'block tools must stay visible through a scroll').toBe('blk-image')
    expect(s.sideMenuBlock, 'side menu must stay visible through a scroll').toBe('blk-image')
    expect(Math.abs(s.toolsTop! - (topBefore - 120)), 'block tools must follow the block').toBeLessThan(30)
  })

  test('focusing the draft card title selects the card without opening the draft', async ({page}) => {
    await setupAllBlocks(page)
    const draftInput = page.locator('[data-id="blk-draft"] input').first()
    await draftInput.scrollIntoViewIfNeeded()
    await draftInput.click()
    await page.waitForTimeout(250)

    const s = await page.evaluate(() => ({
      full: window.TEST_EDITOR.fullBlockIds(),
      activeTag: document.activeElement?.tagName,
      draftOpens: (window as any).TEST_DRAFT_CALLS?.onOpenDraft.length ?? 0,
    }))
    expect(s.full, 'editing the title means the card is selected').toEqual(['blk-draft'])
    expect(s.activeTag, 'focus must stay in the title input').toBe('INPUT')
    expect(s.draftOpens).toBe(0)
  })

  test('a single click on a paragraph blurs the focused draft title and places the caret', async ({page}) => {
    await setupAllBlocks(page)
    const draftInput = page.locator('[data-id="blk-draft"] input').first()
    await draftInput.scrollIntoViewIfNeeded()
    await draftInput.click()
    await page.waitForTimeout(250)

    const p = page.locator('p:has-text("Last paragraph")').first()
    await p.scrollIntoViewIfNeeded()
    await page.waitForTimeout(100)
    await p.click()
    await page.waitForTimeout(300)

    const s = await snapshot(page)
    expect(s.pm.kind, 'ONE click must move the caret out of the title input').toBe('TextSelection(empty)')
    expect(s.pm.blockId).toBe('p-bottom')
    expect(s.fullBlockIds, 'the draft card must be deselected').toEqual([])
  })

  test('published card title is a link that navigates on first click without selecting', async ({page}) => {
    await setupAllBlocks(page)
    const titleLink = page.locator('[data-id="blk-embed"] a').first()
    await expect(titleLink).toHaveClass(/hover:underline/)
    await titleLink.scrollIntoViewIfNeeded()
    await titleLink.click()
    await page.waitForTimeout(250)

    const s = await page.evaluate(() => ({
      routes: ((window as any).TEST_OPEN_ROUTE ?? []).length,
      full: window.TEST_EDITOR.fullBlockIds(),
    }))
    expect(s.routes, 'title click must navigate immediately').toBe(1)
    expect(s.full, 'title click must not select the card').toEqual([])
  })

  test('copy-link action fires for a published block', async ({page}) => {
    await setupAllBlocks(page)
    await page.mouse.move(5, 5)
    await clickBlockBody(page, 'blk-image')

    await page.locator('[aria-label="Copy block link"]').click()
    await page.waitForTimeout(150)

    const calls = await page.evaluate(() => window.TEST_BLOCK_TOOL_CALLS.copyLink)
    expect(calls.length).toBe(1)
    expect(calls[0].blockId).toBe('blk-image')
    await expect(page.locator('[data-testid="publish-required-dialog"]')).toHaveCount(0)
  })

  test('unpublished blocks still show block tools; actions open the publish-required dialog', async ({page}) => {
    await setupAllBlocks(page, {published: 'none'})
    await page.mouse.move(5, 5)
    await clickBlockBody(page, 'blk-image')

    const s = await snapshot(page)
    expect(s.tools, 'block tools must be visible even for draft-only blocks').toBe('blk-image')

    await page.locator('[aria-label="Copy block link"]').click()
    await page.waitForTimeout(200)

    await expect(page.locator('[data-testid="publish-required-dialog"]')).toBeVisible()
    const calls = await page.evaluate(() => window.TEST_BLOCK_TOOL_CALLS.copyLink)
    expect(calls.length, 'the raw action must be intercepted').toBe(0)
  })
})

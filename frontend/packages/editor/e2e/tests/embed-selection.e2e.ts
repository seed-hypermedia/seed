import {expect, test, type Page} from '@playwright/test'

/**
 * Embed-card selection UX, verified against the REAL DocumentEditor driven by
 * the REAL document machine (harness `?real=1`), with the issue-857 document
 * shape: an unpublished draft card directly above a published card.
 *
 * These tests assert that ALL selection indicators — the ProseMirror selection,
 * the blue outline (.bn-media-selected), the side-menu block tools, and the
 * embed action strip — agree, because they all derive from the single
 * FullBlockSelection plugin state.
 */

// window.TEST_EDITOR is declared by the harness (test-app/TestEditor.tsx).
declare global {
  interface Window {
    TEST_MACHINE: any
    TEST_DRAFT_CALLS: {onOpenDraft: any[]; onDeleteDraft: any[]}
    TEST_OPEN_URL?: any[]
  }
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const T = window.TEST_EDITOR
    const sideMenu = document.querySelector('.side-menu') as HTMLElement | null
    const sideMenuBox = sideMenu?.getBoundingClientRect()
    return {
      pm: T.pmSelection(),
      blockTools: T.blockToolsBlockId(),
      fullBlockIds: T.fullBlockIds(),
      outline: document.querySelectorAll('.bn-media-selected').length,
      sideMenuVisible: !!sideMenuBox && sideMenuBox.width > 0 && sideMenuBox.height > 0 && sideMenuBox.y > -50,
      openDraftCalls: window.TEST_DRAFT_CALLS?.onOpenDraft.length ?? 0,
      openUrlCalls: window.TEST_OPEN_URL?.length ?? 0,
    }
  })
}

async function setupRealEditor(page: Page, opts: {fixture?: string; cursor?: number; startEditing?: boolean} = {}) {
  const {fixture = 'draftAndPublished', cursor, startEditing = true} = opts
  const params = new URLSearchParams({fixture, real: '1'})
  if (cursor != null) params.set('cursor', String(cursor))
  await page.goto(`/?${params}`)
  await page.waitForFunction(() => !!window.TEST_EDITOR && !!window.TEST_MACHINE, {timeout: 15000})
  await page.waitForTimeout(400)
  if (startEditing) {
    await page.evaluate(() => window.TEST_MACHINE.send({type: 'edit.start'}))
    await page.waitForTimeout(300)
  }
}

async function clickEmbedBody(page: Page, blockIndex: 0 | 1) {
  // blockIndex 0 = draft card, 1 = published card (fixture order).
  const el = page.locator('[data-content-type="embed"]').nth(blockIndex === 0 ? 0 : 1)
  const box = (await el.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(250)
}

test.describe('Embed card selection (real DocumentEditor + machine)', () => {
  test('single click on the published card selects it with all indicators, no navigation', async ({page}) => {
    await setupRealEditor(page)
    await clickEmbedBody(page, 1)

    const s = await snapshot(page)
    expect(s.pm.kind).toBe('NodeSelection')
    expect(s.pm.blockId).toBe('embed-pub')
    expect(s.outline, 'blue outline must show on first click').toBe(1)
    expect(s.blockTools, 'block tools must show for the selected card').toBe('embed-pub')
    expect(s.fullBlockIds).toEqual(['embed-pub'])
    expect(s.sideMenuVisible, 'block tools must be visibly positioned').toBe(true)
    expect(s.openUrlCalls, 'first click must not navigate').toBe(0)
  })

  test('second click on the selected published card navigates', async ({page}) => {
    await setupRealEditor(page)
    await clickEmbedBody(page, 1)
    await clickEmbedBody(page, 1)

    const s = await snapshot(page)
    expect(s.openUrlCalls, 'click on an already-selected card opens it').toBe(1)
  })

  test('single click on the draft card selects it and does NOT open the draft', async ({page}) => {
    await setupRealEditor(page)
    await clickEmbedBody(page, 0)

    const s = await snapshot(page)
    expect(s.pm.kind).toBe('NodeSelection')
    expect(s.pm.blockId).toBe('embed-draft')
    expect(s.outline).toBe(1)
    expect(s.blockTools).toBe('embed-draft')
    expect(s.openDraftCalls, 'first click must select, not open the draft').toBe(0)
  })

  test('second click on the selected draft card opens the draft', async ({page}) => {
    await setupRealEditor(page)
    await clickEmbedBody(page, 0)
    await clickEmbedBody(page, 0)

    const s = await snapshot(page)
    expect(s.openDraftCalls).toBe(1)
  })

  test('arrow keys move the selection between the two adjacent cards, all indicators agreeing', async ({page}) => {
    await setupRealEditor(page)
    await clickEmbedBody(page, 0)

    let s = await snapshot(page)
    expect(s.pm.blockId).toBe('embed-draft')

    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(200)
    s = await snapshot(page)
    expect(s.pm.kind).toBe('NodeSelection')
    expect(s.pm.blockId).toBe('embed-pub')
    expect(s.blockTools).toBe('embed-pub')
    expect(s.outline).toBe(1)

    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(200)
    s = await snapshot(page)
    expect(s.pm.kind).toBe('NodeSelection')
    expect(s.pm.blockId).toBe('embed-draft')
    expect(s.blockTools).toBe('embed-draft')
    expect(s.outline).toBe(1)
  })

  test('ArrowUp from the paragraph below selects the published card', async ({page}) => {
    await setupRealEditor(page)
    await page.locator('p:has-text("Below the cards")').first().click()
    await page.keyboard.press('Home')
    await page.waitForTimeout(100)

    await page.keyboard.press('ArrowUp')
    await page.waitForTimeout(200)
    const s = await snapshot(page)
    expect(s.pm.kind).toBe('NodeSelection')
    expect(s.pm.blockId).toBe('embed-pub')
    expect(s.blockTools).toBe('embed-pub')
    expect(s.outline).toBe(1)
  })

  test('keyboard-only selection reveals the embed action strip without hover', async ({page}) => {
    await setupRealEditor(page)
    await page.locator('p:has-text("Below the cards")').first().click()
    await page.keyboard.press('Home')
    // Park the mouse away from the cards so hover cannot reveal anything.
    await page.mouse.move(5, 5)
    await page.waitForTimeout(100)

    await page.keyboard.press('ArrowUp') // selects published card
    await page.waitForTimeout(300)

    const s = await snapshot(page)
    expect(s.pm.blockId).toBe('embed-pub')
    // The floating "..." action bar for the selected card must be visible.
    const actionsOpacity = await page.evaluate(() => {
      const btn = document.querySelector('[aria-label="Subdocument options"]')
      const bar = btn?.closest('div[class*="absolute"]') as HTMLElement | null
      if (!bar) return null
      return getComputedStyle(bar).opacity
    })
    expect(actionsOpacity, 'embed action strip must be visible for keyboard selection').toBe('1')
  })

  test('Backspace deletes the selected card', async ({page}) => {
    await setupRealEditor(page)
    await clickEmbedBody(page, 1)

    await page.keyboard.press('Backspace')
    await page.waitForTimeout(250)
    const blocks = await page.evaluate(() => window.TEST_EDITOR.getBlocks().map((b: any) => ({id: b.id, type: b.type})))
    expect(blocks.find((b: any) => b.id === 'embed-pub')).toBeFalsy()
    expect(blocks.find((b: any) => b.id === 'embed-draft')).toBeTruthy()
  })

  test('clicking a card while in loaded mode enters editing and keeps the card selected (placeCursor must not clobber)', async ({
    page,
  }) => {
    // A saved draft cursor makes placeCursor dispatch a TextSelection + a rAF re-apply.
    await setupRealEditor(page, {cursor: 3, startEditing: false})

    const machineBefore = await page.evaluate(() => JSON.stringify(window.TEST_MACHINE.state()))
    expect(machineBefore).toBe('"loaded"')

    await clickEmbedBody(page, 1)
    // Wait a few frames so the placeCursor rAF re-apply has definitely run.
    await page.waitForTimeout(300)

    const s = await snapshot(page)
    const machineAfter = await page.evaluate(() => JSON.stringify(window.TEST_MACHINE.state()))
    expect(machineAfter).toContain('editing')
    expect(s.pm.kind, 'card selection must survive the edit-start cursor placement').toBe('NodeSelection')
    expect(s.pm.blockId).toBe('embed-pub')
    expect(s.outline).toBe(1)
  })
})

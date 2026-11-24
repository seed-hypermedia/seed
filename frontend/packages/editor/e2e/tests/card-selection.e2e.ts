import {expect, test} from './fixtures'

test.use({clipboardPermissions: false})

const fileCard = (name: string, children: unknown[] = []) => ({
  type: 'file',
  props: {url: 'ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy', name, size: '1000'},
  children,
})

/**
 * Root cards around a three-column grid held by an empty paragraph, then a card with two nested cards:
 * root-a, root-b, [grid-1, grid-2, grid-3], root-c, parent > [child-1, child-2].
 */
async function insertCards(page: any) {
  await page.evaluate(
    (blocks: any[]) => {
      const editor = window.TEST_EDITOR?.editor
      const firstBlock = editor?.topLevelBlocks?.[0]
      if (!editor || !firstBlock) throw new Error('Editor not ready')
      editor.insertBlocks(blocks, firstBlock.id, 'after')
    },
    [
      fileCard('root-a'),
      fileCard('root-b'),
      {
        type: 'paragraph',
        props: {childrenType: 'Grid', columnCount: '3'},
        content: '',
        children: ['grid-1', 'grid-2', 'grid-3'].map((name) => fileCard(name)),
      },
      fileCard('root-c'),
      fileCard('parent', [fileCard('child-1'), fileCard('child-2')]),
    ],
  )
  await expect(page.locator('[data-content-type="file"]')).toHaveCount(9)
}

const card = (page: any, name: string) =>
  page
    .locator('[data-content-type="file"]')
    .filter({has: page.getByText(name, {exact: true})})
    .first()

/** Names of the selected blocks, in document order: a card's file name, or the content type otherwise. */
async function selectedBlocks(page: any) {
  return page.evaluate(() => {
    const api = window.TEST_EDITOR
    const doc = api?.editor?._tiptapEditor.state.doc
    const name = (id: string) => {
      let found = id
      doc?.descendants((node: any) => {
        if (node.attrs?.id === id) found = node.firstChild.attrs.name || node.firstChild.type.name
        return found === id
      })
      return found
    }
    return {selected: (api?.fullBlockIds() ?? []).map(name), outlined: (api?.outlinedBlockIds() ?? []).map(name)}
  })
}

/** Expects these blocks to be selected and every card among them, and no other card, to show the outline. */
async function expectSelected(page: any, names: string[]) {
  const cards = names.filter((name) => name !== 'paragraph')
  await expect.poll(() => selectedBlocks(page)).toEqual({selected: names, outlined: cards})
}

/** The document's blocks as indented lines: a card's file name, or the content type otherwise. */
async function outline(page: any) {
  return page.evaluate(() => {
    const lines: string[] = []
    const walk = (blocks: any[], depth: number) =>
      blocks.forEach((block) => {
        lines.push(`${'  '.repeat(depth)}${block.props?.name || block.type}`)
        walk(block.children ?? [], depth + 1)
      })
    walk(window.TEST_EDITOR?.editor?.topLevelBlocks ?? [], 0)
    return lines
  })
}

/** Each grid in the document as its column count and the file names of its cards. */
async function grids(page: any) {
  const doc = await page.evaluate(() => window.TEST_EDITOR?.editor?._tiptapEditor.state.doc.toJSON())
  const found: {columnCount: unknown; cards: unknown[]}[] = []
  const walk = (node: any) => {
    if (node.type === 'blockChildren' && node.attrs?.listType === 'Grid') {
      found.push({
        columnCount: node.attrs.columnCount,
        cards: node.content.map((block: any) => block.content[0].attrs.name ?? block.content[0].type),
      })
    }
    node.content?.forEach(walk)
  }
  walk(doc)
  return found
}

test.describe('Card selection', () => {
  test('shift-click selects only the clicked cards inside a grid', async ({editorHelpers, page}) => {
    void editorHelpers
    await insertCards(page)

    await card(page, 'grid-3').click()
    await card(page, 'grid-2').click({modifiers: ['Shift']})

    await expectSelected(page, ['grid-2', 'grid-3'])
    await expect(page.getByTestId('formatting-toolbar')).toBeVisible()
    // A link wraps text in one block, so the toolbar offers none for cards.
    await expect(page.getByTestId('link-button')).toHaveCount(0)
    // Cards have no text, so there is nothing for the style buttons to format.
    await expect(page.getByTestId('bold-button')).toBeDisabled()
  })

  test('each shift-click extends from the first clicked card, even upwards', async ({editorHelpers, page}) => {
    void editorHelpers
    await insertCards(page)

    await card(page, 'grid-3').click()
    await card(page, 'grid-2').click({modifiers: ['Shift']})
    await expectSelected(page, ['grid-2', 'grid-3'])

    await card(page, 'grid-1').click({modifiers: ['Shift']})
    await expectSelected(page, ['grid-1', 'grid-2', 'grid-3'])

    await card(page, 'root-c').click({modifiers: ['Shift']})
    await expectSelected(page, ['grid-3', 'root-c'])
  })

  test('selects in reading order from grid cards to a card below the grid', async ({editorHelpers, page}) => {
    void editorHelpers
    await insertCards(page)

    await card(page, 'grid-2').click()
    await card(page, 'root-c').click({modifiers: ['Shift']})

    // The paragraph holding the grid comes before grid-2, so it stays out.
    await expectSelected(page, ['grid-2', 'grid-3', 'root-c'])
  })

  test('selects in reading order from a root card into a grid', async ({editorHelpers, page}) => {
    void editorHelpers
    await insertCards(page)

    await card(page, 'root-b').click()
    await card(page, 'grid-2').click({modifiers: ['Shift']})

    await expectSelected(page, ['root-b', 'paragraph', 'grid-1', 'grid-2'])
  })

  test('selects a parent card down to one of its nested cards', async ({editorHelpers, page}) => {
    void editorHelpers
    await insertCards(page)

    await card(page, 'parent').click()
    await card(page, 'child-2').click({modifiers: ['Shift']})

    await expectSelected(page, ['parent', 'child-1', 'child-2'])
  })

  test('selecting a parent card leaves out its nested cards, in either direction', async ({editorHelpers, page}) => {
    void editorHelpers
    await insertCards(page)

    await card(page, 'root-c').click()
    await card(page, 'parent').click({modifiers: ['Shift']})
    await expectSelected(page, ['root-c', 'parent'])

    await card(page, 'parent').click()
    // The toolbar above the selected card covers the middle of the card above it.
    await card(page, 'root-c').click({modifiers: ['Shift'], position: {x: 8, y: 8}})
    await expectSelected(page, ['root-c', 'parent'])
  })

  test('a selected grid card changes the grid column count', async ({editorHelpers, page}) => {
    void editorHelpers
    await insertCards(page)

    await card(page, 'grid-2').click()
    await expect(page.getByTestId('formatting-toolbar')).toBeVisible()

    await page.getByTestId('style-options-trigger').click()
    await page.getByTestId('grid-cols-2').click()

    await expect.poll(() => grids(page)).toEqual([{columnCount: 2, cards: ['grid-1', 'grid-2', 'grid-3']}])
  })

  test('turns selected root cards into a grid with the chosen column count', async ({editorHelpers, page}) => {
    void editorHelpers
    await insertCards(page)

    await card(page, 'root-a').click()
    await card(page, 'root-b').click({modifiers: ['Shift']})
    await expectSelected(page, ['root-a', 'root-b'])

    await page.getByTestId('style-options-trigger').click()
    await page.getByTestId('grid-cols-2').click()

    await expect
      .poll(() => grids(page))
      .toEqual([
        {columnCount: 2, cards: ['root-a', 'root-b']},
        {columnCount: '3', cards: ['grid-1', 'grid-2', 'grid-3']},
      ])
  })

  test('shift-click extends from and to an empty upload placeholder', async ({editorHelpers, page}) => {
    void editorHelpers
    await page.evaluate(
      (blocks: any[]) => {
        const editor = window.TEST_EDITOR!.editor!
        editor.insertBlocks(blocks, editor.topLevelBlocks[0]!, 'after')
      },
      [fileCard('first'), {type: 'file', props: {url: ''}}, fileCard('last')],
    )
    const placeholder = page.locator('[data-content-type="file"]').nth(1)

    await card(page, 'first').click()
    // Beside the placeholder's upload controls.
    await placeholder.click({modifiers: ['Shift'], position: {x: 4, y: 4}})
    await expectSelected(page, ['first', 'file'])

    await card(page, 'last').click({modifiers: ['Shift']})
    await expectSelected(page, ['first', 'file', 'last'])
  })

  test('shift-clicking text extends from the selected card, in either direction', async ({editorHelpers, page}) => {
    void editorHelpers
    await insertCards(page)
    await page.evaluate(() => {
      const editor = window.TEST_EDITOR!.editor!
      const blocks = editor.topLevelBlocks
      editor.updateBlock(blocks[0]!, {content: [{type: 'text', text: 'text above', styles: {}}]} as any)
      editor.updateBlock(blocks.at(-1)!, {content: [{type: 'text', text: 'text below', styles: {}}]} as any)
    })
    const textEnd = (text: string) =>
      page.evaluate((text) => {
        const p = [...document.querySelectorAll('p')].find((el) => el.textContent === text)!
        const range = document.createRange()
        range.selectNodeContents(p)
        const rect = range.getBoundingClientRect()
        return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}
      }, text)

    await card(page, 'grid-3').click()
    const below = await textEnd('text below')
    await page.keyboard.down('Shift')
    await page.mouse.click(below.x, below.y)
    await page.keyboard.up('Shift')
    await expectSelected(page, ['grid-3', 'root-c', 'parent', 'child-1', 'child-2'])
    // The range ends in text, which the style buttons can format.
    await expect(page.getByTestId('bold-button')).toBeEnabled()

    // The toolbar from the first range can cover the middle of the card.
    await card(page, 'root-b').click({position: {x: 8, y: 8}})
    const above = await textEnd('text above')
    await page.keyboard.down('Shift')
    await page.mouse.click(above.x, above.y)
    await page.keyboard.up('Shift')
    await expectSelected(page, ['root-a', 'root-b'])
  })

  test('double-clicking to the right of text selects its last word, not the cards after it', async ({
    editorHelpers,
    page,
  }) => {
    void editorHelpers
    await insertCards(page)
    await page.evaluate(() => {
      const editor = window.TEST_EDITOR!.editor!
      editor.updateBlock(editor.topLevelBlocks[0]!, {content: [{type: 'text', text: 'some text', styles: {}}]} as any)
    })
    const paragraph = page.locator('p', {hasText: /^some text$/}).first()
    const box = (await paragraph.boundingBox())!

    await page.mouse.dblclick(box.x + box.width - 20, box.y + box.height / 2)

    await expect
      .poll(() =>
        page.evaluate(() => {
          const {doc, selection} = window.TEST_EDITOR!.editor!._tiptapEditor.state
          return doc.textBetween(selection.from, selection.to)
        }),
      )
      .toBe('text')
    await expectSelected(page, [])
  })

  test.describe('deleting a range', () => {
    test('removes the cards without leaving an empty block behind', async ({editorHelpers, page}) => {
      void editorHelpers
      await insertCards(page)

      await card(page, 'grid-2').click()
      await card(page, 'root-c').click({modifiers: ['Shift']})
      await page.keyboard.press('Backspace')

      // The cursor moves to what came before the removed cards, not onto what follows them.
      await expectSelected(page, ['grid-1'])

      await expect
        .poll(() => outline(page))
        .toEqual([
          'paragraph',
          'root-a',
          'root-b',
          'paragraph',
          '  grid-1',
          'parent',
          '  child-1',
          '  child-2',
          'paragraph',
        ])
    })

    test('moves unselected nested cards into the place of their removed parent', async ({editorHelpers, page}) => {
      void editorHelpers
      await insertCards(page)

      await card(page, 'parent').click()
      await card(page, 'child-1').click({modifiers: ['Shift']})
      await page.keyboard.press('Delete')

      await expect
        .poll(() => outline(page))
        .toEqual([
          'paragraph',
          'root-a',
          'root-b',
          'paragraph',
          '  grid-1',
          '  grid-2',
          '  grid-3',
          'root-c',
          'child-2',
          'paragraph',
        ])
    })

    test('from a text cursor, keeps the text and removes the cards', async ({editorHelpers, page}) => {
      void editorHelpers
      await insertCards(page)
      await page.evaluate(() => {
        const editor = window.TEST_EDITOR!.editor!
        const first = editor.topLevelBlocks[0]!
        editor.updateBlock(first, {content: [{type: 'text', text: 'intro', styles: {}}]} as any)
        editor.setTextCursorPosition(first, 'end')
        editor.focus()
      })

      await card(page, 'root-b').click({modifiers: ['Shift']})
      await expectSelected(page, ['root-a', 'root-b'])
      await page.keyboard.press('Backspace')

      await expect
        .poll(() => outline(page))
        .toEqual([
          'paragraph',
          'paragraph',
          '  grid-1',
          '  grid-2',
          '  grid-3',
          'root-c',
          'parent',
          '  child-1',
          '  child-2',
          'paragraph',
        ])
      const cursor = await page.evaluate(() => {
        const {selection} = window.TEST_EDITOR!.editor!._tiptapEditor.state
        return {text: selection.$from.parent.textContent, offset: selection.$from.parentOffset, empty: selection.empty}
      })
      expect(cursor).toEqual({text: 'intro', offset: 5, empty: true})
    })

    test('removes a grid emptied of its cards', async ({editorHelpers, page}) => {
      void editorHelpers
      await insertCards(page)

      await card(page, 'grid-1').click()
      await card(page, 'grid-3').click({modifiers: ['Shift']})
      await page.keyboard.press('Backspace')

      await expect
        .poll(() => outline(page))
        .toEqual([
          'paragraph',
          'root-a',
          'root-b',
          'paragraph',
          'root-c',
          'parent',
          '  child-1',
          '  child-2',
          'paragraph',
        ])
    })
  })
})

test.describe('Card selection with every block type (real editor)', () => {
  /** The allBlocks fixture in editing mode, as block-selection-consistency sets it up. */
  async function setupAllBlocks(page: any) {
    await page.goto('/?fixture=allBlocks&real=1')
    await page.waitForFunction(() => !!window.TEST_EDITOR && !!(window as any).TEST_MACHINE, {timeout: 15000})
    await page.evaluate(() => (window as any).TEST_MACHINE.send({type: 'edit.start'}))
    await expect(page.locator('[data-id="blk-button"] [data-content-type="button"]')).toBeVisible()
  }
  const selectedIds = (page: any) => page.evaluate(() => window.TEST_EDITOR!.fullBlockIds())
  const body = (page: any, id: string) => page.locator(`[data-id="${id}"] [data-content-type]`).first()

  test('shift-click selects across buttons, math and draft embeds', async ({page}) => {
    await setupAllBlocks(page)

    await body(page, 'blk-math').click()
    await expect.poll(() => selectedIds(page)).toEqual(['blk-math'])

    // The button's face is a real <button> that selects its block on click.
    await page
      .locator('[data-id="blk-button"]')
      .getByRole('button')
      .first()
      .click({modifiers: ['Shift']})
    await expect.poll(() => selectedIds(page)).toEqual(['blk-button', 'blk-math'])

    // Inside the draft card, on its icon rather than its title field.
    await page
      .locator('[data-id="blk-draft"] [contenteditable="false"]')
      .first()
      .click({modifiers: ['Shift'], position: {x: 30, y: 30}})
    await expect.poll(() => selectedIds(page)).toEqual(['blk-draft', 'blk-web', 'blk-button', 'blk-math'])
  })
})

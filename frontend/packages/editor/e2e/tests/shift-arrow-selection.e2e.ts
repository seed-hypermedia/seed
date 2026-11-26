import {expect, test} from './fixtures'

test.use({clipboardPermissions: false})

const fileCard = (name: string, children: unknown[] = []) => ({
  type: 'file',
  props: {url: 'ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy', name, size: '1000'},
  children,
})

const paragraph = (text: string) => ({type: 'paragraph', content: [{type: 'text', text, styles: {}}]})

const card = (page: any, name: string) =>
  page
    .locator('[data-content-type="file"]')
    .filter({has: page.getByText(name, {exact: true})})
    .first()

/** Replaces the document with these blocks. */
async function setBlocks(page: any, blocks: unknown[]) {
  await page.evaluate((blocks: any[]) => {
    const editor = window.TEST_EDITOR?.editor
    if (!editor) throw new Error('Editor not ready')
    editor.replaceBlocks(editor.topLevelBlocks, blocks)
  }, blocks)
}

/** Puts the cursor at the end of the paragraph with this text. */
async function cursorAtEndOf(page: any, text: string) {
  await page.evaluate((text: string) => {
    const tiptap = window.TEST_EDITOR!.editor!._tiptapEditor
    let end = -1
    tiptap.state.doc.descendants((node: any, pos: number) => {
      if (end < 0 && node.isTextblock && node.textContent === text) end = pos + 1 + node.content.size
      return end < 0
    })
    tiptap.commands.focus()
    tiptap.commands.setTextSelection(end)
  }, text)
}

/**
 * The selection as its start, its end and its fully selected blocks. An end in text is `text@offset`; an end at a
 * block's edge is `start of X` or `end of X`, naming a card by its file name and a text block by its text.
 */
async function selection(page: any) {
  return page.evaluate(() => {
    const api = window.TEST_EDITOR!
    const {doc, selection} = api.editor!._tiptapEditor.state
    const name = (node: any) => node.attrs.name || node.textContent || node.type.name
    const describe = (pos: number) => {
      const $pos = doc.resolve(pos)
      if ($pos.parent.inlineContent) return `${$pos.parent.textContent}@${$pos.parentOffset}`
      return $pos.nodeAfter ? `start of ${name($pos.nodeAfter)}` : `end of ${name($pos.nodeBefore)}`
    }
    const blocks = api.fullBlockIds().map((id: string) => {
      let found = id
      doc.descendants((node: any) => {
        if (node.attrs?.id === id) found = name(node.firstChild)
        return found === id
      })
      return found
    })
    return {start: describe(selection.anchor), end: describe(selection.head), blocks}
  })
}

/** Names of the fully selected cards, leaving out the invisible blocks that hold lists. */
async function selectedCards(page: any) {
  const {blocks} = await selection(page)
  return blocks.filter((name: string) => name !== 'slot' && name !== 'paragraph')
}

const press = (page: any, key: string, times = 1) =>
  Array.from({length: times}).reduce<Promise<void>>(
    (previous) => previous.then(() => page.keyboard.press(key)),
    Promise.resolve(),
  )

test.describe('Shift+Arrow selection', () => {
  test.beforeEach(async ({editorHelpers, page}) => {
    void editorHelpers
    await setBlocks(page, [
      paragraph('alpha one'),
      fileCard('card-a'),
      fileCard('card-b'),
      paragraph('beta two'),
      fileCard('card-c'),
    ])
    await expect(page.locator('[data-content-type="file"]')).toHaveCount(3)
  })

  test('Shift+Down and Shift+Up add and remove whole blocks from a selected card', async ({page}) => {
    await card(page, 'card-a').click({position: {x: 8, y: 8}})

    await press(page, 'Shift+ArrowDown', 3)
    await expect.poll(() => selection(page)).toMatchObject({blocks: ['card-a', 'card-b', 'beta two', 'card-c']})

    // Back to the card the range started on.
    await press(page, 'Shift+ArrowUp', 3)
    await expect.poll(() => selection(page)).toMatchObject({blocks: ['card-a']})

    // Past it, the text block above is added whole.
    await press(page, 'Shift+ArrowUp')
    await expect.poll(() => selection(page)).toMatchObject({blocks: ['alpha one', 'card-a']})
  })

  test('Shift+Down from text keeps the cursor as the start and adds whole blocks', async ({page}) => {
    await cursorAtEndOf(page, 'alpha one')

    await press(page, 'Shift+ArrowDown')
    await expect.poll(() => selection(page)).toEqual({start: 'alpha one@9', end: 'end of card-a', blocks: ['card-a']})

    await press(page, 'Shift+ArrowDown', 2)
    await expect
      .poll(() => selection(page))
      .toEqual({start: 'alpha one@9', end: 'end of beta two', blocks: ['card-a', 'card-b', 'beta two']})

    await press(page, 'Shift+ArrowUp', 3)
    await expect.poll(() => selection(page)).toEqual({start: 'alpha one@9', end: 'alpha one@9', blocks: []})
  })

  test('Shift+Down moves line by line inside a wrapped paragraph before adding blocks', async ({page}) => {
    const long = 'wrapped '.repeat(60).trim()
    await setBlocks(page, [paragraph(long), fileCard('card-a')])
    // A few characters into the paragraph, so it isn't selected whole.
    await page.evaluate(() => {
      const tiptap = window.TEST_EDITOR!.editor!._tiptapEditor
      tiptap.commands.focus()
      tiptap.commands.setTextSelection(5)
    })

    let presses = 0
    while (presses < 15 && !(await selectedCards(page)).includes('card-a')) {
      await press(page, 'Shift+ArrowDown')
      presses++
      if (presses === 1) expect((await selection(page)).end).toMatch(/^wrapped.*@\d+$/)
    }

    // One press per wrapped line, then one for the card.
    expect(presses).toBeGreaterThan(2)
    const {start, blocks} = await selection(page)
    expect(start).toMatch(/@2$/)
    expect(blocks).toEqual(['card-a'])
  })

  test('Shift+Right adds cards whole and steps into the next text a character at a time', async ({page}) => {
    await cursorAtEndOf(page, 'alpha one')

    await press(page, 'Shift+ArrowRight', 2)
    await expect.poll(() => selection(page)).toMatchObject({end: 'end of card-b', blocks: ['card-a', 'card-b']})

    // Straight onto the first character: stopping before it would select nothing new.
    await press(page, 'Shift+ArrowRight')
    await expect.poll(() => selection(page)).toMatchObject({start: 'alpha one@9', end: 'beta two@1'})

    await press(page, 'Shift+ArrowRight')
    await expect.poll(() => selection(page)).toMatchObject({end: 'beta two@2'})

    await press(page, 'Shift+ArrowLeft', 2)
    await expect.poll(() => selection(page)).toMatchObject({end: 'end of card-b', blocks: ['card-a', 'card-b']})
  })

  test('Shift+Right and Shift+Left between text blocks select a character on every press', async ({page}) => {
    await setBlocks(page, [paragraph('first'), paragraph('second')])
    await cursorAtEndOf(page, 'first')

    await press(page, 'Shift+ArrowRight')
    await expect.poll(() => selection(page)).toMatchObject({start: 'first@5', end: 'second@1'})

    // Back to the cursor in one press, and on into the text before it.
    await press(page, 'Shift+ArrowLeft')
    await expect.poll(() => selection(page)).toMatchObject({start: 'first@5', end: 'first@5'})
    await press(page, 'Shift+ArrowLeft')
    await expect.poll(() => selection(page)).toMatchObject({start: 'first@5', end: 'first@4'})
  })

  test('Shift+Up after Shift+Down in a wrapped paragraph unselects a line', async ({page}) => {
    await setBlocks(page, [paragraph('above'), paragraph('wrapped '.repeat(60).trim())])
    await page.evaluate(() => {
      const tiptap = window.TEST_EDITOR!.editor!._tiptapEditor
      let start = -1
      tiptap.state.doc.descendants((node: any, pos: number) => {
        if (start < 0 && node.isTextblock && node.textContent.startsWith('wrapped')) start = pos + 1
        return start < 0
      })
      tiptap.commands.focus()
      tiptap.commands.setTextSelection(start + 2)
    })

    await press(page, 'Shift+ArrowDown')
    const oneLine = await selection(page)
    await press(page, 'Shift+ArrowDown')
    expect((await selection(page)).end).not.toBe(oneLine.end)

    await press(page, 'Shift+ArrowUp')
    await expect.poll(() => selection(page)).toEqual(oneLine)
  })

  test('a range started on a card keeps it while Shift+Right moves through text', async ({page}) => {
    await card(page, 'card-b').click({position: {x: 8, y: 8}})

    await press(page, 'Shift+ArrowRight', 3)
    await expect.poll(() => selection(page)).toEqual({start: 'start of card-b', end: 'beta two@3', blocks: ['card-b']})

    await press(page, 'Shift+ArrowLeft', 3)
    await expect
      .poll(() => selection(page))
      .toEqual({start: 'start of card-b', end: 'end of card-b', blocks: ['card-b']})
  })

  test('steps into a root grid past its Slot, along the grid row and into nested cards', async ({page}) => {
    await setBlocks(page, [
      fileCard('root-a'),
      {
        type: 'slot',
        props: {childrenType: 'Grid', columnCount: '2'},
        children: [fileCard('grid-1'), fileCard('grid-2')],
      },
      fileCard('parent', [fileCard('child')]),
    ])
    await card(page, 'root-a').click({position: {x: 8, y: 8}})

    await press(page, 'Shift+ArrowDown')
    await expect.poll(() => selectedCards(page)).toEqual(['root-a', 'grid-1'])

    await press(page, 'Shift+ArrowRight')
    await expect.poll(() => selectedCards(page)).toEqual(['root-a', 'grid-1', 'grid-2'])

    await press(page, 'Shift+ArrowDown', 2)
    await expect.poll(() => selectedCards(page)).toEqual(['root-a', 'grid-1', 'grid-2', 'parent', 'child'])
  })
})

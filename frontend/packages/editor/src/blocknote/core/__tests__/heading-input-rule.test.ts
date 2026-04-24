import {TextSelection} from 'prosemirror-state'
import {describe, expect, it} from 'vitest'
import {BlockNoteEditor} from '../BlockNoteEditor'
import type {Block, PartialBlock} from '../extensions/Blocks/api/blockTypes'

/**
 * Regression tests for issue #490 — the `#<space>` markdown shortcut must
 * convert a paragraph into a heading regardless of where the paragraph sits
 * in the block tree.
 *
 * The hmBlockSchema editor uses HMHeadingBlockContent, which historically
 * resolved the enclosing block with hard-coded `$pos.start() - 2` math. That
 * only worked for paragraphs directly under the top-level `blockChildren`
 * node; nesting the paragraph (under another block, blockquote, grid cell)
 * shifted the depth and the rule silently no-oped, leaving `# ` literal.
 */

type PartialAnyBlock = PartialBlock<any>

function createEditor(initialContent: PartialAnyBlock[]) {
  return new BlockNoteEditor({
    initialContent,
  })
}

/**
 * Drive a character through the same `handleTextInput` pipeline the browser
 * would — that's where prosemirror/tiptap input rules hook in. A bare
 * `tr.insertText` would bypass the rules.
 */
function typeText(editor: BlockNoteEditor<any>, text: string) {
  const view = editor._tiptapEditor.view
  const {from, to} = view.state.selection
  const handled = view.someProp('handleTextInput', (fn) => fn(view, from, to, text))
  if (!handled) {
    view.dispatch(view.state.tr.insertText(text, from, to))
  }
}

function placeCursorInBlock(editor: BlockNoteEditor<any>, blockId: string, offset = 0) {
  const view = editor._tiptapEditor.view
  let target: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (target !== null) return false
    if (node.type.name === 'blockNode' && node.attrs.id === blockId) {
      target = pos + 1 /* enter blockNode */ + 1 /* enter blockContent */ + offset
      return false
    }
    return true
  })
  if (target === null) throw new Error(`Block "${blockId}" not found`)
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, target))
  view.dispatch(tr)
}

function findBlockById(blocks: Block<any>[], id: string): Block<any> | undefined {
  for (const block of blocks) {
    if (block.id === id) return block
    const nested = findBlockById(block.children, id)
    if (nested) return nested
  }
  return undefined
}

describe('Heading `#<space>` input rule (issue #490)', () => {
  it('converts a top-level paragraph to a heading on `# `', () => {
    const editor = createEditor([{id: 'b1', type: 'paragraph'}])
    placeCursorInBlock(editor, 'b1')

    typeText(editor, '#')
    typeText(editor, ' ')

    const block = findBlockById(editor.topLevelBlocks, 'b1')
    expect(block?.type).toBe('heading')

    editor._tiptapEditor.destroy()
  })

  it('converts a NESTED paragraph (child of another block) to a heading on `# `', () => {
    // The regression case from issue #490: a paragraph nested as a child of
    // another block sits one depth deeper in the doc, so the old
    // `$pos.start() - 2` math pointed at the wrong node and silently no-oped.
    const editor = createEditor([
      {
        id: 'parent',
        type: 'paragraph',
        content: 'parent text',
        children: [{id: 'child', type: 'paragraph'}],
      },
    ])
    placeCursorInBlock(editor, 'child')

    typeText(editor, '#')
    typeText(editor, ' ')

    const block = findBlockById(editor.topLevelBlocks, 'child')
    expect(block?.type).toBe('heading')

    editor._tiptapEditor.destroy()
  })

  it('converts a paragraph inside a Grid-children container to a heading on `# `', () => {
    // Per product decision, heading creation IS allowed inside grid cells
    // (unlike list/blockquote shortcuts which are blocked there).
    const editor = createEditor([
      {
        id: 'parent',
        type: 'paragraph',
        content: 'parent text',
        props: {childrenType: 'Grid'},
        children: [{id: 'cell', type: 'paragraph'}],
      },
    ])
    placeCursorInBlock(editor, 'cell')

    typeText(editor, '#')
    typeText(editor, ' ')

    const block = findBlockById(editor.topLevelBlocks, 'cell')
    expect(block?.type).toBe('heading')

    editor._tiptapEditor.destroy()
  })

  it('does NOT convert when `#` is typed after existing text in the block', () => {
    const editor = createEditor([{id: 'b1', type: 'paragraph', content: 'hello '}])
    // Place cursor at end of "hello " — typing `# ` here must not match the
    // `^#\s$` regex because there's already text at the block's start.
    placeCursorInBlock(editor, 'b1', 'hello '.length)

    typeText(editor, '#')
    typeText(editor, ' ')

    const block = findBlockById(editor.topLevelBlocks, 'b1')
    expect(block?.type).toBe('paragraph')

    editor._tiptapEditor.destroy()
  })
})

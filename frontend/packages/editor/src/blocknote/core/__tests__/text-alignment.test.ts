import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {BlockNoteEditor} from '../BlockNoteEditor'

/** Builds a read-only editor from stored HM blocks, the same way the published reading view does. */
function renderReadOnly(nodes: HMBlockNode[]) {
  const editor = new BlockNoteEditor({
    editable: false,
    initialContent: hmBlocksToEditorContent(nodes, {childrenType: 'Group'}) as any,
  })
  return editor
}

describe('textAlignment rendering', () => {
  it('renders stored alignment on paragraphs and headings', () => {
    const editor = renderReadOnly([
      {
        block: {
          id: 'p-center',
          type: 'Paragraph',
          text: 'Centered',
          annotations: [],
          attributes: {textAlignment: 'center'},
        },
      },
      {block: {id: 'h-right', type: 'Heading', text: 'Right', annotations: [], attributes: {textAlignment: 'right'}}},
      {
        block: {
          id: 'p-justify',
          type: 'Paragraph',
          text: 'Justified',
          annotations: [],
          attributes: {textAlignment: 'justify'},
        },
      },
    ])
    const dom = editor._tiptapEditor.view.dom
    const aligned = (id: string) =>
      dom.querySelector(`[data-id="${id}"] [data-content-type]`)?.getAttribute('data-text-alignment')
    expect(aligned('p-center')).toBe('center')
    expect(aligned('h-right')).toBe('right')
    expect(aligned('p-justify')).toBe('justify')
    expect(editor.topLevelBlocks.map((b) => b.props.textAlignment)).toEqual(['center', 'right', 'justify'])
    editor._tiptapEditor.destroy()
  })

  it('renders no alignment attribute for unaligned or invalid blocks', () => {
    const editor = renderReadOnly([
      {block: {id: 'p-plain', type: 'Paragraph', text: 'Plain', annotations: [], attributes: {}}},
      {
        block: {
          id: 'p-bad',
          type: 'Paragraph',
          text: 'Bad',
          annotations: [],
          attributes: {textAlignment: 'middle'},
        } as any,
      },
    ])
    const dom = editor._tiptapEditor.view.dom
    expect(dom.querySelector('[data-text-alignment]')).toBeNull()
    expect(editor.topLevelBlocks.map((b) => b.props.textAlignment)).toEqual(['left', 'left'])
    editor._tiptapEditor.destroy()
  })
})

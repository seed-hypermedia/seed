// @vitest-environment jsdom
import {TextSelection} from 'prosemirror-state'
import {describe, expect, it, vi} from 'vitest'
import {hmBlockSchema} from '../../../schema'
import {BlockNoteEditor} from '../BlockNoteEditor'
import type {Block, PartialBlock} from '../extensions/Blocks/api/blockTypes'
import {stripBlockWhitespaces} from '../extensions/Blocks/nodes/externalHtmlPaste'

function createEditor(initialContent: PartialBlock<any>[] = [{id: 'target', type: 'paragraph', content: []}]) {
  return new BlockNoteEditor({initialContent, blockSchema: hmBlockSchema})
}

function blockPos(editor: BlockNoteEditor<any>, blockId: string) {
  let found = -1
  editor._tiptapEditor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.type.name === 'blockNode' && node.attrs.id === blockId) found = pos
    return true
  })
  if (found < 0) throw new Error(`Block "${blockId}" not found`)
  return found
}

/** Pastes HTML, with its plain-text version, into the empty block `target`, the way ProseMirror handles a paste event. */
function pasteHtml(editor: BlockNoteEditor<any>, html: string, text = '') {
  const {view} = editor._tiptapEditor
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, blockPos(editor, 'target') + 2)))
  // jsdom has no ClipboardEvent, so hand ProseMirror a paste event carrying the clipboard data.
  const data: Record<string, string> = {'text/html': html, 'text/plain': text}
  const event = Object.assign(new Event('paste'), {
    clipboardData: {getData: (type: string) => data[type] ?? '', types: Object.keys(data), files: [], items: []},
  })
  view.pasteHTML(html, event as unknown as ClipboardEvent)
}

/** One line per block: its type, list type and text, indented by depth. Empty trailing blocks are left out. */
function outline(blocks: Block<any>[], depth = 0): string[] {
  return blocks.flatMap((block) => {
    const text = (block.content as any[]).map((inline) => inline.text ?? '').join('')
    if (depth === 0 && !text && !block.children.length) return []
    const list =
      block.props.childrenType && block.props.childrenType !== 'Group' ? ` [${block.props.childrenType}]` : ''
    return [`${'  '.repeat(depth)}${block.type}${list}: ${text}`, ...outline(block.children, depth + 1)]
  })
}

// Trimmed from what Claude desktop puts on the clipboard: headings one level down from the chat's, a line break
// between top-level elements, and a list that directly follows a heading.
const claudeHtml = `<meta charset='utf-8'><h2 dir="ltr" aria-level="4">Project Overview</h2>
<p dir="ltr">This is <strong>paragraph A</strong> under the H1.</p>
<p dir="ltr">This is <strong>paragraph B</strong>.</p>
<h3 dir="ltr" aria-level="5">Background</h3>
<p dir="ltr"><strong>A bold-only line</strong></p>
<p dir="ltr">Paragraph F introduces a list:</p>
<ul dir="ltr">
<li>First bullet</li>
<li>Second bullet
<ul dir="ltr">
<li>Nested bullet</li>
</ul>
</li>
</ul>
<p dir="ltr">Paragraph G, after the list.</p>
<h4 dir="ltr" aria-level="6">Steps</h4>
<ol dir="ltr">
<li>First step</li>
<li>Second step</li>
</ol>
<p dir="ltr">Paragraph H, after the steps.</p>
<h3 dir="ltr" aria-level="5">Sibling Section</h3>
<p dir="ltr">Paragraph I.</p>`

describe('Pasting HTML from other apps', () => {
  it('nests each section under its heading, by heading level', () => {
    const editor = createEditor()
    pasteHtml(editor, claudeHtml)

    expect(outline(editor.topLevelBlocks)).toEqual([
      'heading: Project Overview',
      '  paragraph: This is paragraph A under the H1.',
      '  paragraph: This is paragraph B.',
      '  heading: Background',
      '    paragraph: A bold-only line',
      '    paragraph [Unordered]: Paragraph F introduces a list:',
      '      paragraph: First bullet',
      '      paragraph [Unordered]: Second bullet',
      '        paragraph: Nested bullet',
      '    paragraph: Paragraph G, after the list.',
      '    heading: Steps',
      '      paragraph [Ordered]: ',
      '        paragraph: First step',
      '        paragraph: Second step',
      '      paragraph: Paragraph H, after the steps.',
      '  heading: Sibling Section',
      '    paragraph: Paragraph I.',
    ])
  })

  it('does not add a blank block for the line break after the first element', () => {
    const editor = createEditor()
    pasteHtml(editor, '<p>A</p>\n<p>B</p>\n<p>C</p>')

    expect(outline(editor.topLevelBlocks)).toEqual(['paragraph: A', 'paragraph: B', 'paragraph: C'])
  })

  it('nests an h2 under an h1', () => {
    const editor = createEditor()
    pasteHtml(editor, '<h1>Title</h1><p>Intro</p><h2>Part</h2><p>Body</p><h1>Next</h1>')

    expect(outline(editor.topLevelBlocks)).toEqual([
      'heading: Title',
      '  paragraph: Intro',
      '  heading: Part',
      '    paragraph: Body',
      'heading: Next',
    ])
  })

  it('puts text outside any element into the section as a paragraph', () => {
    const editor = createEditor()
    // The quote keeps ProseMirror from wrapping the pasted nodes in blocks itself, which leaves the trailing text bare.
    pasteHtml(editor, '<h2>Heading</h2><p>Paragraph</p><blockquote><p>Quote</p></blockquote>trailing <b>text</b>')

    expect(outline(editor.topLevelBlocks)).toEqual([
      'heading: Heading',
      '  paragraph [Blockquote]: Paragraph',
      '    paragraph: Quote',
      '  paragraph: trailing text',
    ])
  })

  it('keeps a list as the heading children when nothing follows it in the section', () => {
    const editor = createEditor()
    pasteHtml(editor, '<h2>Steps</h2><ol><li>One</li><li>Two</li></ol><h2>Done</h2>')

    expect(outline(editor.topLevelBlocks)).toEqual([
      'heading [Ordered]: Steps',
      '  paragraph: One',
      '  paragraph: Two',
      'heading: Done',
    ])
  })

  it('leaves the structure of content copied from a Seed editor as it was', () => {
    const source = createEditor([
      {id: 'h', type: 'heading', content: 'Heading'},
      {id: 'p', type: 'paragraph', content: 'Sibling paragraph'},
    ])
    const {view: sourceView} = source._tiptapEditor
    const {doc} = sourceView.state
    const paragraphEnd = blockPos(source, 'p') + 2 + 'Sibling paragraph'.length
    const copied = sourceView.serializeForClipboard(doc.slice(blockPos(source, 'h') + 2, paragraphEnd))

    const editor = createEditor()
    pasteHtml(editor, copied.dom.innerHTML)

    expect(outline(editor.topLevelBlocks)).toEqual(['heading: Heading', 'paragraph: Sibling paragraph'])
  })
})

describe('Choosing between pasted HTML and Markdown', () => {
  it('keeps formatted HTML even when its plain text looks like Markdown', () => {
    const editor = createEditor()
    // The backticks in the plain text read as Markdown, which joins lines split by a single line break.
    pasteHtml(
      editor,
      '<p><strong>Summary</strong></p>\n<p>Run <code>pnpm</code> first.</p>',
      'Summary\nRun `pnpm` first.',
    )

    expect(outline(editor.topLevelBlocks)).toEqual(['paragraph: Summary', 'paragraph: Run pnpm first.'])
  })

  it('reads Markdown source copied from a code editor as Markdown', async () => {
    const editor = createEditor()
    // Code editors put the source on the clipboard as styled spans, with the Markdown syntax still in the text.
    pasteHtml(
      editor,
      '<meta charset="utf-8"><div style="color: #d4d4d4;"><div><span style="color: #569cd6;"># Notes</span></div>' +
        '<br><div><span>Some **bold** text</span></div></div>',
      '# Notes\n\nSome **bold** text',
    )

    await vi.waitFor(() =>
      expect(outline(editor.topLevelBlocks)).toEqual(['heading: Notes', '  paragraph: Some bold text']),
    )
  })
})

describe('stripBlockWhitespaces', () => {
  it('keeps the space between inline elements', () => {
    const html = '<strong>bold</strong> <em>italic</em>'
    expect(stripBlockWhitespaces(html)).toBe(html)
  })

  it('leaves table fragments to ProseMirror, which wraps them in a table first', () => {
    const html = '<tr><td>a</td></tr>\n<tr><td>b</td></tr>'
    expect(stripBlockWhitespaces(html)).toBe(html)
  })
})

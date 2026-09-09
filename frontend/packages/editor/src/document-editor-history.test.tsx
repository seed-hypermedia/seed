import {act} from 'react-dom/test-utils'
import {createRoot} from 'react-dom/client'
import {expect, it} from 'vitest'
import {useDocumentEditorInitialContent} from './document-editor'
import {useBlockNote} from './blocknote'
import {hmBlockSchema} from './schema'
import type {DocumentContentProps} from '@shm/shared/document-content-props'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

it('keeps the editor and undo/redo history while publication review pauses an editing session', () => {
  let editor: ReturnType<typeof useBlockNote>
  function Harness({blocks, active}: {blocks: DocumentContentProps['blocks']; active: boolean}) {
    const initialContent = useDocumentEditorInitialContent(blocks, active)
    editor = useBlockNote({blockSchema: hmBlockSchema, initialContent}, [initialContent])
    return null
  }
  const blocks = [{id: 'text', type: 'paragraph', content: [{type: 'text', text: 'Before', styles: {}}]}] as any
  const root = createRoot(document.createElement('div'))
  act(() => root.render(<Harness blocks={blocks} active />))
  const original = editor!
  act(() => original.updateBlock('text', {content: [{type: 'text', text: 'After', styles: {}}]}))
  const edited = original.topLevelBlocks
  // A draft save changes the supplied blocks while the session is paused in publication.
  act(() => root.render(<Harness blocks={edited as any} active />))
  expect(editor!).toBe(original)
  act(() => original._tiptapEditor.commands.undo())
  expect(original._tiptapEditor.state.doc.textContent).toBe('Before')
  act(() => original._tiptapEditor.commands.redo())
  expect(original._tiptapEditor.state.doc.textContent).toBe('After')
  // A completed session must still accept newly published content.
  act(() => root.render(<Harness blocks={blocks} active={false} />))
  act(() => root.render(<Harness blocks={edited as any} active={false} />))
  expect(editor!).not.toBe(original)
  editor!._tiptapEditor.destroy()
  act(() => root.unmount())
  original._tiptapEditor.destroy()
})

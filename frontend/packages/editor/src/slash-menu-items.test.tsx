import {describe, expect, it, vi} from 'vitest'
import {getSlashMenuItems} from './slash-menu-items'

describe('getSlashMenuItems', () => {
  it('omits New document when inline draft creation is unavailable', () => {
    const items = getSlashMenuItems({
      docId: {id: 'hm://uid/private', uid: 'uid', path: ['private'], version: null, blockRef: null} as any,
    })

    expect(items.find((item) => item.name === 'New document')).toBeUndefined()
  })
  it('keeps the cursor in a newly inserted code block', () => {
    const currentBlock = {id: 'block-1', content: []}
    const tr = {scrollIntoView: vi.fn(() => 'scroll-tr')}
    const editor = {
      getTextCursorPosition: vi.fn(() => ({block: currentBlock})),
      updateBlock: vi.fn(),
      _tiptapEditor: {
        state: {tr},
        view: {dispatch: vi.fn()},
      },
    }

    const item = getSlashMenuItems().find((item) => item.name === 'Code Block')

    item!.execute(editor as any)

    expect(editor.updateBlock).toHaveBeenCalledWith(
      currentBlock,
      {
        type: 'code-block',
        props: {language: ''},
      },
      true,
    )
    expect(editor._tiptapEditor.view.dispatch).toHaveBeenCalledWith('scroll-tr')
  })

  it('hides New document even when inline draft creation is available', () => {
    const items = getSlashMenuItems({
      docId: {id: 'hm://uid/parent', uid: 'uid', path: ['parent'], version: null, blockRef: null} as any,
      onCreateInlineDraft: vi.fn(),
    })

    expect(items.find((item) => item.name === 'New document')).toBeUndefined()
  })
})

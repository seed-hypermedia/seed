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

  it('inserts New document draft embed without focusing/selecting the editor block', async () => {
    const currentBlock = {id: 'block-1', content: [{type: 'text', text: '/'}]}
    const editor = {
      getTextCursorPosition: vi.fn(() => ({block: currentBlock})),
      updateBlock: vi.fn(),
      focus: vi.fn(),
      setTextCursorPosition: vi.fn(),
      _tiptapEditor: {
        commands: {
          command: vi.fn(),
        },
      },
    }
    const onCreateInlineDraft = vi.fn().mockResolvedValue({draftId: 'draft-1', draftPath: ['parent', '-draft-1']})

    const item = getSlashMenuItems({
      docId: {id: 'hm://uid/parent', uid: 'uid', path: ['parent'], version: null, blockRef: null} as any,
      onCreateInlineDraft,
    }).find((item) => item.name === 'New document')

    await item!.execute(editor as any)

    expect(editor.updateBlock).toHaveBeenCalledWith(currentBlock, {
      type: 'embed',
      props: {draftId: 'draft-1', url: '', view: 'Card'},
    })
    expect(editor.focus).not.toHaveBeenCalled()
    expect(editor.setTextCursorPosition).not.toHaveBeenCalled()
  })
})

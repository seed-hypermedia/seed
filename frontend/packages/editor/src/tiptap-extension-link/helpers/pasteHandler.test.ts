import {Fragment, Schema, Slice} from '@tiptap/pm/model'
import {EditorState} from '@tiptap/pm/state'
import {describe, expect, it} from 'vitest'
import {pasteHandler, restoreBlockRangeSuffix} from './pasteHandler'

const schema = new Schema({
  nodes: {
    doc: {content: 'text*'},
    text: {group: 'inline'},
  },
  marks: {
    link: {
      attrs: {href: {default: null}},
      parseDOM: [{tag: 'a[href]'}],
      toDOM(mark) {
        return ['a', {href: mark.attrs.href}, 0]
      },
    },
  },
})

function createPasteView() {
  let state = EditorState.create({schema})
  const view = {
    get state() {
      return state
    },
    dispatch(tr: any) {
      state = state.apply(tr)
    },
  }
  return view as any
}

async function flushPasteHandler() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('restoreBlockRangeSuffix', () => {
  it('reattaches a [start:end] block range linkifyjs truncates', () => {
    const href = 'https://site.example/doc?v=ver#blockId'
    const full = 'https://site.example/doc?v=ver#blockId[20:52]'
    expect(restoreBlockRangeSuffix(href, full)).toBe(full)
  })

  it('reattaches a + expanded block-range marker', () => {
    const href = 'https://site.example/doc#blockId'
    const full = 'https://site.example/doc#blockId+'
    expect(restoreBlockRangeSuffix(href, full)).toBe(full)
  })

  it('is a no-op when href already has the full range', () => {
    const href = 'https://site.example/doc#blockId[20:52]'
    expect(restoreBlockRangeSuffix(href, href)).toBe(href)
  })

  it('does not pull trailing brackets into URLs without a fragment', () => {
    const href = 'https://site.example/doc'
    const full = 'https://site.example/doc[stuff]'
    expect(restoreBlockRangeSuffix(href, full)).toBe(href)
  })

  it('ignores trailing text that is not a block range', () => {
    const href = 'https://site.example/doc#blockId'
    const full = 'https://site.example/doc#blockId rest of paste'
    expect(restoreBlockRangeSuffix(href, full)).toBe(href)
  })

  it('returns href unchanged when fullText does not start with it', () => {
    const href = 'https://site.example/doc#blockId'
    const full = 'see https://site.example/doc#blockId[20:52]'
    expect(restoreBlockRangeSuffix(href, full)).toBe(href)
  })

  it('only consumes the block range, leaving following text untouched', () => {
    const href = 'https://site.example/doc#blockId'
    const full = 'https://site.example/doc#blockId[20:52] (was great!)'
    expect(restoreBlockRangeSuffix(href, full)).toBe('https://site.example/doc#blockId[20:52]')
  })
})

describe('pasteHandler', () => {
  it('uses the universal client to insert a pasted hm:// document URL as a titled link', async () => {
    const url = 'hm://abc/path'
    const view = createPasteView()
    const universalClient = {
      request: async () => ({
        type: 'document',
        document: {
          content: [],
          metadata: {name: 'Doc Title'},
          path: '/path',
          version: 'version-cid',
        },
      }),
    }
    const plugin = pasteHandler({
      editor: {schema} as any,
      type: schema.marks.link,
      universalClient: universalClient as any,
      gwUrl: {get: () => 'https://hyper.media'} as any,
      checkWebUrl: async () => null,
    })

    const handled = plugin.props.handlePaste?.(view, {} as any, new Slice(Fragment.from(schema.text(url)), 0, 0))

    expect(handled).toBe(true)
    await flushPasteHandler()
    expect(view.state.doc.textContent).toBe('Doc Title')
    expect(view.state.doc.nodeAt(0)?.marks[0]?.attrs.href).toBe(url)
  })

  it('uses the universal client to insert a pasted hm:// comment URL as a titled link', async () => {
    const url = 'hm://commenter/comment-id'
    const view = createPasteView()
    const universalClient = {
      request: async (_key: string, input: any) => {
        if (!input.path?.length) {
          return {
            type: 'document',
            document: {
              content: [],
              metadata: {name: 'Alice'},
              path: '',
              version: 'author-version',
            },
          }
        }
        return {
          type: 'comment',
          comment: {
            author: 'commenter',
            content: [{block: {type: 'Paragraph', text: 'Comment body text'}, children: []}],
            version: 'comment-version',
          },
        }
      },
    }
    const plugin = pasteHandler({
      editor: {schema} as any,
      type: schema.marks.link,
      universalClient: universalClient as any,
      gwUrl: {get: () => 'https://hyper.media'} as any,
      checkWebUrl: async () => null,
    })

    const handled = plugin.props.handlePaste?.(view, {} as any, new Slice(Fragment.from(schema.text(url)), 0, 0))

    expect(handled).toBe(true)
    await flushPasteHandler()
    expect(view.state.doc.textContent).toBe('Comment from Alice')
    expect(view.state.doc.nodeAt(0)?.marks[0]?.attrs.href).toBe(url)
  })

  it('does not fall back to a shortened author UID for comment links', async () => {
    const url = 'hm://commenter/comment-id'
    const view = createPasteView()
    const universalClient = {
      request: async (_key: string, input: any) => {
        if (!input.path?.length) {
          return {type: 'not-found'}
        }
        return {
          type: 'comment',
          comment: {
            author: 'z6Mklongauthoruid',
            content: [],
            version: 'comment-version',
          },
        }
      },
    }
    const plugin = pasteHandler({
      editor: {schema} as any,
      type: schema.marks.link,
      universalClient: universalClient as any,
      gwUrl: {get: () => 'https://hyper.media'} as any,
      checkWebUrl: async () => null,
    })

    const handled = plugin.props.handlePaste?.(view, {} as any, new Slice(Fragment.from(schema.text(url)), 0, 0))

    expect(handled).toBe(true)
    await flushPasteHandler()
    expect(view.state.doc.textContent).toBe('Comment')
    expect(view.state.doc.nodeAt(0)?.marks[0]?.attrs.href).toBe(url)
  })

  it('resolves a custom-domain profile URL locally and inserts the profile name', async () => {
    const url = 'https://dream-machines-2.hyper.media/:profile/z6MkfopTfn1vwUZiPsFK82w8BTuV4ewV6zZKaU4sTtnuU5bt'
    const view = createPasteView()
    const universalClient = {
      request: async (_key: string, input: any) => {
        expect(input.uid).toBe('z6MkfopTfn1vwUZiPsFK82w8BTuV4ewV6zZKaU4sTtnuU5bt')
        expect(input.path).toBeNull()
        return {
          type: 'document',
          document: {
            content: [],
            metadata: {name: 'Profile Name'},
            path: '',
            version: 'profile-version',
          },
        }
      },
    }
    const plugin = pasteHandler({
      editor: {schema} as any,
      type: schema.marks.link,
      universalClient: universalClient as any,
      domainResolver: async () => 'z6MksiteUid',
      gwUrl: {get: () => 'https://hyper.media'} as any,
      checkWebUrl: async () => null,
    })

    const handled = plugin.props.handlePaste?.(view, {} as any, new Slice(Fragment.from(schema.text(url)), 0, 0))

    expect(handled).toBe(true)
    await flushPasteHandler()
    expect(view.state.doc.textContent).toBe('Profile Name')
    expect(view.state.doc.nodeAt(0)?.marks[0]?.attrs.href).toBe(
      'hm://z6MkfopTfn1vwUZiPsFK82w8BTuV4ewV6zZKaU4sTtnuU5bt/:profile',
    )
  })
})

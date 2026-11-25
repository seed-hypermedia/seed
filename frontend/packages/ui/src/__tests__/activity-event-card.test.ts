import type {HMBlockNode, HMComment} from '@seed-hypermedia/client/hm-types'
import {contentToText} from '@shm/shared/content-to-text'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it} from 'vitest'
import {
  getCommentAction,
  getCommentQuote,
  getEventTime,
  withMediaThumbnails,
  withoutMedia,
} from '../activity-event-card'

function paragraph(id: string, text: string): HMBlockNode {
  return {block: {id, type: 'Paragraph', text, annotations: [], attributes: {}} as any, children: []}
}

function embed(id: string, link: string): HMBlockNode {
  return {block: {id, type: 'Embed', link, text: '', annotations: [], attributes: {view: 'Content'}} as any}
}

function image(id: string, link: string): HMBlockNode {
  return {block: {id, type: 'Image', link, text: '', annotations: [], attributes: {}} as any}
}

function comment(
  content: HMBlockNode[],
): Pick<HMComment, 'content' | 'targetAccount' | 'targetPath' | 'targetVersion'> {
  return {content, targetAccount: 'space', targetPath: '/notes', targetVersion: 'v1'}
}

describe('getCommentQuote', () => {
  it("splits off an embed of a block in the comment's own document", () => {
    const {quoteId, body} = getCommentQuote(
      comment([embed('q', 'hm://space/notes?v=v1#block1'), paragraph('p', 'My reply')]),
    )
    expect(quoteId).toMatchObject({uid: 'space', path: ['notes'], blockRef: 'block1'})
    expect(body.map((node) => node.block.id)).toEqual(['p'])
  })

  it('keeps the comment text stored under the quote as the body', () => {
    // How block comments are actually written: the text is the quote Embed's children, with no blocks after it.
    const quote = {
      ...embed('q', 'hm://space/notes?v=v1#block1'),
      children: [paragraph('p1', 'First'), paragraph('p2', 'Second')],
    }
    const {quoteId, body} = getCommentQuote(comment([quote, paragraph('p3', 'After')]))
    expect(quoteId).not.toBeNull()
    expect(body.map((node) => node.block.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('keeps an embed of another document as content', () => {
    const content = [embed('e', 'hm://elsewhere/doc#block1'), paragraph('p', 'Look at this')]
    expect(getCommentQuote(comment(content))).toEqual({quoteId: null, body: content})
  })

  it('keeps an embed of the whole document, without a block, as content', () => {
    const content = [embed('e', 'hm://space/notes?v=v1'), paragraph('p', 'About the doc')]
    expect(getCommentQuote(comment(content)).quoteId).toBeNull()
  })

  it('only treats the first block as a quote', () => {
    const content = [paragraph('p', 'Intro'), embed('q', 'hm://space/notes?v=v1#block1')]
    expect(getCommentQuote(comment(content)).quoteId).toBeNull()
  })
})

describe('withoutMedia', () => {
  it('drops images, even nested ones, so a quote never shows their ipfs link', () => {
    const content = [
      image('i', 'ipfs://bafyimage'),
      {...paragraph('p', 'Thanks!'), children: [image('n', 'ipfs://bafynested')]},
    ]
    // Without it, the image's link would leak into the text.
    expect(contentToText({content, lineBreaks: false})).toContain('ipfs://')
    expect(contentToText({content: withoutMedia(content), lineBreaks: false})).toBe('Thanks!')
  })
})

describe('withMediaThumbnails', () => {
  it('shrinks images in place, keeping their position and the text around them', () => {
    const content = [paragraph('a', 'Before'), image('i', 'ipfs://bafyimage'), paragraph('b', 'After')]
    const result = withMediaThumbnails(content)
    expect(result.map((node) => node.block.id)).toEqual(['a', 'i', 'b'])
    expect((result[1]!.block as any).attributes.width).toBe(160)
    expect(result[0]).toEqual(content[0])
  })
})

describe('getCommentAction', () => {
  const author = {id: hmId('eric'), metadata: {name: 'Eric'}}
  const bea = {id: hmId('bea'), metadata: {name: 'Bea'}}
  const parent = {id: 'bea/parent'} as HMComment

  it('describes a top-level comment as commented on', () => {
    expect(getCommentAction({author, replyingComment: null, replyParentAuthor: null})).toEqual({kind: 'commented'})
  })

  it('names who a reply answers', () => {
    expect(getCommentAction({author, replyingComment: parent, replyParentAuthor: bea})).toEqual({
      kind: 'replied-to',
      parentAuthor: bea,
    })
  })

  it('says only replied when someone answers their own comment, or the parent author is unknown', () => {
    expect(getCommentAction({author, replyingComment: parent, replyParentAuthor: author})).toEqual({kind: 'replied'})
    expect(getCommentAction({author, replyingComment: parent, replyParentAuthor: null})).toEqual({kind: 'replied'})
  })
})

describe('getEventTime', () => {
  const docUpdate = (time: unknown, createTime: unknown) =>
    ({type: 'doc-update', time, document: {createTime}}) as unknown as Parameters<typeof getEventTime>[0]

  it('keeps the event time when it is known', () => {
    expect(getEventTime(docUpdate('2026-10-19T12:00:00Z', ''))).toBe('2026-10-19T12:00:00Z')
  })

  it("dates a home document's zero-time genesis by the document's creation time", () => {
    expect(getEventTime(docUpdate('1970-01-01T00:00:00Z', '2026-05-05T13:24:00Z'))).toBe('2026-05-05T13:24:00Z')
  })

  it('shows no date rather than 1970 when nothing is known', () => {
    expect(getEventTime(docUpdate('1970-01-01T00:00:00Z', ''))).toBeNull()
  })
})

import {QueryClient} from '@tanstack/react-query'
import {describe, expect, it} from 'vitest'
import type {HMBlockNode, HMComment} from '@seed-hypermedia/client/hm-types'
import {getCommentAffectedDocumentIds, invalidateAfterCommentPublish} from '../comment-invalidation'
import {queryKeys} from '../models/query-keys'
import {hmId} from '../utils/entity-id-url'

const uid = 'z6MkTestUser123'
const target = hmId(uid, {path: ['target'], version: 'bafyTarget'})
const embedded = hmId(uid, {path: ['embedded']})
const linked = hmId(uid, {path: ['linked']})
const mentioned = hmId(uid, {path: ['mentioned']})
const unrelated = hmId(uid, {path: ['unrelated']})

function paragraph(id: string, annotations: any[] = []): HMBlockNode {
  return {block: {id, type: 'Paragraph', text: 'hello world', attributes: {}, annotations}, children: []} as HMBlockNode
}

/** A comment that cites three documents: one embedded, one linked, one mentioned inline. */
const citingContent: HMBlockNode[] = [
  {
    block: {
      id: 'e1',
      type: 'Embed',
      text: '',
      attributes: {view: 'Content'},
      annotations: [],
      link: `${embedded.id}?v=bafyEmbedded#blk1`,
    },
    children: [
      paragraph('p1', [{type: 'Link', link: linked.id, starts: [0], ends: [5]}]),
      paragraph('p2', [{type: 'Embed', link: mentioned.id, starts: [6], ends: [7]}]),
    ],
  } as HMBlockNode,
]

function comment(overrides: Partial<HMComment> = {}): Pick<HMComment, 'content' | 'replyParent'> {
  return {content: [paragraph('p0')], replyParent: '', ...overrides}
}

/** Fills a cache with one settled query per key and returns a way to read which were invalidated. */
function cacheWith(entries: [readonly unknown[], unknown][]) {
  const qc = new QueryClient()
  for (const [key, data] of entries) qc.setQueryData(key, data)
  return {
    qc,
    invalidated: () =>
      qc
        .getQueryCache()
        .getAll()
        .filter((query) => query.state.isInvalidated)
        .map((query) => JSON.stringify(query.queryKey)),
    key: (queryKey: readonly unknown[]) => JSON.stringify(queryKey),
  }
}

describe('documents affected by a new comment', () => {
  it('is only the target for a comment that cites nothing', () => {
    expect([...getCommentAffectedDocumentIds(target, [paragraph('p0')])]).toEqual([target.id])
  })

  it('adds every document the comment embeds, links or mentions, without versions or block refs', () => {
    expect([...getCommentAffectedDocumentIds(target, citingContent)].sort()).toEqual(
      [target.id, embedded.id, linked.id, mentioned.id].sort(),
    )
  })
})

describe('refreshing the cache after a comment is published', () => {
  it('refreshes the comment count of the target and of every cited document, and no other', () => {
    const summary = (id: {id: string}) => [queryKeys.DOCUMENT_INTERACTION_SUMMARY, id.id] as const
    const {qc, invalidated, key} = cacheWith(
      [target, embedded, linked, mentioned, unrelated].map((id) => [summary(id), {comments: 0}]),
    )

    invalidateAfterCommentPublish(qc, {targetId: target, comment: comment({content: citingContent})})

    expect(invalidated().sort()).toEqual([target, embedded, linked, mentioned].map((id) => key(summary(id))).sort())
  })

  it('leaves the other documents on a page alone when the comment cites nothing', () => {
    const others = Array.from({length: 80}, (_, i) => hmId(uid, {path: [`doc-${i}`]}))
    const {qc, invalidated, key} = cacheWith([
      [[queryKeys.DOCUMENT_INTERACTION_SUMMARY, target.id], {comments: 0}],
      ...others.map((id) => [[queryKeys.DOCUMENT_INTERACTION_SUMMARY, id.id], {comments: 0}] as [unknown[], unknown]),
    ])

    invalidateAfterCommentPublish(qc, {targetId: target, comment: comment()})

    expect(invalidated()).toEqual([key([queryKeys.DOCUMENT_INTERACTION_SUMMARY, target.id])])
  })

  it('refreshes comment lists of affected documents whatever version or block they were asked for', () => {
    const targetLatest = {...target, version: null, latest: true}
    const embeddedBlock = {...embedded, blockRef: 'blk1'}
    const {qc, invalidated, key} = cacheWith([
      [[queryKeys.DOCUMENT_COMMENTS, target], {comments: []}],
      [[queryKeys.DOCUMENT_COMMENTS, unrelated], {comments: []}],
      [[queryKeys.DOCUMENT_DISCUSSION, targetLatest, 'author/root'], {}],
      [[queryKeys.DOCUMENT_DISCUSSION, unrelated, undefined], {}],
      [[queryKeys.BLOCK_DISCUSSIONS, embeddedBlock], {comments: []}],
      [[queryKeys.BLOCK_DISCUSSIONS, {...unrelated, blockRef: 'blk1'}], {comments: []}],
    ])

    invalidateAfterCommentPublish(qc, {targetId: target, comment: comment({content: citingContent})})

    expect(invalidated().sort()).toEqual(
      [
        key([queryKeys.DOCUMENT_COMMENTS, target]),
        key([queryKeys.DOCUMENT_DISCUSSION, targetLatest, 'author/root']),
        key([queryKeys.BLOCK_DISCUSSIONS, embeddedBlock]),
      ].sort(),
    )
  })

  it('refreshes only the query blocks that list an affected document', () => {
    const listing = (ids: {id: string}[]) => ({
      results: ids.map((id) => ({id})),
      interactionSummaries: Object.fromEntries(ids.map((id) => [id.id, {comments: 0}])),
    })
    const {qc, invalidated, key} = cacheWith([
      [[queryKeys.QUERY_BLOCK, {name: 'lists target'}], listing([target, unrelated])],
      [[queryKeys.QUERY_BLOCK, {name: 'lists cited'}], listing([linked])],
      [[queryKeys.QUERY_BLOCK, {name: 'lists neither'}], listing([unrelated])],
      [[queryKeys.QUERY_BLOCK, null], null],
    ])

    invalidateAfterCommentPublish(qc, {targetId: target, comment: comment({content: citingContent})})

    expect(invalidated().sort()).toEqual(
      [
        key([queryKeys.QUERY_BLOCK, {name: 'lists target'}]),
        key([queryKeys.QUERY_BLOCK, {name: 'lists cited'}]),
      ].sort(),
    )
  })

  it('refreshes reply counts up the thread of a reply, and none for a top-level comment', () => {
    const entries: [readonly unknown[], unknown][] = [
      [
        [queryKeys.DOCUMENT_COMMENTS, target],
        {
          comments: [
            {id: 'a/root', replyParent: ''},
            {id: 'a/middle', replyParent: 'a/root'},
            {id: 'a/sibling', replyParent: 'a/root'},
          ],
        },
      ],
      [[queryKeys.COMMENT_REPLY_COUNT, 'a/root'], 2],
      [[queryKeys.COMMENT_REPLY_COUNT, 'a/middle'], 0],
      [[queryKeys.COMMENT_REPLY_COUNT, 'a/sibling'], 0],
    ]
    const reply = cacheWith(entries)
    invalidateAfterCommentPublish(reply.qc, {targetId: target, comment: comment({replyParent: 'a/middle'})})
    expect(reply.invalidated()).toEqual(
      expect.arrayContaining([
        reply.key([queryKeys.COMMENT_REPLY_COUNT, 'a/root']),
        reply.key([queryKeys.COMMENT_REPLY_COUNT, 'a/middle']),
      ]),
    )
    expect(reply.invalidated()).not.toContain(reply.key([queryKeys.COMMENT_REPLY_COUNT, 'a/sibling']))

    const topLevel = cacheWith(entries)
    invalidateAfterCommentPublish(topLevel.qc, {targetId: target, comment: comment()})
    expect(topLevel.invalidated().filter((k) => k.includes(queryKeys.COMMENT_REPLY_COUNT))).toEqual([])
  })

  it('refreshes open activity feeds', () => {
    const {qc, invalidated, key} = cacheWith([[[queryKeys.ACTIVITY_FEED, unrelated.id], {pages: []}]])

    invalidateAfterCommentPublish(qc, {targetId: target, comment: comment()})

    expect(invalidated()).toEqual([key([queryKeys.ACTIVITY_FEED, unrelated.id])])
  })
})

import {describe, expect, it, vi} from 'vitest'
import {ListEvents, listBlockCitationEvents} from '../api-activity'

// ListEvents builds its own request cache; hand it the same stub the other tests pass in.
vi.mock('../request-cache', () => ({createRequestCache: () => makeCache()}))

const paper = 'hm://z6MkOwner/paper'

/** A ListCitations row the way the gRPC client hands it over: a message with toJson(). */
function citation(row: Record<string, unknown>) {
  return {toJson: () => row}
}

// One page of ListCitations for a paper citing its own bibliography: entry ref-14 from two
// paragraphs, ref-15 from one, and a comment quoting ref-14.
const rows = [
  citation({
    source: paper,
    sourceType: 'Ref',
    sourceContext: 'p1',
    citationType: 'doc/Link',
    sourceBlob: {cid: 'bafyRef', author: 'z6MkOwner', createTime: '2026-10-14T07:51:52.259Z'},
    target: paper,
    targetFragment: 'ref-14',
  }),
  citation({
    source: paper,
    sourceType: 'Ref',
    sourceContext: 'p2',
    citationType: 'doc/Link',
    sourceBlob: {cid: 'bafyRef2', author: 'z6MkOwner', createTime: '2026-10-15T09:00:00.000Z'},
    target: paper,
    targetFragment: 'ref-14',
  }),
  citation({
    source: paper,
    sourceType: 'Ref',
    sourceContext: 'p3',
    citationType: 'doc/Link',
    sourceBlob: {cid: 'bafyRef', author: 'z6MkOwner', createTime: '2026-10-14T07:51:52.259Z'},
    target: paper,
    targetFragment: 'ref-15',
  }),
  citation({
    source: 'hm://z6MkReader/z6FUAnpExKUZwX',
    sourceType: 'Comment',
    sourceContext: 'c1',
    citationType: 'comment/Embed',
    sourceBlob: {cid: 'bafyComment', author: 'z6MkReader', createTime: '2026-10-16T09:00:00.000Z'},
    sourceDocument: paper,
    target: paper,
    targetFragment: 'ref-14',
  }),
]

function makeCache() {
  return {
    getAccount: vi.fn(async (uid: string) => ({id: {uid}, metadata: {name: uid}})),
    getDocument: vi.fn(async () => {
      throw new Error('document unavailable')
    }),
    getComment: vi.fn(async () => {
      throw new Error('comment unavailable')
    }),
    getCommentReplyCount: vi.fn(async () => 0),
    getContacts: vi.fn(async () => []),
  } as any
}

describe('listBlockCitationEvents', () => {
  it('lists one entry per block citing the target block, newest first, from one ListCitations page', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const listCitations = vi.fn().mockResolvedValue({citations: rows})
    const grpcClient = {resources: {listCitations}} as any
    const cache = makeCache()

    try {
      const result = await listBlockCitationEvents(
        grpcClient,
        {filterResource: paper, targetBlockId: 'ref-14', currentAccount: undefined},
        cache,
      )

      expect(listCitations).toHaveBeenCalledWith({iri: paper, pageSize: 500})
      expect(result.nextPageToken).toBe('')
      expect(result.events).toHaveLength(2)
      const [newer, older] = result.events as any[]
      expect(newer.type).toBe('citation')
      expect(newer.citationType).toBe('d')
      expect([newer.source.id.blockRef, older.source.id.blockRef]).toEqual(['p2', 'p1'])
      expect(newer.target.id.blockRef).toBe('ref-14')
      expect(newer.id).not.toBe(older.id)
      expect(newer.feedEventId).not.toBe(older.feedEventId)
      expect(newer.eventAtMs).toBeGreaterThan(older.eventAtMs)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('reads the citing document at its latest version, not at the Ref blob the row names', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const grpcClient = {resources: {listCitations: vi.fn().mockResolvedValue({citations: rows})}} as any
    const cache = makeCache()

    try {
      const result = await listBlockCitationEvents(grpcClient, {filterResource: paper, targetBlockId: 'ref-15'}, cache)
      expect(result.events).toHaveLength(1)
      expect((result.events[0] as any).source.id.version).toBeNull()
      expect(cache.getDocument).toHaveBeenCalledWith({account: 'z6MkOwner', path: '/paper', version: undefined})
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('ListEvents', () => {
  it('resolves a document attribute naming an account instead of dropping the event', async () => {
    const site = 'z6MkhUgmuFYwEDED4P5EdPKqh35ybJprcGxaVpK9u3H8vpGh'
    const owner = 'z6Mkj6fUDHMAvGm1MRqtjrBH5vLX5gQnDYh2f74NRFfccbVt'
    const cid = 'bafyreih34oqhzivq6xhrsetg3tgrcnrmg4giwysh34wktgcz6ph736kxka'
    const feed = {
      events: [
        {
          account: site,
          eventTime: '2026-11-17T16:47:14.812Z',
          observeTime: '2026-11-17T16:47:18Z',
          newMention: {
            source: `hm://${site}/tasks/comment-on-web-crashes`,
            sourceType: 'metadata/Link',
            sourceContext: 'Owner',
            sourceBlob: {cid, author: site, createTime: '2026-11-17T16:47:14.812Z'},
            sourceDocument: '',
            target: `hm://${owner}`,
            targetVersion: '',
            targetFragment: '',
          },
        },
      ],
      nextPageToken: '',
    }
    const listEvents = vi.fn(async () => ({toJson: () => feed}))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await ListEvents.getData(
        {activityFeed: {listEvents}} as any,
        {
          filterEventType: ['metadata/Link'],
        } as any,
        (async () => null) as any,
      )

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({
        type: 'citation',
        citationType: 'd',
        metadataKey: 'Owner',
        feedEventId: `mention-${cid}--hm://${owner}`,
        target: {id: {uid: owner}},
        source: {id: {uid: site, path: ['tasks', 'comment-on-web-crashes']}},
      })
      expect(warnSpy).not.toHaveBeenCalledWith('Unknown event type: metadata/link')
    } finally {
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})

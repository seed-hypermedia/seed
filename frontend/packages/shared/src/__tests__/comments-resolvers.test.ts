import {describe, expect, it, vi} from 'vitest'
import {createDiscussionsResolver} from '../models/comments-resolvers'
import {hmId} from '../utils/entity-id-url'

const targetDocId = hmId('z6MkTargetAccount', {path: ['notes', 'layout-problems']})
const citingDocId = hmId('z6MkTargetAccount', {path: ['design', 'pending-us']})

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'z6MkCommentAuthor/z6TsidCiting',
    version: 'bafyCommentVersion',
    author: 'z6MkCommentAuthor',
    targetAccount: citingDocId.uid,
    targetPath: '/design/pending-us',
    targetVersion: 'bafyTargetVersion',
    replyParent: '',
    replyParentVersion: '',
    threadRoot: '',
    threadRootVersion: '',
    capability: '',
    content: [
      {
        children: [],
        block: {
          type: 'Paragraph',
          id: 'blk1',
          revision: 'a',
          attributes: {},
          annotations: [],
          text: 'a comment that links to the target doc',
          link: '',
        },
      },
    ],
    createTime: {seconds: 1754000000, nanos: 0},
    updateTime: {seconds: 1754000000, nanos: 0},
    visibility: 'PUBLIC',
    ...overrides,
  }
}

function makeGrpcClient({
  listComments = vi.fn().mockResolvedValue({comments: []}),
  getComment = vi.fn().mockRejectedValue(new Error('not found')),
  listCitations = vi.fn().mockResolvedValue({citations: []}),
  getDocument = vi.fn().mockResolvedValue({metadata: undefined}),
  getAccount = vi.fn().mockRejectedValue(new Error('account not found')),
} = {}) {
  return {
    comments: {listComments, getComment},
    resources: {listCitations},
    documents: {getDocument, getAccount},
  } as any
}

describe('createDiscussionsResolver', () => {
  // Regression test for https://github.com/seed-hypermedia/seed/issues/921:
  // the backend reports citation.sourceDocument as the requested IRI for every
  // comment citation, so the resolver must not rely on it to find the citing
  // comment's own document.
  it('renders a comment on another document that links here as a citing discussion', async () => {
    const citingComment = makeComment()
    const client = makeGrpcClient({
      listComments: vi.fn().mockImplementation(async ({targetPath}) =>
        targetPath === '/design/pending-us' ? {comments: [citingComment]} : {comments: []},
      ),
      getComment: vi.fn().mockImplementation(async ({id}) => {
        if (id !== citingComment.id) throw new Error('not found')
        return citingComment
      }),
      listCitations: vi.fn().mockResolvedValue({
        citations: [
          {
            source: `hm://${citingComment.id}`,
            sourceType: 'Comment',
            // The backend (wrongly) reports the requested doc here; the resolver
            // must ignore it and resolve the comment's real target itself.
            sourceDocument: targetDocId.id,
            target: targetDocId.id,
          },
        ],
      }),
    })

    const result = await createDiscussionsResolver(client)(targetDocId)

    expect(result.discussions).toEqual([])
    expect(result.citingDiscussions).toHaveLength(1)
    const group = result.citingDiscussions[0]!
    expect(group.type).toBe('externalCommentGroup')
    expect(group.id).toBe(`hm://${citingComment.id}`)
    expect(group.comments[0]?.id).toBe(citingComment.id)
    expect(group.target.id.id).toBe(citingDocId.id)
  })

  it('does not duplicate a citing comment that links to this document multiple times', async () => {
    const citingComment = makeComment()
    const getComment = vi.fn().mockResolvedValue(citingComment)
    const client = makeGrpcClient({
      listComments: vi.fn().mockImplementation(async ({targetPath}) =>
        targetPath === '/design/pending-us' ? {comments: [citingComment]} : {comments: []},
      ),
      getComment,
      listCitations: vi.fn().mockResolvedValue({
        citations: [
          {source: `hm://${citingComment.id}`, sourceType: 'Comment', sourceDocument: targetDocId.id},
          {source: `hm://${citingComment.id}`, sourceType: 'Comment', sourceDocument: targetDocId.id},
        ],
      }),
    })

    const result = await createDiscussionsResolver(client)(targetDocId)

    expect(getComment).toHaveBeenCalledTimes(1)
    expect(result.citingDiscussions).toHaveLength(1)
  })

  it('does not treat comments of this document as citing discussions', async () => {
    const directComment = makeComment({
      id: 'z6MkCommentAuthor/z6TsidDirect',
      targetPath: '/notes/layout-problems',
    })
    const getComment = vi.fn().mockRejectedValue(new Error('should not be called'))
    const client = makeGrpcClient({
      listComments: vi.fn().mockImplementation(async ({targetPath}) =>
        targetPath === '/notes/layout-problems' ? {comments: [directComment]} : {comments: []},
      ),
      getComment,
      listCitations: vi.fn().mockResolvedValue({
        citations: [{source: `hm://${directComment.id}`, sourceType: 'Comment', sourceDocument: targetDocId.id}],
      }),
    })

    const result = await createDiscussionsResolver(client)(targetDocId)

    expect(getComment).not.toHaveBeenCalled()
    expect(result.discussions).toHaveLength(1)
    expect(result.citingDiscussions).toEqual([])
  })

  it('skips a citing comment that cannot be loaded instead of failing the request', async () => {
    const client = makeGrpcClient({
      getComment: vi.fn().mockRejectedValue(new Error('comment has been deleted')),
      listCitations: vi.fn().mockResolvedValue({
        citations: [{source: 'hm://z6MkOther/z6TsidGone', sourceType: 'Comment', sourceDocument: targetDocId.id}],
      }),
    })

    const result = await createDiscussionsResolver(client)(targetDocId)

    expect(result.discussions).toEqual([])
    expect(result.citingDiscussions).toEqual([])
  })
})

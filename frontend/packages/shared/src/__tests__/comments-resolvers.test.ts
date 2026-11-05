import {describe, expect, it, vi} from 'vitest'
import {createCommentsByReferenceResolver, createDiscussionsResolver} from '../models/comments-resolvers'
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
  it('returns only comments targeting the requested document and makes no citation calls', async () => {
    const directComment = makeComment({
      id: 'z6MkCommentAuthor/z6TsidDirect',
      targetPath: '/notes/layout-problems',
    })
    const listComments = vi
      .fn()
      .mockImplementation(async ({targetPath}) =>
        targetPath === '/notes/layout-problems' ? {comments: [directComment]} : {comments: []},
      )
    const getComment = vi.fn().mockRejectedValue(new Error('should not be called'))
    const listCitations = vi.fn().mockRejectedValue(new Error('should not be called'))
    const client = makeGrpcClient({listComments, getComment, listCitations})

    const result = await createDiscussionsResolver(client)(targetDocId)

    expect(listCitations).not.toHaveBeenCalled()
    expect(getComment).not.toHaveBeenCalled()
    expect(result.discussions).toHaveLength(1)
    expect(result.discussions[0]!.comments[0]?.id).toBe(directComment.id)
  })

  it('returns an empty discussion list when the document has no comments', async () => {
    const listCitations = vi.fn().mockRejectedValue(new Error('should not be called'))
    const client = makeGrpcClient({listCitations})

    const result = await createDiscussionsResolver(client)(targetDocId)

    expect(listCitations).not.toHaveBeenCalled()
    expect(result.discussions).toEqual([])
  })
})

describe('block discussion references', () => {
  const blockId = 'selected'
  const referencedComment = (id: string, fragment: string) =>
    makeComment({
      id,
      targetAccount: targetDocId.uid,
      targetPath: '/notes/layout-problems',
      content: [
        {block: {id: 'quote', type: 'Embed', link: targetDocId.id + '#' + fragment, attributes: {view: 'Content'}}},
      ],
    })

  it('includes whole-block and any fragment references even when citations are absent', async () => {
    const whole = referencedComment('author/whole', blockId)
    const fragment = referencedComment('author/fragment', blockId + '[79:93]')
    const otherFragment = referencedComment('author/other-range', blockId + '[0:5]')
    const unrelated = referencedComment('author/unrelated', 'another-block')
    const client = makeGrpcClient({
      listComments: vi.fn().mockResolvedValue({comments: [whole, fragment, otherFragment, unrelated]}),
    })
    const result = await createCommentsByReferenceResolver(client)(
      {...targetDocId, blockRef: blockId, blockRange: {start: 79, end: 93}},
      blockId,
    )
    expect(result.comments.map((c) => c.id)).toEqual([whole.id, fragment.id, otherFragment.id])
  })

  it('reads later pages and finds nested inline references without matching another document', async () => {
    const matching = makeComment({
      id: 'author/inline',
      content: [
        {
          block: {id: 'parent', type: 'Paragraph', text: 'Parent'},
          children: [
            {
              block: {
                id: 'child',
                type: 'Paragraph',
                text: 'reference',
                annotations: [{type: 'Link', link: targetDocId.id + '#selected[2:6]', starts: [0], ends: [9]}],
              },
            },
          ],
        },
      ],
    })
    const otherDocument = makeComment({
      id: 'author/other-document',
      content: [{block: {id: 'quote', type: 'Embed', link: citingDocId.id + '#selected'}}],
    })
    const client = makeGrpcClient({
      listComments: vi
        .fn()
        .mockImplementation(async ({pageToken}) =>
          pageToken
            ? {comments: [matching], nextPageToken: ''}
            : {comments: [otherDocument], nextPageToken: 'page-two'},
        ),
    })
    const result = await createCommentsByReferenceResolver(client)(targetDocId, blockId)
    expect(result.comments.map((c) => c.id)).toEqual([matching.id])
  })

  it('keeps available comments when another citation is unavailable and removes duplicate citations', async () => {
    const comment = referencedComment('author/available', blockId)
    const client = makeGrpcClient({
      listCitations: vi.fn().mockResolvedValue({
        citations: [
          {source: 'hm://author/missing', sourceType: 'Comment', targetFragment: blockId},
          {source: 'hm://author/available', sourceType: 'Comment', targetFragment: blockId + '[0:5]'},
          {source: 'hm://author/available', sourceType: 'Comment', targetFragment: blockId},
        ],
      }),
      getComment: vi.fn().mockImplementation(async ({id}) => {
        if (id === comment.id) return comment
        throw new Error('not found')
      }),
    })
    const result = await createCommentsByReferenceResolver(client)(targetDocId, blockId)
    expect(result.comments.map((c) => c.id)).toEqual([comment.id])
  })
})

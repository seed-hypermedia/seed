// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import type {HMBlockEmbed, HMComment} from '@seed-hypermedia/client/hm-types'
import type {NavRoute} from '@shm/shared'
import {hmId, packHmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {BlockEmbedCard, BlockEmbedContent, BlockEmbedContentComment, BlockEmbedLink} from '../embed-views'
import {TooltipProvider} from '../tooltip'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const {currentRoute, resourceId, routeLinkMock, blockNode} = vi.hoisted(() => ({
  currentRoute: {
    value: null as unknown as NavRoute,
  },
  blockNode: {
    block: {id: 'block-1', type: 'Paragraph', text: 'quoted block', attributes: {}, annotations: []},
    children: [],
  },
  resourceId: {
    id: 'hm://uid-1/doc',
    uid: 'uid-1',
    path: ['doc'],
    version: null,
    latest: true,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: null,
  },
  routeLinkMock: vi.fn(),
}))

vi.mock('@shm/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/shared')>()
  return {
    ...actual,
    useRouteLink: (route: unknown) => {
      routeLinkMock(route)
      return {href: '#embed-target', onClick: vi.fn()}
    },
    useUniversalClient: () => ({}),
    queryChanges: () => ({
      queryKey: ['CHANGES', 'hm://uid-1/doc'],
      queryFn: async () => ({
        changes: [
          {id: 'A', deps: [], createTime: '2024-01-01'},
          {id: 'B', deps: ['A'], createTime: '2024-01-02'},
          {id: 'C', deps: ['B'], createTime: '2024-01-03'},
        ],
        latestVersion: 'C',
      }),
    }),
    queryResource: (_client: unknown, requestedId: {id?: string; version?: string | null} | null) => ({
      queryKey: ['ENTITY', requestedId?.id, requestedId?.version],
      queryFn: async () =>
        requestedId?.version === 'B'
          ? {
              type: 'document',
              id: requestedId,
              document: {content: [blockNode], metadata: {}, authors: [], version: 'B'},
            }
          : null,
    }),
  }
})

vi.mock('@shm/shared/models/entity', () => ({
  useResolvedHmId: (url: string) => ({id: unpackHmId(url), isLoading: false, error: null}),
  useResource: (id: {version?: string | null} | null) => ({
    data: {
      type: 'document',
      id: resourceId,
      document: {
        metadata: {name: 'Embedded document card'},
        authors: [],
        // The pinned version still has the quoted block; the latest version does not.
        content: id?.version ? [blockNode] : [],
        version: id?.version ?? 'version-1',
        visibility: 'PUBLIC',
      },
    },
    isInitialLoading: false,
    isError: false,
    isTombstone: false,
  }),
  useAccount: () => ({data: null, isLoading: false}),
  useResources: () => [],
}))

vi.mock('@shm/shared/models/interaction-summary', () => ({
  useInteractionSummary: () => ({data: null}),
}))

vi.mock('../embed-wrapper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../embed-wrapper')>()
  return {
    ...actual,
    EmbedWrapper: ({
      children,
      openOnClick,
      route,
      viewType,
      keepVersion,
    }: React.PropsWithChildren<EmbedWrapperTestProps>) => (
      <div
        data-testid="embed-wrapper"
        data-open-on-click={String(openOnClick)}
        data-route-key={route?.key ?? ''}
        data-route={JSON.stringify(route ?? null)}
        data-view={viewType}
        data-keep-version={String(keepVersion ?? false)}
      >
        {children}
      </div>
    ),
  }
})

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavigate: () => vi.fn(),
  useNavRoute: () => currentRoute.value,
}))

vi.mock('../comments', () => ({
  CommentContent: () => <div data-testid="comment-content" />,
  Discussions: () => <div data-testid="discussions" />,
}))

vi.mock('../hm-icon', () => ({
  HMIcon: () => <div data-testid="hm-icon" />,
}))

vi.mock('../text', () => ({
  SizableText: ({children}: {children: React.ReactNode}) => <span>{children}</span>,
}))

vi.mock('../newspaper', () => ({
  DocumentCard: ({navigate, route, titleLinkOnly}: DocumentCardTestProps) => (
    <div
      data-testid="document-card"
      data-navigate={String(navigate)}
      data-route={JSON.stringify(route ?? null)}
      data-title-link-only={String(titleLinkOnly)}
    />
  ),
}))

type EmbedWrapperTestProps = {
  openOnClick?: boolean
  route?: NavRoute
  viewType?: string
  keepVersion?: boolean
}

type DocumentCardTestProps = {
  navigate?: boolean
  route?: NavRoute
  titleLinkOnly?: boolean
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  routeLinkMock.mockReset()
  currentRoute.value = {key: 'document', id: hmId('uid-1', {path: ['doc']})}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function renderBlockEmbedCard({
  openOnClick = true,
  titleLinkOnly = false,
}: {
  openOnClick?: boolean
  titleLinkOnly?: boolean
} = {}) {
  const docId = hmId('uid-1', {path: ['doc']})

  act(() => {
    root.render(
      <BlockEmbedCard
        block={{
          id: 'embed-1',
          type: 'Embed',
          text: '',
          attributes: {view: 'Card', childrenType: 'Group'},
          annotations: [],
          link: packHmId(docId),
        }}
        parentBlockId={null}
        openOnClick={openOnClick}
        titleLinkOnly={titleLinkOnly}
      />,
    )
  })

  return {docId}
}

describe('BlockEmbedCard navigation surface', () => {
  it('puts whole-card navigation on the document card instead of the outer embed wrapper', () => {
    renderBlockEmbedCard()

    const embedWrapper = container.querySelector('[data-testid="embed-wrapper"]') as HTMLElement | null
    expect(embedWrapper).toBeTruthy()
    expect(embedWrapper?.dataset.openOnClick).toBe('false')
    expect(embedWrapper?.dataset.routeKey).toBe('document')
    expect(embedWrapper?.dataset.view).toBe('Card')

    const card = container.querySelector('[data-testid="document-card"]') as HTMLElement | null
    expect(card).toBeTruthy()
    expect(card?.dataset.navigate).toBe('true')
    expect(card?.dataset.titleLinkOnly).toBe('false')
  })

  it('keeps title-only navigation on the document card title without enabling the outer embed wrapper', () => {
    renderBlockEmbedCard({titleLinkOnly: true})

    const embedWrapper = container.querySelector('[data-testid="embed-wrapper"]') as HTMLElement | null
    expect(embedWrapper?.dataset.openOnClick).toBe('false')

    const card = container.querySelector('[data-testid="document-card"]') as HTMLElement | null
    expect(card?.dataset.navigate).toBe('false')
    expect(card?.dataset.titleLinkOnly).toBe('true')
  })

  it('passes the active panel route to whole-card navigation', () => {
    const sourceDocId = hmId('uid-source', {path: ['source']})
    currentRoute.value = {
      key: 'comments',
      id: sourceDocId,
      panel: {key: 'comments', id: sourceDocId, openComment: 'source-comment'},
    }
    const {docId} = renderBlockEmbedCard()

    const card = container.querySelector('[data-testid="document-card"]') as HTMLElement | null
    expect(JSON.parse(card?.dataset.route ?? 'null')).toEqual({
      key: 'document',
      id: unpackHmId(packHmId(docId)),
      panel: {key: 'comments', id: sourceDocId, openComment: 'source-comment'},
    })
  })

  it('passes the active panel route to title-only card navigation', () => {
    const sourceDocId = hmId('uid-source', {path: ['source']})
    currentRoute.value = {
      key: 'comments',
      id: sourceDocId,
      panel: {key: 'comments', id: sourceDocId, openComment: 'source-comment'},
    }
    const {docId} = renderBlockEmbedCard({titleLinkOnly: true})

    const card = container.querySelector('[data-testid="document-card"]') as HTMLElement | null
    expect(JSON.parse(card?.dataset.route ?? 'null')).toEqual({
      key: 'document',
      id: unpackHmId(packHmId(docId)),
      panel: {key: 'comments', id: sourceDocId, openComment: 'source-comment'},
    })
  })
})

function renderHmLinkEmbed(openOnClick: boolean) {
  const docId = hmId('uid-target', {path: ['target']})
  const block: HMBlockEmbed = {
    id: 'embed-link-1',
    type: 'Embed',
    text: '',
    attributes: {view: 'Link', childrenType: 'Group'},
    annotations: [],
    link: packHmId(docId),
  }

  act(() => {
    root.render(<BlockEmbedLink block={block} parentBlockId={null} openOnClick={openOnClick} />)
  })

  return {docId}
}

describe('HM link embed title navigation', () => {
  it('preserves the active panel for title-only navigation', () => {
    const sourceDocId = hmId('uid-source', {path: ['source']})
    currentRoute.value = {
      key: 'comments',
      id: sourceDocId,
      panel: {key: 'comments', id: sourceDocId, openComment: 'source-comment'},
    }
    const {docId} = renderHmLinkEmbed(false)

    expect(routeLinkMock).toHaveBeenLastCalledWith({
      key: 'document',
      id: unpackHmId(packHmId(docId)),
      panel: {key: 'comments', id: sourceDocId, openComment: 'source-comment'},
    })
  })
})

function renderBlockEmbedContentComment(fragment = false, threadRoot?: string) {
  const embeddedCommentId = hmId('uid-comment', {
    path: ['comment'],
    ...(fragment ? {version: 'comment-version', blockRef: 'comment-block', blockRange: {start: 2, end: 8}} : {}),
  })
  const comment: HMComment = {
    id: 'embedded-comment',
    version: 'comment-version',
    author: 'uid-author',
    targetAccount: 'uid-target',
    targetPath: 'target-document',
    targetVersion: 'target-version',
    content: [],
    createTime: {seconds: 0, nanos: 0},
    updateTime: {seconds: 0, nanos: 0},
    visibility: 'PUBLIC',
    ...(threadRoot ? {threadRoot} : {}),
  }
  const block: HMBlockEmbed = {
    id: 'embed-1',
    type: 'Embed',
    text: '',
    attributes: {view: 'Content', childrenType: 'Group'},
    annotations: [],
    link: '',
  }

  act(() => {
    root.render(
      <TooltipProvider>
        <BlockEmbedContentComment
          id={embeddedCommentId}
          parentBlockId={null}
          depth={0}
          block={block}
          comment={comment}
          author={undefined}
          targetResource={undefined}
        />
      </TooltipProvider>,
    )
  })

  const wrapper = container.querySelector('[data-testid="embed-wrapper"]') as HTMLElement | null
  return {embeddedCommentId, wrapper}
}

describe('BlockEmbedContentComment routing', () => {
  it('opens the embedded comment instead of preserving an unrelated panel', () => {
    const sourceDocId = hmId('uid-source', {path: ['source-document']})
    currentRoute.value = {
      key: 'comments',
      id: sourceDocId,
      panel: {key: 'comments', id: sourceDocId, openComment: 'source-comment'},
    }

    const {wrapper} = renderBlockEmbedContentComment()

    expect(JSON.parse(wrapper?.dataset.route ?? 'null')).toEqual({
      key: 'document',
      id: hmId('uid-target', {path: ['target-document'], version: 'target-version'}),
      panel: {
        key: 'comments',
        id: hmId('uid-target', {path: ['target-document'], version: 'target-version'}),
        openComment: 'embedded-comment',
      },
    })
  })

  it('opens the target document with the embedded comment in its panel', () => {
    const {wrapper} = renderBlockEmbedContentComment()

    expect(JSON.parse(wrapper?.dataset.route ?? 'null')).toEqual({
      key: 'document',
      id: hmId('uid-target', {path: ['target-document'], version: 'target-version'}),
      panel: {
        key: 'comments',
        id: hmId('uid-target', {path: ['target-document'], version: 'target-version'}),
        openComment: 'embedded-comment',
      },
    })
  })

  it('opens the thread root with the embedded reply selected when the comment has a threadRoot', () => {
    const {wrapper} = renderBlockEmbedContentComment(false, 'uid-root/root-tsid')

    expect(JSON.parse(wrapper?.dataset.route ?? 'null')).toEqual({
      key: 'document',
      id: hmId('uid-target', {path: ['target-document'], version: 'target-version'}),
      panel: {
        key: 'comments',
        id: hmId('uid-target', {path: ['target-document'], version: 'target-version'}),
        openComment: 'uid-root/root-tsid',
        replyCommentId: 'embedded-comment',
      },
    })
  })
})

describe('comment fragment destinations', () => {
  it('opens the pinned comment fragment even when another comments panel is active', () => {
    const sourceDocId = hmId('uid-source')
    currentRoute.value = {
      key: 'document',
      id: sourceDocId,
      panel: {key: 'comments', id: sourceDocId, openComment: 'other-comment'},
    }
    const {wrapper} = renderBlockEmbedContentComment(true)
    expect(JSON.parse(wrapper?.dataset.route ?? 'null')).toMatchObject({
      key: 'comments',
      id: {uid: 'uid-target', path: ['target-document'], blockRef: 'comment-block', blockRange: {start: 2, end: 8}},
      openComment: 'embedded-comment',
      openCommentVersion: 'comment-version',
      blockId: 'comment-block',
      blockRange: {start: 2, end: 8},
    })
  })
})

describe('BlockEmbedContent pinned block version', () => {
  it('points the source link at the newest version still containing a block missing from latest', async () => {
    const embedId = hmId('uid-1', {path: ['doc'], version: 'A', blockRef: 'block-1'})
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const block: HMBlockEmbed = {
      id: 'embed-1',
      type: 'Embed',
      text: '',
      attributes: {view: 'Content', childrenType: 'Group'},
      annotations: [],
      link: packHmId(embedId),
    }

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <BlockEmbedContent block={block} parentBlockId={null} />
        </QueryClientProvider>,
      )
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const wrapper = container.querySelector('[data-testid="embed-wrapper"]') as HTMLElement | null
    expect(wrapper).toBeTruthy()
    expect(wrapper?.dataset.keepVersion).toBe('true')
    expect(JSON.parse(wrapper?.dataset.route ?? 'null')).toMatchObject({
      key: 'document',
      id: {version: 'B', latest: false, blockRef: 'block-1'},
    })
  })
})

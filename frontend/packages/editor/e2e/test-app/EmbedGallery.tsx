import {ConnectionsPanel} from '@shm/ui/connections-panel'
import {PanelHeader} from '@shm/ui/panel-header'
import {ActivityHeader} from '@shm/ui/activity-panel'
import {MobilePanelSheet} from '@shm/ui/mobile-panel-sheet'
import {DocumentTools} from '@shm/ui/document-tools'
import './tailwind.css'
import '../../src/blocknote/core/style.css'
import '../../src/editor.css'
import React, {useState} from 'react'
import {
  CommentDraftReferenceProvider,
  useCommentDraftReferences,
  CommentsProvider,
} from '@shm/shared/comments-service-provider'
import {CommentsFooterContext, DiscussionsPageContent} from '@shm/ui/discussions-page'
import {PanelLayout} from '@shm/ui/panel-layout'
import {getBlockCommentDraftReference, type CommentEditorProps} from '@shm/ui/resource-page-common'
import {createMachine} from 'xstate'
import {DocumentMachineProvider} from '@shm/shared/models/use-document-machine'
import {createRoot} from 'react-dom/client'
import type {HMBlockEmbed, HMBlockNode, HMComment, HMDocument} from '@seed-hypermedia/client/hm-types'
import {hmId, routeToHref, UniversalAppProvider, writeableStateStream} from '@shm/shared'
import {NavContextProvider, useNavRoute} from '@shm/shared/utils/navigation'
import {CommentContentContext, ReadOnlyViewerProvider} from '@shm/shared/readonly-viewer-context'
import {SelectedAccountContactsProvider} from '@shm/shared/models/contacts'
import {applyOptimisticComment} from '@shm/shared/optimistic-comment'
import {trimTrailingEmptyBlocks} from '@shm/shared/comments'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TooltipProvider} from '@shm/ui/tooltip'
import {ContentEmbed} from '@shm/ui/content-embed'
import {BlockEmbedCard, BlockEmbedContent} from '@shm/ui/embed-views'
import {Comment, QuotedDocBlock} from '@shm/ui/comments'
import {ReadOnlyViewer} from '../../src/readonly-viewer'
import {CommentEditor as DraftEditor} from '../../src/comment-editor'

const account = 'bafy-gallery-author'
const name = 'Alexandra Montgomery Field'
const documentId = hmId(account, {path: ['field-notes'], version: 'v1'})
const text = 'A shared source should keep its meaning, formatting, and identity in every place where it appears.'
const blocks: HMBlockNode[] = [
  {
    block: {
      id: 'intro',
      type: 'Paragraph',
      text,
      attributes: {},
      annotations: [
        {type: 'Bold', starts: [2], ends: [15]},
        {type: 'Link', starts: [16], ends: [22], link: 'https://example.com/source'},
      ],
    },
    children: [],
  },
  {
    block: {
      id: 'detail',
      type: 'Paragraph',
      text: 'The second paragraph remains visible when the complete resource is expanded.',
      attributes: {},
      annotations: [],
    },
    children: [],
  },
]
const previewBlocks: HMBlockNode[] = [
  {
    block: {
      id: 'heading',
      type: 'Heading',
      text: 'A large heading becomes a compact quote',
      attributes: {textAlignment: 'center'},
      annotations: [{type: 'Bold', starts: [0], ends: [15]}],
    },
    children: [],
  },
  {
    block: {
      id: 'image',
      type: 'Image',
      text: 'Tall image preview',
      link:
        'data:image/svg+xml,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="600" height="1000" fill="#ccebdc"/><rect x="40" y="160" width="520" height="780" rx="16" fill="#67ad89"/></svg>',
        ),
      attributes: {},
      annotations: [],
    },
    children: [],
  },
  {
    block: {id: 'video', type: 'Video', link: 'https://www.youtube.com/embed/example', attributes: {autoplay: true}},
    children: [],
  },
]
const document: HMDocument = {
  account,
  path: '/field-notes',
  version: 'v1',
  genesis: 'v1',
  authors: [account],
  metadata: {name: 'Notes on shared context'},
  content: blocks,
  visibility: 'PUBLIC',
  createTime: '2026-10-20T12:00:00Z',
  updateTime: '2026-10-20T12:00:00Z',
} as HMDocument
const comment: HMComment = {
  id: `${account}/comment1`,
  version: 'c1',
  author: account,
  targetAccount: account,
  targetPath: '/field-notes',
  targetVersion: 'v1',
  content: blocks,
  createTime: '2026-10-20T12:00:00Z',
  updateTime: '2026-10-20T12:00:00Z',
  visibility: 'PUBLIC',
}
const threadComments: HMComment[] = [
  {
    ...comment,
    content: [
      {block: {id: 'thread-root', type: 'Paragraph' as const, attributes: {}, text: 'Root comment'}, children: []},
    ],
  },
  ...Array.from({length: 8}, (_, index) => ({
    ...comment,
    id: `${account}/reply${index}`,
    replyParent: index === 1 ? `${account}/reply0` : comment.id,
    threadRoot: comment.id,
    threadRootVersion: comment.version,
    version: `reply-version-${index}`,
    createTime: `2026-10-20T13:0${index}:00Z`,
    content: [
      {
        block: {
          id: `reply-content-${index}`,
          type: 'Paragraph' as const,
          attributes: {},
          text: `Reply ${index}: A reply keeps its place in this conversation.`,
        },
        children: [],
      },
    ],
  })),
]

function ReviewComposer(props: CommentEditorProps) {
  const submit: React.ComponentProps<typeof DraftEditor>['handleSubmit'] = async (getContent, reset) => {
    const {blockNodes} = await getContent(async () => ({blobs: [], resultCIDs: []}))
    const submitted: HMComment = {
      ...comment,
      id: `${account}/submitted-${Date.now()}`,
      version: 'submitted-version',
      replyParent: props.commentId,
      replyParentVersion: props.replyCommentVersion,
      threadRoot: comment.id,
      threadRootVersion: props.rootReplyCommentVersion,
      createTime: new Date().toISOString(),
      content: trimTrailingEmptyBlocks(blockNodes),
    }
    ;(window as any).THREAD_SUBMISSIONS = [...((window as any).THREAD_SUBMISSIONS || []), submitted]
    applyOptimisticComment(queryClient, documentId, submitted)
    props.onCommentSubmitted?.(submitted)
    reset()
  }
  return (
    <div data-testid="thread-composer" data-target={props.commentId} data-version={props.replyCommentVersion}>
      <DraftEditor
        compact
        referenceTarget={{documentId: documentId.id, commentId: props.commentId}}
        documentId={documentId}
        focusOnMount={props.focusOnMount}
        isReplying
        handleSubmit={submit}
        onContentChange={() => {}}
        submitButton={({getContent, reset, disabled}) => (
          <button disabled={disabled} onClick={() => submit(getContent, reset)}>
            Send reply
          </button>
        )}
      />
      <p>12 members will see the comment.</p>
    </div>
  )
}

function ThreadReview() {
  const [target, setTarget] = useState<string>(`${account}/reply1`)
  return (
    <CommentDraftReferenceProvider>
      <div style={{height: 600}}>
        <PanelLayout
          panelKey="comments"
          panelWidth={34}
          onCommentsBack={() => setTarget(comment.id)}
          onPanelClose={() => {}}
          panelContent={
            <CommentsProvider
              onReplyClick={() => {
                throw new Error('Thread reply escaped to navigation')
              }}
            >
              <DiscussionsPageContent
                isPanel
                docId={documentId}
                openComment={`${account}/reply1`}
                replyCommentId={target}
                commentEditor={
                  <ReviewComposer
                    docId={documentId}
                    replyCommentVersion="stale-reply-version"
                    rootReplyCommentVersion="stale-root-version"
                  />
                }
              />
            </CommentsProvider>
          }
        >
          <ReadOnlyViewer blocks={blocks} resourceId={documentId} />
        </PanelLayout>
      </div>
    </CommentDraftReferenceProvider>
  )
}

function ReferenceReview() {
  const references = useCommentDraftReferences()!
  const [mounted, setMounted] = useState(false)
  const [reply, setReply] = useState(false)
  const target = {documentId: documentId.id, commentId: reply ? comment.id : undefined}
  const add = (range: string) => {
    const action = getBlockCommentDraftReference({
      route: {key: 'document', id: documentId, panel: {key: 'comments', id: documentId, openComment: target.commentId}},
      sourceId: documentId,
      version: document.version,
      blockId: 'intro',
      blockRange: range ? {start: 2, end: 15} : undefined,
    })
    references.appendReference(action.reference)
    setMounted(true)
  }
  return (
    <main style={{padding: 24, maxWidth: 600}}>
      <button onClick={() => add('')}>Comment on block</button>
      <button onClick={() => add('[2:15]')}>Comment on fragment</button>
      <button
        onClick={() => {
          setMounted(false)
          setReply(!reply)
        }}
      >
        Switch reply target
      </button>
      <button onClick={() => setMounted(false)}>Close composer</button>
      <p data-testid="reply-target">{reply ? comment.id : 'root'}</p>
      {mounted && (
        <DraftEditor
          compact
          referenceTarget={target}
          initialBlocks={
            (window as any).REFERENCE_DRAFT || [
              {
                block: {id: 'draft-text', type: 'Paragraph', text: 'Keep my draft', attributes: {}, annotations: []},
                children: [],
              },
            ]
          }
          documentId={documentId}
          getDraftMediaBlob={
            (window as any).REFERENCE_HYDRATION
              ? () =>
                  new Promise((resolve) => {
                    ;(window as any).RESOLVE_REFERENCE_MEDIA = () => resolve(null)
                  })
              : undefined
          }
          onContentChange={(content) => {
            ;(window as any).REFERENCE_DRAFT = content
          }}
          handleSubmit={async (getContent) => {
            ;(window as any).REFERENCE_SUBMISSION = await getContent(async () => ({blobs: [], resultCIDs: []}))
          }}
          submitButton={({getContent}) => (
            <button
              onClick={async () => {
                ;(window as any).REFERENCE_SUBMISSION = await getContent(async () => ({blobs: [], resultCIDs: []}))
              }}
            >
              Read submission
            </button>
          )}
        />
      )}
    </main>
  )
}

// Reproduce a comments panel mounted inside a document that is being edited.
const editingMachine = createMachine({
  initial: 'editing',
  context: {canEdit: true},
  states: {editing: {}},
})
const referenceComment: HMBlockNode[] = ['', '[2:63]'].map((range, index) => ({
  block: {
    id: `comment-reference-${index}`,
    type: 'Embed',
    link: `hm://${account}/field-notes?v=v1#intro${range}`,
    attributes: {view: 'Content'},
  },
  children: [],
}))
const client = {
  request: async (method: string, params: any) => {
    if (method === 'ListCitations')
      return {
        citations: [
          {
            source: documentId.id,
            sourceType: 'Ref',
            sourceContext: 'intro',
            sourceBlob: {cid: 'v1', author: account, createTime: '2026-10-20T10:00:00Z'},
          },
          {
            source: documentId.id,
            sourceType: 'Ref',
            sourceContext: 'intro',
            sourceBlob: {cid: 'v1', author: account, createTime: '2026-10-20T10:00:00Z'},
          },
          {
            source: documentId.id,
            sourceType: 'Ref',
            sourceContext: 'detail',
            sourceBlob: {cid: 'v1', author: account, createTime: '2026-10-20T10:00:00Z'},
          },
          {
            source: `hm://${account}/comment1`,
            sourceType: 'Comment',
            sourceDocument: documentId.id,
            sourceContext: 'intro',
            sourceBlob: {cid: 'c1', author: account, createTime: '2026-10-20T10:00:00Z'},
          },
        ],
      }
    if (method === 'ListComments') return {comments: threadComments, authors: {[account]: {metadata: {name}}}}
    if (method === 'Account') return {id: hmId(account), metadata: {name}}
    if (method === 'AccountContacts') return []
    if (method === 'Resource') {
      const requestedComment = threadComments.find((item) => item.id === `${params.uid}/${params.path?.join('/')}`)
      if (requestedComment)
        return {type: 'comment', id: params, comment: (window as any).THREAD_REVIEW ? requestedComment : comment}
      return {
        type: 'document',
        id: params,
        document: params.path?.length ? document : {...document, path: '/', metadata: {name}},
      }
    }
    if (method === 'Interaction' || method === 'InteractionSummary') return {comments: 0, children: 0}
    return null
  },
  publish: async () => ({cids: []}),
}
const [setNavState, navState] = writeableStateStream<any>({
  routes: [
    {
      key: 'document',
      id: hmId(account, {path: ['field-notes'], latest: true}),
      panel: {key: 'comments', id: documentId, openComment: 'kept-thread'},
    },
  ],
  routeIndex: 0,
  lastAction: 'push',
})
;(window as any).GALLERY_NAVIGATION = []
const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}})
const cases = [
  ['Document · full', `hm://${account}/field-notes?v=v1`],
  ['Document · block', `hm://${account}/field-notes?v=v1#intro`],
  ['Heading · block', `hm://${account}/field-notes?v=v1#heading`],
  ['Image · block', `hm://${account}/field-notes?v=v1#image`],
  ['Video · block', `hm://${account}/field-notes?v=v1#video`],
  ['Document · fragment', `hm://${account}/field-notes?v=v1#intro[2:63]`],
  ['Comment · whole', `hm://${account}/comment1?v=c1`],
  ['Comment · fragment', `hm://${account}/comment1?v=c1#intro[2:63]`],
] as const

/** Exercises the production document-tool links with the fixture navigation provider. */
function DocumentToolsReview() {
  const route = useNavRoute()
  return (
    <DocumentTools
      id={documentId}
      currentRoute={route}
      currentPanel={
        route.key === 'document'
          ? route.panel?.key === 'comments'
            ? {...route.panel, id: route.panel.id ?? route.id}
            : route.panel
          : undefined
      }
      commentsCount={4}
      collabsCount={12}
      citationsCount={1}
      collaborators={{
        publisherUid: account,
        parentCapabilities: ['reviewer-one', 'reviewer-two'].map((uid) => ({
          id: uid,
          accountUid: uid,
          role: 'writer',
          grantId: documentId,
          createTime: {seconds: 0, nanos: 0},
        })),
        grantedCapabilities: [],
        grantedMembers: [],
        members: [],
        accounts: Object.fromEntries(
          [account, 'reviewer-one', 'reviewer-two'].map((uid, index) => [
            uid,
            {id: hmId(uid), metadata: {name: ['Alex', 'Gabo', 'Bea'][index]}},
          ]),
        ),
      }}
    />
  )
}

/** Main-section thread with a real editor portaled below the document scroll area. */
function DockedCommentsReview() {
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  return (
    <CommentDraftReferenceProvider>
      <CommentsProvider
        onReplyClick={() => {
          throw new Error('Reply escaped the thread')
        }}
      >
        <div className="flex h-screen min-h-0 flex-col">
          <div data-testid="main-comments-scroll" className="min-h-0 flex-1 overflow-y-auto">
            <header className="mx-auto max-w-3xl p-6">
              <h1>Document header stays visible</h1>
              <DocumentTools
                id={documentId}
                activeTab="comments"
                currentRoute={{key: 'comments', id: documentId, openComment: comment.id}}
              />
            </header>
            <CommentsFooterContext.Provider value={footer}>
              <DiscussionsPageContent
                docId={documentId}
                openComment={comment.id}
                showTitle={false}
                contentMaxWidth={768}
                commentEditor={<ReviewComposer docId={documentId} />}
              />
            </CommentsFooterContext.Provider>
          </div>
          <div ref={setFooter} data-testid="main-comments-footer" className="shrink-0" />
        </div>
      </CommentsProvider>
    </CommentDraftReferenceProvider>
  )
}

/** Mobile drawer with real comment scrolling and composer. */
function MobileCommentsReview() {
  const [open, setOpen] = useState(false)
  return (
    <CommentDraftReferenceProvider>
      <CommentsProvider>
        <button onClick={() => setOpen(true)}>Open mobile comments</button>
        <div className="h-screen">Document behind the drawer</div>
        {open && (
          <MobilePanelSheet
            isOpen
            resizable
            scrollContent={false}
            title="Comments"
            count={12}
            onClose={() => setOpen(false)}
          >
            <DiscussionsPageContent
              isPanel
              docId={documentId}
              openComment={comment.id}
              showTitle={false}
              commentEditor={<ReviewComposer docId={documentId} />}
            />
          </MobilePanelSheet>
        )}
      </CommentsProvider>
    </CommentDraftReferenceProvider>
  )
}

/** Connections with duplicate citations and both document and comment source items. */
function ConnectionsReview() {
  return (
    <div className="mx-auto flex h-screen max-w-lg flex-col">
      <div data-testid="connections-header">
        <PanelHeader title="Connections" count={1} onClose={() => {}} onExpand={() => {}} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ConnectionsPanel docId={documentId} />
      </div>
      <div data-testid="attributes-header">
        <PanelHeader title="Attributes" onClose={() => {}} />
      </div>
      <div data-testid="activity-header">
        <ActivityHeader tab="all-updates" onTabChange={() => {}} onClose={() => {}} />
      </div>
    </div>
  )
}

/** Real production embeds, with fixed data at the network provider boundary. */
function EmbedGallery() {
  return (
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <NavContextProvider value={{state: navState, dispatch: () => {}} as any}>
          <UniversalAppProvider
            universalClient={client as any}
            openUrl={(url) => (window as any).GALLERY_NAVIGATION.push({url})}
            openRoute={(route, replace) => {
              ;(window as any).GALLERY_NAVIGATION.push({route, replace})
              window.history[replace ? 'replaceState' : 'pushState'](null, '', routeToHref(route))
              setNavState({routes: [route], routeIndex: 0, lastAction: replace ? 'replace' : 'push'})
            }}
            openRouteNewWindow={
              (window as any).GALLERY_WEB_NAVIGATION
                ? undefined
                : (route) => (window as any).GALLERY_NAVIGATION.push({newWindowRoute: route})
            }
            hmUrlHref={!(window as any).GALLERY_WEB_NAVIGATION}
          >
            <SelectedAccountContactsProvider>
              <ReadOnlyViewerProvider value={ReadOnlyViewer}>
                {(window as any).CONNECTIONS_REVIEW ? (
                  <ConnectionsReview />
                ) : (window as any).MOBILE_COMMENTS_REVIEW ? (
                  <MobileCommentsReview />
                ) : (window as any).DOCKED_COMMENTS_REVIEW ? (
                  <DockedCommentsReview />
                ) : (window as any).DOCUMENT_TOOLS_REVIEW ? (
                  <DocumentToolsReview />
                ) : (window as any).REFERENCE_REVIEW ? (
                  <React.StrictMode>
                    <CommentDraftReferenceProvider>
                      <ReferenceReview />
                    </CommentDraftReferenceProvider>
                  </React.StrictMode>
                ) : (window as any).THREAD_REVIEW ? (
                  <ThreadReview />
                ) : (
                  <main style={{maxWidth: 1200, margin: '0 auto', padding: 24}}>
                    <h1 style={{fontSize: 24, fontWeight: 600}}>Embed component review</h1>
                    <p style={{fontSize: 13, marginBottom: 24}}>
                      Production components · fixed fixture data · no live app server
                    </p>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 440px), 1fr))',
                        gap: 24,
                      }}
                    >
                      <section data-case="Comment layout">
                        <div className="border-border bg-card rounded-lg border">
                          <Comment comment={comment} authorMetadata={{name}} />
                        </div>
                      </section>
                      <section data-case="Source document">
                        <ReadOnlyViewer blocks={blocks} resourceId={documentId} />
                      </section>
                      <section data-case="Comment under editing document">
                        <DocumentMachineProvider
                          machine={editingMachine as any}
                          input={{documentId, canEdit: true} as any}
                        >
                          <ReadOnlyViewer
                            blocks={referenceComment}
                            resourceId={hmId(account, {path: ['comment2']})}
                            resourceKind="comment"
                            commentStyle
                          />
                        </DocumentMachineProvider>
                      </section>
                      {cases.map(([label, link]) => (
                        <CommentContentContext.Provider key={label} value={label !== 'Video · block'}>
                          <section data-case={label} style={{minWidth: 0}}>
                            <h2 style={{fontSize: 13, fontWeight: 600, marginBottom: 12}}>{label}</h2>
                            {previewBlocks.some((node) => link.endsWith(`#${node.block.id}`)) ? (
                              <ContentEmbed
                                id={hmId(account, {path: ['field-notes'], version: 'v1', blockRef: link.split('#')[1]})}
                                blocks={previewBlocks}
                                route={{
                                  key: 'document',
                                  id: hmId(account, {
                                    path: ['field-notes'],
                                    version: 'v1',
                                    blockRef: link.split('#')[1],
                                  }),
                                }}
                              />
                            ) : (
                              <BlockEmbedContent
                                block={{id: label, type: 'Embed', link, attributes: {view: 'Content'}} as HMBlockEmbed}
                                parentBlockId={null}
                              />
                            )}
                          </section>
                        </CommentContentContext.Provider>
                      ))}
                      <CommentContentContext.Provider value={true}>
                        <section data-case="Reply quote" style={{minWidth: 0}}>
                          <h2 style={{fontSize: 13, fontWeight: 600, marginBottom: 12}}>Reply quote · fragment</h2>
                          <QuotedDocBlock
                            docId={documentId}
                            doc={document}
                            blockId="intro"
                            blockRange={{start: 2, end: 63}}
                          />
                        </section>
                      </CommentContentContext.Provider>
                      <section data-case="Account home card" style={{minWidth: 0}}>
                        <h2 style={{fontSize: 13, fontWeight: 600, marginBottom: 12}}>Account home document · card</h2>
                        <BlockEmbedCard
                          block={
                            {
                              id: 'profile-card',
                              type: 'Embed',
                              link: `hm://${account}`,
                              attributes: {view: 'Card'},
                            } as HMBlockEmbed
                          }
                          parentBlockId={null}
                        />
                      </section>
                      <section data-case="Inline profile mention" style={{minWidth: 0}}>
                        <h2 style={{fontSize: 13, fontWeight: 600, marginBottom: 12}}>Inline profile mention</h2>
                        <ReadOnlyViewer
                          blocks={[
                            {
                              block: {
                                id: 'mention',
                                type: 'Paragraph',
                                text: 'Notes by \uFFFC for the review.',
                                attributes: {},
                                annotations: [
                                  {
                                    type: 'Embed',
                                    link: `hm://${account}`,
                                    starts: [9],
                                    ends: [10],
                                    attributes: {mentionKind: 'account'},
                                  },
                                ],
                              },
                              children: [],
                            },
                          ]}
                        />
                      </section>
                    </div>
                  </main>
                )}
              </ReadOnlyViewerProvider>
            </SelectedAccountContactsProvider>
          </UniversalAppProvider>
        </NavContextProvider>
      </QueryClientProvider>
    </TooltipProvider>
  )
}

createRoot(window.document.getElementById('root')!).render(<EmbedGallery />)

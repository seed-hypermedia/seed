import {useCreateAccount} from '@/auth'
import {useInteractionSummary} from '@/models'
import {useLocation, useNavigate} from '@remix-run/react'
import avatarPlaceholder from '@shm/editor/assets/avatar.png'
import {
  BlockRange,
  HMComment,
  HMDocument,
  HMMetadata,
  HMResourceFetchResult,
  NavRoute,
  UnpackedHypermediaId,
  hmId,
  routeToHref,
  useRouteLink,
  useUniversalAppContext,
} from '@shm/shared'
import {
  CommentsProvider,
  isRouteEqualToCommentTarget,
} from '@shm/shared/comments-service-provider'
import {supportedLanguages} from '@shm/shared/language-packs'
import {useAccount} from '@shm/shared/models/entity'
import '@shm/shared/styles/document.css'
import {useTx, useTxString} from '@shm/shared/translation'
import {UIAvatar} from '@shm/ui/avatar'
import {BlocksContent, BlocksContentProvider} from '@shm/ui/blocks-content'
import {Button, ButtonLink} from '@shm/ui/button'
import {DocumentCover} from '@shm/ui/document-cover'
import {DocumentHeader} from '@shm/ui/document-header'
import {DocumentTools} from '@shm/ui/document-tools'
import {HMIcon} from '@shm/ui/hm-icon'
import {Close} from '@shm/ui/icons'
import {DocInteractionSummary} from '@shm/ui/interaction-summary'
import {useDocumentLayout} from '@shm/ui/layout'
import {
  DocNavigationWrapper,
  DocumentOutline,
  useNodesOutline,
} from '@shm/ui/navigation'
import {useAutoHideSiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useMedia} from '@shm/ui/use-media'
import {cn} from '@shm/ui/utils'
import {ChevronLeft, HistoryIcon, MessageSquare} from 'lucide-react'
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {ErrorBoundary, FallbackProps} from 'react-error-boundary'
import {
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {MyAccountBubble} from './account-bubble'
import {useLocalKeyPair} from './auth'
import WebCommenting from './commenting'
import type {SiteDocumentPayload} from './loaders'
import {addRecent} from './local-db-recents'
import {NotFoundPage} from './not-found'
import {PageFooter} from './page-footer'
import {WebSiteProvider} from './providers'
import {useScrollRestoration} from './use-scroll-restoration'
import {WebSiteHeader} from './web-site-header'

// Lazy load components for better initial page load performance
const FeedFilters = lazy(() =>
  import('@shm/ui/feed-filters').then((m) => ({default: m.FeedFilters})),
)
const WebDiscussionsPanel = lazy(() =>
  import('./discussions-panel').then((m) => ({default: m.WebDiscussionsPanel})),
)
const Feed = lazy(() => import('@shm/ui/feed').then((m) => ({default: m.Feed})))

// export const links = () => [{rel: 'stylesheet', href: blocksContentStyles}]

type WebAccessory =
  | {
      type: 'activity'
      filterEventType?: string[]
    }
  | {
      type: 'discussions'
      blockId?: string | null
      blockRange?: BlockRange | null
      blockRef?: string | null
      comment?: HMComment
    }
const DEFAULT_MAIN_PANEL_SIZE = 65

export function DocumentPage(
  props: SiteDocumentPayload & {prefersLanguages?: string[]},
) {
  const {siteHost, origin, prefersLanguages, document} = props
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={props.originHomeId}
      siteHost={siteHost}
      prefersLanguages={supportedLanguages(prefersLanguages)}
    >
      {document ? (
        <InnerDocumentPage {...props} />
      ) : (
        <NotFoundPage {...props} />
      )}
    </WebSiteProvider>
  )
}

function InnerDocumentPage(
  props: SiteDocumentPayload & {prefersLanguages?: string[]},
) {
  const mainPanelRef = useRef<ImperativePanelHandle>(null)
  const media = useMedia()
  const [editorAutoFocus, setEditorAutoFocus] = useState(false)
  let panel: any = null
  let panelTitle: string = ''

  const [_activePanel, setActivePanel] = useState<WebAccessory | null>(null)

  const {
    document,
    originHomeId,
    homeMetadata,
    id,
    siteHost,
    supportDocuments,
    supportQueries,
    accountsMetadata,
    origin,
    comment,
    isLatest,
  } = props

  // Persist feed filters in localStorage per document
  const [savedFeedFilters, setSavedFeedFilters] = useState({
    filterEventType: [] as string[],
  })

  // Use localStorage after component mounts (client-side only)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(
          `activity-panel-feed-filters-${id.id}`,
        )
        if (stored) {
          setSavedFeedFilters(JSON.parse(stored))
        }
      } catch (e) {
        console.error('Failed to load feed filters from localStorage:', e)
      }
    }
  }, [id.id])

  // Save to localStorage when filters change
  const updateSavedFilters = useCallback(
    (filters: {filterEventType: string[]}) => {
      setSavedFeedFilters(filters)
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(
            `activity-panel-feed-filters-${id.id}`,
            JSON.stringify(filters),
          )
        } catch (e) {
          console.error('Failed to save feed filters to localStorage:', e)
        }
      }
    },
    [id.id],
  )

  const mainScrollRef = useScrollRestoration('main-document-scroll', true)
  // const activityScrollRef = useScrollRestoration(`activity-${id.id}`)

  const keyPair = useLocalKeyPair()
  const currentAccount = useAccount(keyPair?.id || undefined)

  const {hideSiteBarClassName, onScroll} = useAutoHideSiteHeader()

  // Attach onScroll handler to main scroll container
  useEffect(() => {
    const container = mainScrollRef.current
    if (!container) return

    container.addEventListener('scroll', onScroll, {passive: true})
    return () => {
      container.removeEventListener('scroll', onScroll)
    }
  }, [onScroll])

  useEffect(() => {
    if (!id) return
    addRecent(id.id, document?.metadata?.name || '')
  }, [id, document?.metadata?.name])

  useEffect(() => {
    if (media.gtSm) {
      const mainPanel = mainPanelRef.current
      if (!mainPanel) return
      if (panel) {
        mainPanel.resize(DEFAULT_MAIN_PANEL_SIZE)
        mainPanel.expand()
      }
    } else {
      const mainPanel = mainPanelRef.current
      if (!mainPanel) return
      if (panel) {
        setTimeout(() => {
          mainPanel.collapse()
        }, 1)
      }
    }
  }, [panel, media.gtSm])

  const isHomeDoc = !id?.path?.length
  const isShowOutline =
    (typeof document.metadata?.showOutline == 'undefined' ||
      document.metadata?.showOutline) &&
    !isHomeDoc
  const showSidebarOutlineDirectory = isShowOutline && !isHomeDoc

  const location = useLocation()
  const replace = useNavigate()
  const tx = useTxString()

  const {blockRef, blockRange} = useMemo(() => {
    const match = location.hash.match(/^(.+?)(?:\[(\d+):(\d+)\])?$/)
    // @ts-expect-error
    let blockRef = match ? match[1].substring(1) : undefined
    if (blockRef?.endsWith('+')) {
      // TODO: Do something for expanded ref?
      blockRef = blockRef.slice(0, -1)
    }
    const blockRange =
      match && match[2] && match[3]
        ? {start: parseInt(match[2]), end: parseInt(match[3])}
        : undefined

    return {blockRef, blockRange}
  }, [location.hash])

  // if the server is providing a comment, use it as default, but allow local state to override
  // On mobile, activePanel can be set independently
  // _activePanel can override the default comment panel
  const activePanel: WebAccessory | null =
    _activePanel ||
    (comment
      ? {
          type: 'discussions',
          comment,
          blockRef,
          blockRange,
        }
      : null)

  // TODO: Re-enable scroll restoration for activity panel
  // Reset scroll when filter changes for activity panel (design decision 2B)
  // useEffect(() => {
  //   if (activePanel?.type === 'activity' && activityScrollRef.current) {
  //     const viewport = activityScrollRef.current.querySelector(
  //       '[data-slot="scroll-area-viewport"]',
  //     ) as HTMLElement
  //     if (viewport) {
  //       viewport.scrollTo({top: 0, behavior: 'instant'})
  //     }
  //   }
  // }, [activePanel?.type === 'activity' ? activePanel.filterEventType : null])

  function setDocumentPanel(panel: WebAccessory | null) {
    // If switching to activity, include saved filters
    if (panel?.type == 'activity') {
      panel = {...panel, filterEventType: savedFeedFilters.filterEventType}
    }
    setActivePanel(panel)
    setMobilePanelOpen(!!panel)

    // Update URL to reflect panel state
    // If closing discussions panel (going to activity or null), navigate back to document URL
    if (panel?.type == 'activity' || panel === null) {
      const route: NavRoute = {
        key: 'document',
        id,
      }
      const href = routeToHref(route, {
        hmUrlHref: context.hmUrlHref,
        originHomeId: context.originHomeId,
      })
      if (href) {
        replace(href, {replace: true})
      }
    }
  }

  function setCommentPanel(comment: HMComment) {
    const [commentUid, commentTsid] = comment.id.split('/')
    const route = {
      key: 'document',
      id: {
        uid: commentUid,
        path: [commentTsid],
      },
    } as NavRoute
    const href = routeToHref(route, {
      hmUrlHref: context.hmUrlHref,
      originHomeId: context.originHomeId,
    })
    if (!href) return
    replace(href, {
      replace: true,
    })
    setActivePanel({
      type: 'discussions',
      comment: comment,
    })
    setMobilePanelOpen(true)
  }

  // used to toggle the mobile accessory sheet. If the server is providing a comment, it should be open by default.
  const [isMobilePanelOpen, setMobilePanelOpen] = useState(!!comment)

  // Sync activePanel with URL changes (e.g., from Feed navigation)
  useEffect(() => {
    if (comment) {
      // If URL has a comment and it's different from current activePanel, update it
      if (
        !_activePanel ||
        _activePanel.type !== 'discussions' ||
        (_activePanel.type === 'discussions' &&
          _activePanel.comment?.id !== comment.id)
      ) {
        setActivePanel({type: 'discussions', comment, blockRef, blockRange})
        setMobilePanelOpen(true)
      }
    } else if (
      _activePanel?.type === 'discussions' &&
      _activePanel.comment &&
      !comment
    ) {
      // If URL no longer has a comment but activePanel does, clear it to activity
      setActivePanel({type: 'activity', ...savedFeedFilters})
    }
  }, [comment?.id, blockRef, blockRange])

  // Lock body scroll when mobile panel opens
  useEffect(() => {
    if (typeof window === 'undefined' || media.gtSm || !isMobilePanelOpen)
      return

    const scrollY = window.scrollY
    const body = window.document.body
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'

    return () => {
      body.style.position = ''
      body.style.top = ''
      body.style.width = ''
      body.style.overflow = ''
      window.scrollTo(0, scrollY)
    }
  }, [isMobilePanelOpen, media.gtSm])

  const context = useUniversalAppContext()
  const onActivateBlock = useCallback(
    (blockId: string) => {
      // Scroll to block smoothly
      const targetElement = window.document.getElementById(blockId)
      if (targetElement) {
        targetElement.scrollIntoView({behavior: 'smooth', block: 'start'})
      }

      // Build URL for the block reference
      const route = {
        key: 'document',
        id: {...id, blockRef: blockId},
      } as NavRoute
      const href = routeToHref(route, {
        hmUrlHref: context.hmUrlHref,
        originHomeId: context.originHomeId,
      })
      if (!href) return

      replace(href, {
        replace: true,
        preventScrollReset: true,
      })
    },
    [id, context.hmUrlHref, context.originHomeId, replace],
  )

  const {
    showSidebars,
    elementRef,
    showCollapsed,
    wrapperProps,
    sidebarProps,
    mainContentProps,
  } = useDocumentLayout({
    contentWidth: document?.metadata?.contentWidth,
    showSidebars: showSidebarOutlineDirectory,
  })

  const activityEnabled = document?.metadata?.showActivity !== false
  const interactionSummary = useInteractionSummary(id, {
    enabled: activityEnabled,
  })

  const onBlockCitationClick = useCallback(
    (blockId?: string | null) => {
      setDocumentPanel({type: 'discussions', blockId: blockId})

      if (!media.gtSm) {
        const mainPanel = mainPanelRef.current
        if (!mainPanel) return
        setTimeout(() => {
          mainPanel.collapse()
        }, 1)
      }
    },
    [media.gtSm],
  )

  const onBlockCommentClick = useCallback(
    (
      blockId?: string | null,
      range?: BlockRange | undefined,
      startCommentingNow?: boolean,
    ) => {
      setDocumentPanel({type: 'discussions', blockId: blockId || undefined})
      if (!media.gtSm) {
        setMobilePanelOpen(true)
      }
    },
    [media.gtSm],
  )

  const onReplyCountClick = useCallback((comment: HMComment) => {
    setCommentPanel(comment)
  }, [])

  const onReplyClick = useCallback((comment: HMComment) => {
    const targetId = isRouteEqualToCommentTarget({id, comment})

    if (!targetId) {
      setEditorAutoFocus(true)
      setCommentPanel(comment)
      if (!media.gtSm) {
        setMobilePanelOpen(true)
      }
    } else {
      const route = {
        key: 'document',
        id: targetId,
        accessory: {
          key: 'discussions',
          openComment: comment.id,
        },
      } as NavRoute
      const href = routeToHref(route, context)
      if (href) {
        replace(href)
      }
    }
  }, [])

  const navigate = useNavigate()

  const activitySummary = (
    <DocInteractionSummary
      isHome={isHomeDoc}
      isAccessoryOpen={!!activePanel}
      commentsCount={interactionSummary.data?.comments || 0}
      onCommentsClick={() => {
        setDocumentPanel({
          type: 'discussions',
          blockId: undefined,
        })
        if (!media.gtSm) {
          setMobilePanelOpen(true)
        }
      }}
      onFeedClick={() => {
        setDocumentPanel({type: 'activity'})
        if (!media.gtSm) {
          setMobilePanelOpen(true)
        }
      }}
    />
  )

  const commentEditor =
    activePanel?.type === 'discussions' ? (
      <WebCommenting
        autoFocus={editorAutoFocus}
        docId={id}
        replyCommentId={activePanel.comment?.id}
        replyCommentVersion={activePanel.comment?.version}
        rootReplyCommentVersion={
          activePanel.comment?.threadRootVersion || activePanel.comment?.version
        }
        quotingBlockId={activePanel.blockId || undefined}
      />
    ) : activePanel?.type === 'activity' ? (
      <WebCommenting docId={id} />
    ) : null

  if (activityEnabled && activePanel) {
    if (activePanel.type === 'discussions') {
      // Show the discussions panel with focused comment or block
      panelTitle = tx('Discussions')
      panel = (
        <PanelWrapper>
          {activitySummary}
          <WebDiscussionsPanel
            commentEditor={commentEditor}
            blockId={activePanel.blockId || undefined}
            blockRange={activePanel.blockRange || undefined}
            blockRef={activePanel.blockRef || undefined}
            comment={activePanel.comment}
            setBlockId={onBlockCommentClick}
            docId={id}
            homeId={originHomeId}
            document={document}
            originHomeId={originHomeId}
            siteHost={siteHost}
          />
        </PanelWrapper>
      )
    } else if (activePanel.type === 'activity') {
      // Show the activity feed
      panel = (
        <PanelWrapper>
          <Feed
            commentEditor={commentEditor}
            filterResource={id.id}
            currentAccount={currentAccount.data?.id.uid}
            filterEventType={activePanel.filterEventType || []}
          />
        </PanelWrapper>
      )
      panelTitle = tx('Document Activity')
    }
  } else {
    panel = null
  }

  if (!document)
    return (
      <DocumentDiscoveryPage
        id={id}
        originHomeId={originHomeId}
        homeMetadata={homeMetadata}
      />
    )

  const documentTools = (
    <DocumentTools
      activePanel={activePanel?.type}
      onFeedClick={
        activityEnabled
          ? () => {
              setDocumentPanel({type: 'activity'})
              if (!media.gtSm) {
                setMobilePanelOpen(true)
              }
            }
          : activityDisabledToast
      }
      onCommentsClick={
        activityEnabled
          ? () => {
              setDocumentPanel({
                type: 'discussions',
                blockId: undefined,
              })
              if (!media.gtSm) {
                setMobilePanelOpen(true)
              }
            }
          : commentsDisabledToast
      }
      commentsCount={interactionSummary.data?.comments}
    />
  )
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <CommentsProvider
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
      >
        <div className="bg-panel flex h-screen max-h-screen min-h-svh w-screen flex-col overflow-hidden">
          <WebSiteHeader
            hideSiteBarClassName={hideSiteBarClassName}
            noScroll={!!panel}
            homeMetadata={homeMetadata}
            originHomeId={originHomeId}
            siteHomeId={hmId(id.uid)}
            docId={id}
            document={document}
            supportDocuments={supportDocuments}
            supportQueries={supportQueries}
            origin={origin}
            isLatest={isLatest}
          />
          <PanelGroup
            direction="horizontal"
            autoSaveId="web-document"
            className="dark:bg-background flex flex-1 overflow-hidden bg-white"
          >
            <Panel
              ref={mainPanelRef}
              collapsible
              id="main-panel"
              className="h-full"
            >
              <div className="relative flex h-full flex-col" ref={elementRef}>
                {media.gtSm ? (
                  <div className="dark:bg-background absolute top-2 right-2 z-40 rounded-md bg-white shadow-md">
                    {!activePanel &&
                    activityEnabled &&
                    interactionSummary.data ? (
                      <div className="flex items-center">{activitySummary}</div>
                    ) : null}
                  </div>
                ) : null}
                <div
                  className="flex flex-1 flex-col overflow-y-auto"
                  ref={mainScrollRef}
                >
                  <div className="flex min-h-[calc(100vh-var(--site-header-h))] flex-col pt-[var(--site-header-h)] sm:pt-0 sm:pr-0">
                    <DocumentCover cover={document.metadata.cover} />
                    {isHomeDoc && !activePanel ? documentTools : null}
                    <div
                      {...wrapperProps}
                      className={cn('flex flex-1', wrapperProps.className)}
                    >
                      {showSidebars ? (
                        <div
                          className={cn(
                            sidebarProps.className,
                            'hide-scrollbar overflow-y-scroll pb-6',
                          )}
                          style={{
                            ...sidebarProps.style,
                            marginTop: document.metadata?.cover ? 152 : 220,
                          }}
                        >
                          <div className="hide-scrollbar overflow-scroll pb-6">
                            <WebDocumentOutline
                              showCollapsed={showCollapsed}
                              supportDocuments={props.supportDocuments}
                              onActivateBlock={onActivateBlock}
                              id={id}
                              document={document}
                            />
                          </div>
                        </div>
                      ) : null}
                      <div {...mainContentProps}>
                        {isHomeDoc ? null : (
                          <DocumentHeader
                            docId={id}
                            docMetadata={document.metadata}
                            // @ts-expect-error
                            authors={document.authors.map(
                              (author) => accountsMetadata[author],
                            )}
                            updateTime={document.updateTime}
                            // @ts-expect-error
                            breadcrumbs={props.breadcrumbs}
                            commentsCount={
                              interactionSummary.data?.comments || 0
                            }
                            onCommentsClick={
                              activityEnabled
                                ? () => {
                                    setDocumentPanel({
                                      type: 'discussions',
                                      blockId: undefined,
                                    })
                                    if (!media.gtSm) {
                                      setMobilePanelOpen(true)
                                    }
                                  }
                                : commentsDisabledToast
                            }
                            onFeedClick={
                              activityEnabled
                                ? () => {
                                    setDocumentPanel({type: 'activity'})
                                    if (!media.gtSm) {
                                      setMobilePanelOpen(true)
                                    }
                                  }
                                : activityDisabledToast
                            }
                            documentTools={documentTools}
                          />
                        )}
                        <div className="pr-3">
                          <BlocksContentProvider
                            resourceId={{
                              ...id,
                              blockRef: blockRef || null,
                              blockRange: blockRange || null,
                            }}
                            onBlockCitationClick={
                              activityEnabled
                                ? onBlockCitationClick
                                : activityDisabledToast
                            }
                            onBlockCommentClick={
                              activityEnabled
                                ? onBlockCommentClick
                                : commentsDisabledToast
                            }
                            onBlockSelect={(blockId, blockRange) => {
                              const shouldCopy =
                                blockRange?.copyToClipboard !== false
                              const route = {
                                key: 'document',
                                id: {
                                  uid: id.uid,
                                  path: id.path,
                                  version: id.version,
                                  blockRef: blockId,
                                  blockRange:
                                    blockRange &&
                                    'start' in blockRange &&
                                    'end' in blockRange
                                      ? {
                                          start: blockRange.start,
                                          end: blockRange.end,
                                        }
                                      : null,
                                },
                              } as NavRoute
                              const href = routeToHref(route, {
                                hmUrlHref: context.hmUrlHref,
                                originHomeId: context.originHomeId,
                              })
                              if (!href) {
                                toast.error('Failed to create block link')
                                return false
                              }
                              if (shouldCopy) {
                                window.navigator.clipboard.writeText(
                                  `${siteHost}${href}`,
                                )
                                toast.success('Block link copied to clipboard')
                              }
                              // Only navigate if we're not explicitly just copying
                              if (blockRange?.copyToClipboard !== true) {
                                // Scroll to block smoothly BEFORE updating URL
                                const element =
                                  window.document.getElementById(blockId)
                                if (element) {
                                  element.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'start',
                                  })
                                }

                                navigate(href, {
                                  replace: true,
                                  preventScrollReset: true,
                                })
                                return true
                              }
                              return false
                            }}
                            blockCitations={interactionSummary.data?.blocks}
                          >
                            <BlocksContent blocks={document.content} />
                          </BlocksContentProvider>
                        </div>
                      </div>
                      {showSidebars ? (
                        <div
                          className={cn(sidebarProps.className)}
                          style={sidebarProps.style}
                        />
                      ) : null}
                    </div>
                    <MyAccountBubble />
                    <div className="mb-6 flex-none shrink-0 grow-0 md:mb-0">
                      <PageFooter id={id} />
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
            {!media.gtSm ? null : panel ? (
              <>
                <PanelResizeHandle className="panel-resize-handle" />
                <Panel
                  defaultSize={media.gtSm ? 100 - DEFAULT_MAIN_PANEL_SIZE : 100}
                  maxSize={media.gtSm ? 100 - DEFAULT_MAIN_PANEL_SIZE : 100}
                  minSize={media.gtSm ? 20 : 100}
                  className="border-sidebar-border flex h-full flex-1 flex-col border-l"
                >
                  {documentTools}
                  <div className="dark:bg-background border-border border-b bg-white p-3">
                    <div className="flex items-center">
                      {activePanel?.type === 'discussions' &&
                      (activePanel.comment || activePanel.blockId) ? (
                        <Tooltip content={tx('Back to All discussions')}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="mr-2 flex-none"
                            onClick={() => {
                              setDocumentPanel({
                                type: 'discussions',
                                blockId: undefined,
                                comment: undefined,
                              })
                            }}
                          >
                            <ChevronLeft className="size-4" />
                          </Button>
                        </Tooltip>
                      ) : null}
                      <Text weight="bold" size="md" className="flex-1">
                        {panelTitle}
                      </Text>
                      <Tooltip content={tx('Close')}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="flex-none"
                          onClick={() => {
                            setDocumentPanel(null)
                          }}
                        >
                          <Close className="size-4" />
                        </Button>
                      </Tooltip>
                    </div>

                    {activePanel?.type == 'activity' ? (
                      <FeedFilters
                        filterEventType={activePanel?.filterEventType}
                        onFilterChange={({
                          filterEventType,
                        }: {
                          filterEventType?: string[]
                        }) => {
                          setActivePanel({
                            ...activePanel,
                            filterEventType: filterEventType || [],
                          })
                          updateSavedFilters({
                            filterEventType: filterEventType || [],
                          })
                        }}
                      />
                    ) : null}
                  </div>
                  <div className="flex-1 overflow-hidden">{panel}</div>
                </Panel>
              </>
            ) : null}
          </PanelGroup>

          {media.gtSm || !activityEnabled ? null : (
            <>
              <MobileInteractionCardCollapsed
                onClick={() => {
                  setDocumentPanel({type: 'discussions'})
                  // setMobilePanelOpen(true)
                }}
                commentsCount={interactionSummary.data?.comments || 0}
                id={id}
              />

              <div
                className={cn(
                  'bg-panel fixed inset-0 z-50 flex h-screen max-h-screen flex-1 flex-col overflow-hidden transition-transform duration-200 ease-[cubic-bezier(0,1,0.15,1)] md:hidden',
                  isMobilePanelOpen ? 'translate-y-0' : 'translate-y-full',
                )}
              >
                {/* "bg-panel fixed inset-0 z-50 flex h-full flex-1 flex-col overflow-hidden" */}
                <div className="relative flex items-center p-3">
                  <div className="flex-1 items-center justify-center">
                    {activitySummary}
                  </div>
                  <Button
                    size="icon"
                    onClick={() => setMobilePanelOpen(false)}
                    className="flex-0 shrink-0 grow-0"
                  >
                    <Close className="size-4" />
                  </Button>
                </div>
                <div className="border-border flex items-center border-b px-5 py-2 text-left">
                  {activePanel?.type === 'discussions' &&
                  activePanel.comment ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mr-2 flex-none"
                      onClick={() => {
                        setDocumentPanel({
                          type: 'discussions',
                          blockId: undefined,
                          comment: undefined,
                        })
                      }}
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                  ) : null}
                  <Text weight="semibold">{panelTitle}</Text>
                </div>

                <div className="flex flex-1 flex-col overflow-hidden">
                  {panel}
                </div>
              </div>
            </>
          )}
        </div>
      </CommentsProvider>
    </Suspense>
  )
}

function activityDisabledToast() {
  toast.error('Activity is not enabled for this document')
}

function commentsDisabledToast() {
  toast.error('Comments are not enabled for this document')
}

function MobileInteractionCardCollapsed({
  onClick,
  commentsCount = 0,
  id,
}: {
  onClick: () => void
  commentsCount: number
  id: UnpackedHypermediaId
}) {
  const keyPair = useLocalKeyPair()
  // Use retry and disable refetchOnWindowFocus to avoid 404 errors while account is being created
  const myAccount = useAccount(keyPair?.id || undefined, {
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    refetchOnWindowFocus: false,
  })

  const {content: createAccountContent, createAccount} = useCreateAccount({
    onClose: () => {
      // Add a small delay before refetching to give the backend time to process
      setTimeout(() => {
        myAccount.refetch()
      }, 500)
    },
  })

  const handleAvatarClick = useMemo(() => {
    if (!keyPair) {
      return createAccount
    }
    return null
  }, [keyPair, createAccount])

  const avatarLinkProps = useRouteLink(
    keyPair
      ? {
          key: 'profile',
          id: hmId(keyPair.id, {
            latest: true,
          }),
        }
      : null,
  )

  const feedLinkProps = useRouteLink({
    key: 'feed',
    id: hmId(id.uid),
  })

  return (
    <>
      <div
        className="dark:bg-background border-sidebar-border fixed right-0 bottom-0 left-0 z-40 flex items-center justify-between rounded-t-md border bg-white p-2"
        style={{
          boxShadow: '0px -16px 40px 8px rgba(0,0,0,0.1)',
        }}
        onClick={(e) => {
          // Prevent clicks on the container from passing through to elements behind
          e.stopPropagation()
        }}
      >
        <Button
          variant="ghost"
          className="min-w-20 shrink-0 cursor-pointer"
          {...(handleAvatarClick
            ? {onClick: handleAvatarClick}
            : avatarLinkProps)}
        >
          {myAccount.data?.id ? (
            <HMIcon
              id={myAccount.data.id}
              name={myAccount.data?.metadata?.name}
              icon={myAccount.data?.metadata?.icon}
              size={32}
            />
          ) : (
            <UIAvatar
              url={avatarPlaceholder}
              size={32}
              className="rounded-full"
            />
          )}
        </Button>

        <ButtonLink variant="ghost" {...feedLinkProps}>
          <HistoryIcon className="text-muted-foreground size-4" />
        </ButtonLink>

        <Button
          variant="ghost"
          className="min-w-20 shrink-0 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            onClick()
          }}
          onMouseEnter={() => {
            // Prefetch discussions panel and feed when user hovers
            import('./discussions-panel').catch(() => {})
            import('@shm/ui/feed').catch(() => {})
          }}
        >
          <MessageSquare className="size-4 opacity-50" />
          {commentsCount ? (
            <span className="text-xs opacity-50">{commentsCount}</span>
          ) : null}
        </Button>
      </div>
      {createAccountContent}
    </>
  )
}

function DocumentDiscoveryPage({
  id,
}: {
  id: UnpackedHypermediaId
  homeMetadata: HMMetadata | null
  originHomeId: UnpackedHypermediaId | null
}) {
  useEffect(() => {
    fetch('/hm/api/discover', {
      method: 'post',
      body: JSON.stringify({uid: id.uid, path: id.path, version: id.version}),
      headers: {
        'Content-Type': 'application/json',
      },
    }).then(() => {
      window.location.reload()
    })
  }, [id])
  const tx = useTx()
  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="flex flex-1 items-start justify-center px-4 py-12">
        <div className="border-border dark:bg-background flex w-full max-w-lg flex-1 flex-col gap-4 rounded-lg border bg-white p-6 shadow-lg">
          <h2 className="text-2xl font-bold">
            {tx('looking_for_document', 'Looking for a document...')}
          </h2>

          <p>
            {tx(
              'hang_tight_searching',
              `Hang tight! We're currently searching the network to locate your
            document. This may take a moment as we retrieve the most up-to-date
            version.`,
            )}
          </p>
          <p>
            {tx(
              'doc_will_appear',
              `If the document is available, it will appear shortly. Thank you for
            your patience!`,
            )}
          </p>
        </div>
      </div>
      <PageFooter id={id} />
    </div>
  )
}

function WebDocumentOutline({
  showCollapsed,
  document,
  id,
  onActivateBlock,
  supportDocuments,
}: {
  showCollapsed: boolean
  document: HMDocument | null | undefined
  id: UnpackedHypermediaId
  onActivateBlock: (blockId: string) => void
  supportDocuments: HMResourceFetchResult[] | undefined
}) {
  const outline = useNodesOutline(document, id, supportDocuments)
  if (!outline.length) return null
  return (
    <DocNavigationWrapper showCollapsed={showCollapsed} outline={outline}>
      <DocumentOutline
        onActivateBlock={onActivateBlock}
        id={id}
        outline={outline}
        activeBlockId={id.blockRef}
      />
    </DocNavigationWrapper>
  )
}

function PanelError({error, resetErrorBoundary}: FallbackProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 self-stretch bg-red-100 p-3 align-middle">
      <h3 className="text-xl font-bold text-red-800">Oops, we hit an error!</h3>
      <p className="text-red-600">{error.message}</p>
      <Button onClick={resetErrorBoundary} variant="destructive">
        Retry
      </Button>
    </div>
  )
}

function PanelLoading() {
  return (
    <div className="flex h-full items-center justify-center p-3">
      <Spinner />
    </div>
  )
}

function PanelWrapper({children}: {children: React.ReactNode}) {
  return (
    <Suspense fallback={<PanelLoading />}>
      <ErrorBoundary FallbackComponent={PanelError}>{children}</ErrorBoundary>
    </Suspense>
  )
}

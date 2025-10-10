import {useCitations, useDocumentChanges, useInteractionSummary} from '@/models'
import {useLocation, useNavigate} from '@remix-run/react'
import avatarPlaceholder from '@shm/editor/assets/avatar.png'
import {
  BlockRange,
  deduplicateCitations,
  ExpandedBlockRange,
  HMComment,
  HMDocument,
  HMDocumentCitation,
  HMEntityContent,
  HMMetadata,
  NavRoute,
  routeToHref,
  UnpackedHypermediaId,
  useUniversalAppContext,
} from '@shm/shared'
import {ActivityProvider} from '@shm/shared/activity-service-provider'
import {
  CommentsProvider,
  isRouteEqualToCommentTarget,
} from '@shm/shared/comments-service-provider'
import {supportedLanguages} from '@shm/shared/language-packs'
import {useAccount} from '@shm/shared/models/entity'
import '@shm/shared/styles/document.css'
import {useTx, useTxString} from '@shm/shared/translation'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
import {ChangeItem} from '@shm/ui/change-item'
import {DocumentCitationEntry} from '@shm/ui/citations'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Container} from '@shm/ui/container'
import {DocContent} from '@shm/ui/document-content'
import documentContentStyles from '@shm/ui/document-content.css?url'
import {DocumentCover} from '@shm/ui/document-cover'
import {Feed2} from '@shm/ui/feed'
import {HMIcon} from '@shm/ui/hm-icon'
import {Close} from '@shm/ui/icons'
import {useDocumentLayout} from '@shm/ui/layout'
import {
  DocNavigationWrapper,
  DocumentOutline,
  useNodesOutline,
} from '@shm/ui/navigation'
import {Separator} from '@shm/ui/separator'
import {useAutoHideSiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useMedia} from '@shm/ui/use-media'
import {cn} from '@shm/ui/utils'
import {MessageSquare, Sparkle} from 'lucide-react'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {useLocalKeyPair} from './auth'
import WebCommenting from './commenting'
import {WebDiscussionsPanel} from './discussions-panel'
import {WebDocContentProvider} from './doc-content-provider'
import type {SiteDocumentPayload} from './loaders'
import {addRecent} from './local-db-recents'
import {NotFoundPage} from './not-found'
import {PageFooter} from './page-footer'
import {PageHeader} from './page-header'
import {WebSiteProvider} from './providers'
import {useScrollRestoration} from './use-scroll-restoration'
import {WebActivityService} from './web-activity-service'
import {WebCommentsService} from './web-comments-service'
import {WebSiteHeader} from './web-site-header'

export const links = () => [{rel: 'stylesheet', href: documentContentStyles}]

type WebAccessory = {
  type: 'activity'
  blockId?: string
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
  const commentsService = useMemo(() => new WebCommentsService(), [])
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
    feed,
  } = props

  const mainScrollRef = useScrollRestoration('main-document-scroll')
  const mobileScrollRef = useScrollRestoration('mobile-panel-scroll')
  const activityService = useMemo(() => new WebActivityService(), [])

  const keyPair = useLocalKeyPair()
  const currentAccount = useAccount(keyPair?.id || undefined)

  const {hideSiteBarClassName, onScroll} = useAutoHideSiteHeader()

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

  function setDocumentPanel(panel: WebAccessory | null) {
    setActivePanel(panel)
    setMobilePanelOpen(!!panel)
    // Don't navigate when setting panel - just update the state
    // The URL navigation should only happen when explicitly navigating to different content
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
      type: 'activity',
      comment: comment,
    })
    setMobilePanelOpen(true)
  }

  // if the server is providing a comment, use it as default, but allow local state to override
  const activePanel: WebAccessory | null =
    _activePanel || (comment ? {type: 'activity', comment} : null)

  // used to toggle the mobile accessory sheet. If the server is providing a comment, it should be open by default.
  const [isMobilePanelOpen, setMobilePanelOpen] = useState(!!comment)

  // Sync activePanel with URL changes (e.g., from Feed navigation)
  useEffect(() => {
    if (comment) {
      // If URL has a comment and it's different from current activePanel, update it
      if (
        !_activePanel ||
        _activePanel.type !== 'activity' ||
        (_activePanel.type === 'activity' &&
          _activePanel.comment?.id !== comment.id)
      ) {
        setActivePanel({type: 'activity', comment})
        setMobilePanelOpen(true)
      }
    } else if (
      _activePanel?.type === 'activity' &&
      _activePanel.comment &&
      !comment
    ) {
      // If URL no longer has a comment but activePanel does, clear it
      setActivePanel({type: 'activity'})
    }
  }, [comment?.id])

  const context = useUniversalAppContext()
  const onActivateBlock = useCallback(
    (blockId: string) => {
      const route = {
        key: 'document',
        id: {
          ...id,
          blockRef: blockId,
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
      const targetElement = window.document.getElementById(blockId)
      if (targetElement) {
        targetElement.scrollIntoView({behavior: 'smooth', block: 'start'})
      } else {
        console.error('Element not found:', blockId)
      }
    },
    [id, context.hmUrlHref, context.originHomeId],
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
    (blockId?: string) => {
      setDocumentPanel({type: 'activity', blockId: blockId})

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
      range?: BlockRange | ExpandedBlockRange | undefined,
      startCommentingNow?: boolean,
    ) => {
      setDocumentPanel({type: 'activity', blockId: blockId || undefined})
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

    if (targetId) {
      const route = {
        key: 'document',
        id,
        accessory: {
          key: 'activity',
          openComment: comment.id,
        },
      } as NavRoute
      const href = routeToHref(route, context)
      if (href) {
        replace(href)
      }
    } else {
      setEditorAutoFocus(true)
      setCommentPanel(comment)
      if (!media.gtSm) {
        setMobilePanelOpen(true)
      }
    }
  }, [])

  const activitySummary = (
    <DocInteractionsSummary
      activePanel={activePanel}
      docId={id}
      citations={interactionSummary.data?.citations}
      comments={interactionSummary.data?.comments}
      changes={interactionSummary.data?.changes}
      onCommentsOpen={() => {
        setDocumentPanel({
          type: 'activity',
          blockId: undefined,
        })
        if (!media.gtSm) {
          setMobilePanelOpen(true)
        }
      }}
      onFeedOpen={() => {
        setDocumentPanel({type: 'activity'})
        if (!media.gtSm) {
          setMobilePanelOpen(true)
        }
      }}
    />
  )

  const commentEditor =
    activePanel?.type === 'activity' ? (
      <WebCommenting
        autoFocus={editorAutoFocus}
        docId={id}
        replyCommentId={activePanel.comment?.id}
        replyCommentVersion={activePanel.comment?.version}
        rootReplyCommentVersion={
          activePanel.comment?.threadRootVersion || activePanel.comment?.version
        }
        quotingBlockId={activePanel.blockId}
      />
    ) : null

  if (activityEnabled && activePanel?.type === 'activity') {
    // If we have a comment or blockId, show the discussions panel
    if (activePanel.comment || activePanel.blockId) {
      console.log('== RENDER DISCUSSION PANEL', activePanel)
      panelTitle = tx('Thread')
      panel = (
        <WebDiscussionsPanel
          commentEditor={commentEditor}
          blockId={activePanel.blockId}
          comment={activePanel.comment}
          handleBack={() => {
            setDocumentPanel({
              type: 'activity',
            })
          }}
          setBlockId={onBlockCommentClick}
          docId={id}
          homeId={originHomeId}
          document={document}
          originHomeId={originHomeId}
          siteHost={siteHost}
        />
      )
    } else {
      // Otherwise show the feed
      panel = (
        <Feed2
          commentEditor={<WebCommenting docId={id} />}
          filterResource={id.id}
          currentAccount={currentAccount.data?.id.uid}
        />
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
  return (
    <ActivityProvider service={activityService}>
      <CommentsProvider
        service={commentsService}
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
      >
        <div className="bg-panel flex h-screen max-h-screen min-h-svh w-screen flex-col overflow-hidden">
          <WebSiteHeader
            hideSiteBarClassName={hideSiteBarClassName}
            noScroll={!!panel}
            homeMetadata={homeMetadata}
            originHomeId={originHomeId}
            docId={id}
            document={document}
            supportDocuments={supportDocuments}
            supportQueries={supportQueries}
            origin={origin}
            isLatest={isLatest}
          />
          <WebDocContentProvider
            siteHost={siteHost}
            originHomeId={originHomeId}
            comment
            textUnit={16}
            layoutUnit={18}
          >
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
                        <>{activitySummary}</>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex h-full min-h-full flex-1 flex-col overflow-hidden">
                    <ScrollArea onScroll={onScroll}>
                      {feed ? (
                        <div
                          {...wrapperProps}
                          className={cn(
                            wrapperProps.className,
                            'flex pt-[var(--site-header-h)]',
                          )}
                        >
                          {showSidebars ? (
                            <div
                              {...sidebarProps}
                              className={`${
                                sidebarProps.className || ''
                              } flex flex-col`}
                            />
                          ) : null}
                          <Container
                            clearVerticalSpace
                            {...mainContentProps}
                            className={cn(
                              mainContentProps.className,
                              'base-doc-container relative mt-5 gap-4 sm:mr-10 sm:ml-0',
                            )}
                          >
                            <Text weight="bold" size="3xl">
                              What's New
                            </Text>
                            <Separator />

                            <Feed2
                              commentEditor={<WebCommenting docId={id} />}
                              filterResource={`${originHomeId.id}*`}
                              currentAccount={currentAccount.data?.id.uid}
                            />
                          </Container>
                          {showSidebars ? (
                            <div
                              {...sidebarProps}
                              className={`${
                                sidebarProps.className || ''
                              } flex flex-col`}
                            />
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex h-auto min-h-[calc(100vh-var(--site-header-h))] flex-col pt-[var(--site-header-h)] pr-3 sm:pt-0 sm:pr-0">
                          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                            <DocumentCover cover={document.metadata.cover} />

                            <div
                              {...wrapperProps}
                              className={cn(
                                'flex flex-1',
                                wrapperProps.className,
                              )}
                            >
                              {showSidebars ? (
                                <div
                                  className={cn(
                                    sidebarProps.className,
                                    'hide-scrollbar overflow-y-scroll pb-6',
                                  )}
                                  style={{
                                    ...sidebarProps.style,
                                    marginTop: document.metadata?.cover
                                      ? 152
                                      : 220,
                                  }}
                                >
                                  <div className="hide-scrollbar h-full overflow-scroll pb-6">
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
                                  <PageHeader
                                    originHomeId={originHomeId}
                                    breadcrumbs={props.breadcrumbs}
                                    docMetadata={document.metadata}
                                    docId={id}
                                    // @ts-expect-error
                                    authors={document.authors.map(
                                      (author) => accountsMetadata[author],
                                    )}
                                    updateTime={document.updateTime}
                                  />
                                )}
                                <WebDocContentProvider
                                  // @ts-expect-error
                                  onBlockCitationClick={
                                    activityEnabled
                                      ? onBlockCitationClick
                                      : undefined
                                  }
                                  onBlockCommentClick={
                                    activityEnabled
                                      ? onBlockCommentClick
                                      : undefined
                                  }
                                  originHomeId={originHomeId}
                                  id={{...id, version: document.version}}
                                  siteHost={siteHost}
                                  supportDocuments={supportDocuments}
                                  supportQueries={supportQueries}
                                  blockCitations={
                                    interactionSummary.data?.blocks
                                  }
                                  routeParams={{
                                    uid: id.uid,
                                    version: id.version || undefined,
                                    blockRef: blockRef,
                                    blockRange: blockRange,
                                  }}
                                >
                                  <DocContent
                                    document={document}
                                    handleBlockReplace={() => {
                                      // setDocumentPanel(null)
                                      return true
                                      // const route = {
                                      //   key: 'document',
                                      //   id: {
                                      //     uid: id.uid,
                                      //     path: id.path,
                                      //     version: id.version,
                                      //     blockRef: id.blockRef,
                                      //     blockRange: id.blockRange,
                                      //   },
                                      // } as NavRoute
                                      // const href = routeToHref(route, context)
                                      // if (!href) return false
                                      // replace(href, {
                                      //   replace: true,
                                      //   preventScrollReset: true,
                                      // })
                                      // return true
                                    }}
                                  />
                                </WebDocContentProvider>
                              </div>
                              {showSidebars ? (
                                <div
                                  className={cn(sidebarProps.className)}
                                  style={sidebarProps.style}
                                />
                              ) : null}
                            </div>
                          </div>
                          <div className="mb-6 flex-none shrink-0 grow-0 md:mb-0">
                            <PageFooter id={id} />
                          </div>
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </div>
              </Panel>
              {!media.gtSm ? null : panel ? (
                <>
                  <PanelResizeHandle className="panel-resize-handle" />
                  <Panel
                    defaultSize={
                      media.gtSm ? 100 - DEFAULT_MAIN_PANEL_SIZE : 100
                    }
                    maxSize={media.gtSm ? 100 - DEFAULT_MAIN_PANEL_SIZE : 100}
                    minSize={media.gtSm ? 20 : 100}
                    className="border-sidebar-border flex h-full flex-1 flex-col border-l"
                  >
                    <div className="dark:bg-background border-border flex items-center border-b bg-white p-3">
                      <Text weight="bold" size="md" className="flex-1">
                        {panelTitle}
                      </Text>
                      <Tooltip content={tx('Close')}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="flex-none"
                          onClick={() => {
                            setActivePanel(null)
                            setMobilePanelOpen(false)
                          }}
                        >
                          <Close className="size-4" />
                        </Button>
                      </Tooltip>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <ScrollArea>{panel}</ScrollArea>
                    </div>
                  </Panel>
                </>
              ) : null}
            </PanelGroup>

            {media.gtSm || !activityEnabled ? null : (
              <>
                <MobileInteractionCardCollapsed
                  onClick={() => {
                    setDocumentPanel({type: 'activity'})
                    setMobilePanelOpen(true)
                  }}
                  commentsCount={interactionSummary.data?.comments || 0}
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
                  <div className="border-border border-b px-5 py-2 text-left">
                    <Text weight="semibold">{panelTitle}</Text>
                  </div>

                  <div className="flex flex-1 flex-col overflow-hidden">
                    <ScrollArea onScroll={onScroll}>{panel}</ScrollArea>
                  </div>
                </div>
              </>
            )}
          </WebDocContentProvider>
        </div>
      </CommentsProvider>
    </ActivityProvider>
  )
}

function MobileInteractionCardCollapsed({
  onClick,
  commentsCount = 0,
}: {
  onClick: () => void
  commentsCount: number
}) {
  const keyPair = useLocalKeyPair()
  const myAccount = useAccount(keyPair?.id || undefined)

  const tx = useTx()
  return (
    <div
      className="dark:bg-background border-sidebar-border fixed right-0 bottom-0 left-0 z-40 flex rounded-t-md border bg-white p-2"
      style={{
        boxShadow: '0px -16px 40px 8px rgba(0,0,0,0.1)',
      }}
    >
      <Button
        variant="ghost"
        className="flex min-w-0 flex-1 items-center justify-start p-1"
        onClick={onClick}
      >
        <div className="shrink-0">
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
        </div>
        <span className="bg-background ring-px ring-border ml-1 flex-1 truncate rounded-md px-2 py-1 text-left ring">
          {tx('Start a Discussion')}
        </span>
      </Button>
      {commentsCount ? (
        <Button variant="ghost" onClick={onClick}>
          <MessageSquare className="size-4 opacity-50" />
          <span className="text-xs opacity-50">{commentsCount}</span>
        </Button>
      ) : null}
    </div>
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
  supportDocuments: HMEntityContent[] | undefined
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

const DocInteractionsSummary = React.memo(_DocInteractionsSummary)

function _DocInteractionsSummary({
  docId,
  citations,
  comments,
  changes,
  onCommentsOpen,
  onFeedOpen,
  activePanel,
}: {
  docId: UnpackedHypermediaId
  citations?: number
  comments?: number
  changes?: number
  onCommentsOpen?: () => void
  onFeedOpen?: () => void
  activePanel: WebAccessory | null
}) {
  const tx = useTxString()
  return (
    <div className="flex items-center justify-center">
      {onFeedOpen && (
        <InteractionSummaryItem
          label={tx('Feed')}
          active={activePanel?.type == 'activity'}
          onClick={onFeedOpen}
          // @ts-ignore
          icon={<Sparkle className="size-4" />}
        />
      )}
    </div>
  )
}

function InteractionSummaryItem({
  label,
  count = null,
  onClick,
  icon,
  active,
}: {
  label: string
  count?: number | null
  onClick: () => void
  icon: React.ReactNode
  active: boolean
}) {
  return (
    <Tooltip content={label}>
      <Button
        onClick={onClick}
        variant="ghost"
        className={cn('p-0', active && 'bg-accent')}
        size="sm"
      >
        {icon}
        {count == null ? null : <span className="text-xs">{count}</span>}
      </Button>
    </Tooltip>
  )
}

function WebCitationsPanel({
  activitySummary,
  id,
  blockId,
  handleBack,
}: {
  activitySummary: React.ReactNode
  id: UnpackedHypermediaId
  blockId?: string
  handleBack: () => void
}) {
  const citations = useCitations(id)
  const displayCitations = useMemo(() => {
    if (!citations.data) return null
    const filteredCitations = blockId
      ? citations.data.filter(
          (citation) =>
            citation.targetFragment &&
            citation.targetFragment?.blockId === blockId,
        )
      : citations.data
    const dedupedCitations = deduplicateCitations(filteredCitations)
    return dedupedCitations
  }, [citations.data, blockId])
  const tx = useTxString()
  return (
    <div className="flex flex-col gap-2">
      {blockId ? (
        // @ts-expect-error
        <AccessoryBackButton onPress={handleBack} label={tx('All Citations')} />
      ) : null}
      {displayCitations ? (
        displayCitations.map((citation: HMDocumentCitation) => {
          return (
            <DocumentCitationEntry
              key={citation.source.id.id}
              citation={citation}
            />
          )
        })
      ) : (
        <div className="flex items-center justify-center">
          <Spinner />
        </div>
      )}
    </div>
  )
}

function WebVersionsPanel({docId}: {docId: UnpackedHypermediaId}) {
  const changes = useDocumentChanges(docId)
  const changesList = changes.data?.changes || []
  return (
    <div className="flex flex-col gap-2">
      {changesList.map((change, idx) => {
        const isCurrent = change.id === changes.data?.latestVersion
        return (
          <ChangeItem
            key={change.id}
            change={change}
            isActive={docId.version ? docId.version === change.id : isCurrent}
            docId={docId}
            isLast={idx === changesList.length - 1}
            isCurrent={change.id === changes.data?.latestVersion}
            author={change.author}
          />
        )
      })}
    </div>
  )
}

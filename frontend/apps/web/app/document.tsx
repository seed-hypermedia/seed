import {useCitations, useDocumentChanges, useInteractionSummary} from '@/models'
import {HeadersFunction, MetaFunction} from '@remix-run/node'
import {useLocation, useNavigate} from '@remix-run/react'
import {
  BlockRange,
  deduplicateCitations,
  ExpandedBlockRange,
  getDocumentTitle,
  HMComment,
  HMDocument,
  HMDocumentCitation,
  HMEntityContent,
  hmIdPathToEntityQueryPath,
  HMMetadata,
  hostnameStripProtocol,
  NavRoute,
  pluralS,
  routeToHref,
  UnpackedHypermediaId,
  useUniversalAppContext,
  WEB_IDENTITY_ENABLED,
} from '@shm/shared'
import {DiscussionsProvider} from '@shm/shared/discussions-provider'
import '@shm/shared/styles/document.css'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {Button} from '@shm/ui/button'
import {ChangeItem} from '@shm/ui/change-item'
import {DocumentCitationEntry} from '@shm/ui/citations'
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTrigger,
} from '@shm/ui/components/drawer'
import {panelContainerStyles, windowContainerStyles} from '@shm/ui/container'
import {DocContent} from '@shm/ui/document-content'
import {extractIpfsUrlCid, useImageUrl} from '@shm/ui/get-file-url'
import {BlockQuote, HistoryIcon} from '@shm/ui/icons'
import {useDocumentLayout} from '@shm/ui/layout'
import {
  DocNavigationWrapper,
  DocumentOutline,
  useNodesOutline,
} from '@shm/ui/navigation'
import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {MessageSquare, X} from 'lucide-react'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {WebCommenting} from './client-lazy'
import {redirectToWebIdentityCommenting} from './commenting-utils'
import {WebDiscussionsPanel} from './discussions-panel'
import {WebDocContentProvider} from './doc-content-provider'
import type {SiteDocumentPayload} from './loaders'
import {addRecent} from './local-db-recents'
import {defaultSiteIcon} from './meta'
import {NotFoundPage} from './not-found'
import {PageFooter} from './page-footer'
import {PageHeader} from './page-header'
import {getOptimizedImageUrl, WebSiteProvider} from './providers'

import {supportedLanguages} from '@shm/shared/language-packs'
import {useTx, useTxString} from '@shm/shared/translation'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {useMedia} from '@shm/ui/use-media'
import {WebSiteHeader} from './web-site-header'
import {unwrap, Wrapped} from './wrapping'

export const documentPageHeaders: HeadersFunction = ({loaderHeaders}) =>
  loaderHeaders

export const documentPageMeta = ({
  data,
}: {
  data: Wrapped<SiteDocumentPayload>
}): ReturnType<MetaFunction> => {
  const siteDocument = unwrap<SiteDocumentPayload>(data)
  const homeIcon = siteDocument?.homeMetadata?.icon
    ? getOptimizedImageUrl(
        extractIpfsUrlCid(siteDocument.homeMetadata.icon),
        'S',
      )
    : null
  const meta: ReturnType<MetaFunction> = []

  meta.push({
    tagName: 'link',
    rel: 'icon',
    href: homeIcon || defaultSiteIcon,
    type: 'image/png',
  })

  if (!siteDocument) return meta

  if (siteDocument.id)
    meta.push({
      name: 'hypermedia_id',
      content: siteDocument.id.id,
    })
  if (siteDocument.document) {
    const documentTitle = getDocumentTitle(siteDocument.document)
    const documentDescription = ''
    const imageUrl = `${siteDocument.origin}/hm/api/content-image?space=${
      siteDocument.id.uid
    }&path=${hmIdPathToEntityQueryPath(siteDocument.id.path)}&version=${
      siteDocument.id.version
    }`
    const currentUrl = `${siteDocument.origin}${
      siteDocument.id.path?.length ? '/' + siteDocument.id.path.join('/') : ''
    }`
    const domain = hostnameStripProtocol(siteDocument.origin)

    meta.push({title: documentTitle})
    meta.push({
      name: 'description',
      content: documentDescription,
    })

    meta.push({
      property: 'og:url',
      content: currentUrl,
    })
    meta.push({
      property: 'og:type',
      content: 'website',
    })
    meta.push({
      property: 'og:title',
      content: documentTitle,
    })
    meta.push({
      property: 'og:description',
      content: documentDescription,
    })
    meta.push({
      property: 'og:image',
      content: imageUrl,
    })

    // Twitter Meta Tags
    meta.push({
      name: 'twitter:card',
      content: 'summary_large_image',
    })
    meta.push({
      property: 'twitter:domain',
      content: domain,
    })
    meta.push({
      property: 'twitter:url',
      content: currentUrl,
    })
    meta.push({
      name: 'twitter:title',
      content: documentTitle,
    })
    meta.push({
      name: 'twitter:description',
      content: documentDescription,
    })
    meta.push({
      name: 'twitter:image',
      content: imageUrl,
    })

    meta.push({
      name: 'hypermedia_version',
      content: siteDocument.document.version,
    })
    meta.push({
      name: 'hypermedia_title',
      content: documentTitle,
    })
  } else {
    meta.push({title: 'Not Found'})
  }
  return meta
}

type WebAccessory =
  | {
      type: 'citations'
      blockId?: string
    }
  | {
      type: 'discussions'
      blockId?: string
      comment?: HMComment
    }
  | {
      type: 'versions'
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

  const {
    document,
    originHomeId,
    homeMetadata,
    id,
    siteHost,
    supportDocuments,
    supportQueries,
    accountsMetadata,
    enableWebSigning,
    origin,
    comment,
    isLatest,
  } = props

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

  const [_activePanel, setActivePanel] = useState<WebAccessory | null>(() => {
    return {type: 'discussions', comment: undefined}
  })

  function setDocumentPanel(panel: WebAccessory | null) {
    setActivePanel(panel)
    setIsSheetOpen(!!panel)
    const route = {
      key: 'document',
      id: {
        uid: id.uid,
        path: id.path,
        version: id.version,
        blockRef: id.blockRef,
        blockRange: id.blockRange,
      },
    } as NavRoute
    const href = routeToHref(route, context)
    if (!href) return
    replace(href, {
      replace: true,
      preventScrollReset: true,
    })
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
    setIsSheetOpen(true)
  }

  // if the server is providing a comment
  const activePanel: WebAccessory | null = comment
    ? {type: 'discussions', comment}
    : _activePanel

  // used to toggle the mobile accessory sheet. If the server is providing a comment, it should be open by default.
  const [isSheetOpen, setIsSheetOpen] = useState(!!comment)

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
      setDocumentPanel({type: 'citations', blockId: blockId})

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
      if (!enableWebSigning && startCommentingNow) {
        redirectToWebIdentityCommenting(id, {
          quotingBlockId: blockId,
        })
      }
      setDocumentPanel({type: 'discussions', blockId: blockId || undefined})
      if (!media.gtSm) {
        setIsSheetOpen(true)
      }
    },
    [media.gtSm],
  )

  const onReplyCountClick = useCallback((comment: HMComment) => {
    setCommentPanel(comment)
  }, [])

  const onReplyClick = useCallback(
    (comment: HMComment) => {
      if (enableWebSigning) {
        setCommentPanel(comment)
        if (!media.gtSm) {
          setIsSheetOpen(true)
        }
      } else {
        redirectToWebIdentityCommenting(id, {
          replyCommentId: comment.id,
          replyCommentVersion: comment.version,
          rootReplyCommentVersion: comment.threadRootVersion,
        })
      }
    },
    [enableWebSigning],
  )

  const activitySummary = (
    <DocInteractionsSummary
      activePanel={activePanel}
      docId={id}
      citations={interactionSummary.data?.citations}
      comments={interactionSummary.data?.comments}
      changes={interactionSummary.data?.changes}
      onCitationsOpen={() => {
        setDocumentPanel({
          type: 'citations',
          blockId: undefined,
        })
        if (!media.gtSm) {
          setIsSheetOpen(true)
        }
      }}
      onCommentsOpen={() => {
        setDocumentPanel({
          type: 'discussions',
          blockId: undefined,
        })
        if (!media.gtSm) {
          setIsSheetOpen(true)
        }
      }}
      onVersionOpen={() => {
        setDocumentPanel({type: 'versions'})
        if (!media.gtSm) {
          setIsSheetOpen(true)
        }
      }}
    />
  )

  const commentEditor =
    activePanel?.type == 'discussions' ? (
      <div className="w-full px-4 py-2">
        {enableWebSigning || WEB_IDENTITY_ENABLED ? (
          <WebCommenting
            autoFocus={editorAutoFocus}
            docId={id}
            replyCommentId={activePanel.comment?.id}
            replyCommentVersion={activePanel.comment?.version}
            rootReplyCommentVersion={
              activePanel.comment?.threadRootVersion ||
              activePanel.comment?.version
            }
            quotingBlockId={activePanel.blockId}
            enableWebSigning={enableWebSigning || false}
            onSuccess={({response}) => {
              setCommentPanel(response.comment)
            }}
          />
        ) : null}
      </div>
    ) : null

  if (activityEnabled && activePanel?.type == 'discussions') {
    panel = (
      <WebDiscussionsPanel
        handleStartDiscussion={() => {
          setEditorAutoFocus(true)
        }}
        blockId={activePanel.blockId}
        comment={activePanel.comment}
        handleBack={() => {
          setDocumentPanel({
            type: 'discussions',
          })
        }}
        setBlockId={onBlockCommentClick}
        docId={id}
        homeId={originHomeId}
        document={document}
        originHomeId={originHomeId}
        siteHost={siteHost}
        enableWebSigning={enableWebSigning || false}
      />
    )

    panelTitle = tx('Discussions')
  }
  if (activityEnabled && activePanel?.type == 'versions') {
    panel = <WebVersionsPanel docId={id} />
    panelTitle = tx('Versions')
  }

  if (activityEnabled && activePanel?.type == 'citations') {
    panel = (
      <WebCitationsPanel
        activitySummary={activitySummary}
        id={id}
        blockId={activePanel.blockId}
        handleBack={() => {
          setDocumentPanel({
            type: 'citations',
          })
        }}
      />
    )
    panelTitle = tx('Citations')
  }

  if (!document)
    return (
      <DocumentDiscoveryPage
        id={id}
        originHomeId={originHomeId}
        homeMetadata={homeMetadata}
        enableWebSigning={enableWebSigning}
      />
    )
  return (
    <DiscussionsProvider
      onReplyClick={onReplyClick}
      onReplyCountClick={onReplyCountClick}
    >
      <div className={windowContainerStyles}>
        <div className={panelContainerStyles}>
          <WebSiteHeader
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
                  <div className="dark:bg-background absolute top-2 right-2 z-[999] rounded-md bg-white shadow-md">
                    {!activePanel &&
                    activityEnabled &&
                    interactionSummary.data ? (
                      <>{activitySummary}</>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex h-full min-h-full flex-1 flex-col">
                  <div className="flex flex-1 overflow-hidden">
                    <ScrollArea>
                      <DocumentCover cover={document.metadata.cover} id={id} />

                      <div
                        className={cn('flex flex-1', wrapperProps.className)}
                        style={wrapperProps.style}
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
                              authors={document.authors.map(
                                (author) => accountsMetadata[author],
                              )}
                              updateTime={document.updateTime}
                            />
                          )}
                          <WebDocContentProvider
                            onBlockCitationClick={
                              activityEnabled ? onBlockCitationClick : undefined
                            }
                            onBlockCommentClick={
                              activityEnabled ? onBlockCommentClick : undefined
                            }
                            originHomeId={originHomeId}
                            id={{...id, version: document.version}}
                            siteHost={siteHost}
                            supportDocuments={supportDocuments}
                            supportQueries={supportQueries}
                            blockCitations={interactionSummary.data?.blocks}
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
                    </ScrollArea>
                  </div>
                  <div className="flex-none">
                    <PageFooter enableWebSigning={enableWebSigning} id={id} />
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
                  <div className="flex shrink-0 items-center justify-center px-3 py-2">
                    <div className="flex flex-1 items-center justify-center">
                      {activitySummary}
                    </div>
                    <Tooltip content={tx('Close')}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="flex-none"
                        onClick={() => {
                          setDocumentPanel(null)
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                    </Tooltip>
                  </div>
                  <div className="dark:bg-background border-border flex items-center border-b bg-white p-3">
                    <Text weight="bold" size="md">
                      {panelTitle}
                    </Text>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <ScrollArea>{panel}</ScrollArea>
                  </div>

                  <div className="border-sidebar-border shrink-0 border-t p-2">
                    {commentEditor}
                  </div>
                </Panel>
              </>
            ) : null}
          </PanelGroup>
        </div>
        {media.gtSm || !activityEnabled ? null : (
          <>
            <Drawer open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <MobileInteractionCardCollapsed
                onClick={() => {
                  setDocumentPanel({type: 'discussions'})
                }}
                interactionSummary={
                  interactionSummary.data ? <>{activitySummary}</> : null
                }
              />
              <DrawerContent>
                <div className="flex h-full flex-1 flex-col overflow-hidden">
                  <DrawerHeader>
                    <div className="flex items-center justify-center">
                      {activitySummary}
                    </div>
                    <div className="border-border border-b px-5 py-2 text-left">
                      <Text weight="semibold">{panelTitle}</Text>
                    </div>
                  </DrawerHeader>
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <ScrollArea>{panel}</ScrollArea>
                  </div>
                  <DrawerFooter>{commentEditor}</DrawerFooter>
                </div>
              </DrawerContent>
            </Drawer>
          </>
        )}
      </div>
    </DiscussionsProvider>
  )
}

function MobileInteractionCardCollapsed({
  onClick,
  interactionSummary,
}: {
  onClick: () => void
  interactionSummary: React.ReactNode
}) {
  const tx = useTx()
  return (
    <div className="dark:bg-background border-sidebar-border fixed right-0 bottom-0 left-0 z-40 flex rounded-md border bg-white p-2 shadow-md">
      <DrawerTrigger asChild>
        <Button
          variant="ghost"
          className="flex min-w-0 flex-1 items-center justify-start"
          onClick={onClick}
        >
          <div className="shrink-0">
            <MessageSquare />
          </div>
          <span className="ml-2 flex-1 truncate text-left">
            {tx('Start a Discussion')}
          </span>
        </Button>
      </DrawerTrigger>
      {interactionSummary}
    </div>
  )
}

function DocumentCover({
  cover,
  id,
}: {
  cover: HMMetadata['cover']
  id: UnpackedHypermediaId | null
}) {
  const imageUrl = useImageUrl()
  if (!cover) return null

  return (
    <div
      className={cn(
        'relative h-[25vh] w-full flex-shrink-0',
        cover ? 'bg-transparent' : 'bg-secondary',
      )}
    >
      <img
        src={imageUrl(cover, 'XL')}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          objectFit: 'cover',
        }}
      />
    </div>
  )
}

function DocumentDiscoveryPage({
  id,
  homeMetadata,
  originHomeId,
  enableWebSigning,
}: {
  id: UnpackedHypermediaId
  homeMetadata: HMMetadata | null
  originHomeId: UnpackedHypermediaId | null
  enableWebSigning?: boolean
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
        <div className="border-border dark:bg-background flex w-full max-w-lg flex-0 flex-1 flex-col gap-4 rounded-lg border bg-white p-6 shadow-lg">
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
      <PageFooter enableWebSigning={enableWebSigning} id={id} />
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
  onCitationsOpen,
  onCommentsOpen,
  onVersionOpen,
  activePanel,
}: {
  docId: UnpackedHypermediaId
  citations?: number
  comments?: number
  changes?: number
  onCitationsOpen?: () => void
  onCommentsOpen?: () => void
  onVersionOpen?: () => void
  activePanel: WebAccessory | null
}) {
  const tx = useTxString()
  return (
    <div className="flex">
      {onVersionOpen && changes && (
        <InteractionSummaryItem
          label={tx(
            'version_count',
            ({count}) => `${count} ${pluralS(count, 'version')}`,
            {
              count: changes || 0,
            },
          )}
          active={activePanel?.type === 'versions'}
          count={changes || 0}
          onClick={onVersionOpen}
          // @ts-ignore
          icon={<HistoryIcon className="size-5" />}
        />
      )}
      {onCitationsOpen && (
        <InteractionSummaryItem
          label={tx(
            'citation_count',
            ({count}) => `${count} ${pluralS(count, 'citation')}`,
            {
              count: citations || 0,
            },
          )}
          active={activePanel?.type === 'citations'}
          count={citations || 0}
          onClick={() => {
            onCitationsOpen()
          }}
          // @ts-ignore
          icon={<BlockQuote className="size-3" />}
        />
      )}

      {onCommentsOpen && (
        <InteractionSummaryItem
          label={tx(
            'comment_count',
            ({count}) => `${count} ${pluralS(count, 'comment')}`,
            {
              count: comments || 0,
            },
          )}
          active={activePanel?.type === 'discussions'}
          count={comments || 0}
          onClick={onCommentsOpen}
          // @ts-ignore
          icon={<MessageSquare className="size-3" />}
        />
      )}
    </div>
  )
}

function InteractionSummaryItem({
  label,
  count,
  onClick,
  icon,
  active,
}: {
  label: string
  count: number
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
        <span className="text-xs">{count}</span>
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
    <div className="flex flex-col gap-2 p-3">
      {blockId ? (
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
    <div className="flex flex-col gap-2 p-3">
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

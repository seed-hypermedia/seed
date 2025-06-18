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
  HMEntityContent,
  hmIdPathToEntityQueryPath,
  HMMetadata,
  hostnameStripProtocol,
  pluralS,
  UnpackedHypermediaId,
  WEB_IDENTITY_ENABLED,
} from '@shm/shared'
import {DiscussionsProvider} from '@shm/shared/discussions-provider'
import '@shm/shared/styles/document.css'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {Button} from '@shm/ui/button'
import {ChangeItem} from '@shm/ui/change-item'
import {DocumentCitationEntry} from '@shm/ui/citations'
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
import {useIsDark} from '@shm/ui/use-is-dark'
import {cn} from '@shm/ui/utils'
import {MessageSquare, X} from 'lucide-react'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {Sheet} from 'tamagui'
import {WebCommenting} from './client-lazy'
import {WebDiscussionsPanel} from './comment-panel'
import {redirectToWebIdentityCommenting} from './commenting-utils'
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

export const documentPageMeta: MetaFunction = ({
  data,
}: {
  data: Wrapped<SiteDocumentPayload>
}) => {
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
  const isDark = useIsDark()
  const mainPanelRef = useRef<ImperativePanelHandle>(null)
  const media = useMedia()
  const [isSheetOpen, setIsSheetOpen] = useState(false)
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
    prefersLanguages,
  } = props

  useEffect(() => {
    if (!id) return
    addRecent(id.id, document?.metadata?.name || '')
  }, [id, document?.metadata?.name])

  useEffect(() => {
    if (comment) setActivePanel({type: 'discussions', comment: comment})
  }, [comment])

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

  const [activePanel, setActivePanel] = useState<WebAccessory | null>(() => {
    return {type: 'discussions', comment: comment}
  })

  const onActivateBlock = useCallback((blockId: string) => {
    replace(window.location.pathname + window.location.search + `#${blockId}`, {
      replace: true,
    })
    const targetElement = window.document.getElementById(blockId)

    if (targetElement) {
      targetElement.scrollIntoView({behavior: 'smooth', block: 'start'})
    } else {
      console.error('Element not found:', blockId)
    }
  }, [])

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
      setActivePanel({type: 'citations', blockId: blockId})

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
      setActivePanel({type: 'discussions', blockId: blockId || undefined})
      if (!media.gtSm) {
        setIsSheetOpen(true)
      }
    },
    [media.gtSm],
  )

  const onReplyCountClick = useCallback((comment: HMComment) => {
    setActivePanel({
      type: 'discussions',
      comment: comment,
    })
  }, [])

  const onReplyClick = useCallback(
    (comment: HMComment) => {
      if (enableWebSigning) {
        setActivePanel({
          type: 'discussions',
          comment: comment,
        })
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
        setActivePanel({
          type: 'citations',
          blockId: undefined,
        })
        if (!media.gtSm) {
          setIsSheetOpen(true)
        }
      }}
      onCommentsOpen={() => {
        setActivePanel({
          type: 'discussions',
          blockId: undefined,
        })
        if (!media.gtSm) {
          setIsSheetOpen(true)
        }
      }}
      onVersionOpen={() => {
        setActivePanel({type: 'versions'})
        if (!media.gtSm) {
          setIsSheetOpen(true)
        }
      }}
    />
  )

  const commentEditor =
    activePanel?.type == 'discussions' ? (
      <div className="px-4 py-2 w-full">
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
              setActivePanel({
                ...activePanel,
                comment: response.comment,
              })
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
        handleBack={() =>
          setActivePanel({
            ...activePanel,
            comment: undefined,
            blockId: undefined,
          })
        }
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
        handleClose={() => {
          setActivePanel(null)
        }}
        handleBack={() =>
          setActivePanel({
            ...activePanel,
            blockId: undefined,
          })
        }
      />
    )
    panelTitle = tx('Citations')
  }

  if (!id) return <NotFoundPage {...props} />
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
    <WebSiteProvider
      origin={origin}
      originHomeId={props.originHomeId}
      siteHost={siteHost}
      prefersLanguages={supportedLanguages(prefersLanguages)}
    >
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
              className="flex overflow-hidden flex-1 bg-white dark:bg-background"
            >
              <Panel
                ref={mainPanelRef}
                collapsible
                id="main-panel"
                className="h-full"
              >
                <div className="flex relative flex-col h-full" ref={elementRef}>
                  {media.gtSm ? (
                    <div className="absolute top-2 right-2 z-[999] bg-white dark:bg-background shadow-md rounded-md">
                      {!activePanel &&
                      activityEnabled &&
                      interactionSummary.data ? (
                        <>{activitySummary}</>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex overflow-y-auto flex-col flex-1 min-h-full">
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
                          <div className="overflow-scroll pb-6 h-full hide-scrollbar">
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
                              // Replace the URL to not include fragment.
                              replace(
                                window.location.pathname +
                                  window.location.search,
                                {
                                  replace: true,
                                  preventScrollReset: true,
                                },
                              )
                              return true
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

                    <PageFooter enableWebSigning={enableWebSigning} id={id} />
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
                    className="flex flex-col flex-1 h-full border-l border-sidebar-border"
                  >
                    <div className="flex justify-center items-center px-3 py-2 shrink-0">
                      <div className="flex flex-1 justify-center items-center">
                        {activitySummary}
                      </div>
                      <Tooltip content={tx('Close')}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="flex-none"
                          onClick={() => {
                            setActivePanel(null)
                          }}
                        >
                          <X className="size-4" />
                        </Button>
                      </Tooltip>
                    </div>
                    <div className="flex items-center p-3 bg-white border-b dark:bg-background border-border">
                      <Text weight="bold" size="md">
                        {panelTitle}
                      </Text>
                    </div>
                    <div className="overflow-hidden flex-1">
                      <ScrollArea>{panel}</ScrollArea>
                    </div>

                    <div className="p-2 border-t border-sidebar-border shrink-0">
                      {commentEditor}
                    </div>
                  </Panel>
                </>
              ) : null}
            </PanelGroup>
          </div>
          {media.gtSm || !activityEnabled ? null : (
            <>
              <MobileInteractionCardCollapsed
                onClick={() => {
                  if (!panel) {
                    setActivePanel({type: 'discussions', blockId: undefined})
                  }
                  setIsSheetOpen(true)
                }}
                interactionSummary={
                  interactionSummary.data ? <>{activitySummary}</> : null
                }
              />
              <Sheet
                snapPoints={[92]}
                onOpenChange={setIsSheetOpen}
                modal
                open={isSheetOpen}
                dismissOnSnapToBottom
                zIndex={99999}
              >
                <Sheet.Overlay
                  height="100vh"
                  bg={'#00000088'}
                  width="100vw"
                  animation="fast"
                  opacity={0.8}
                  enterStyle={{opacity: 0}}
                  exitStyle={{opacity: 0}}
                />
                <Sheet.Handle />
                <Sheet.Frame
                  bg={isDark ? '$background' : '$backgroundStrong'}
                  borderColor="$borderColor"
                  borderWidth={1}
                  borderRadius="$4"
                >
                  <Sheet.ScrollView f={1} h="100%" overflow="scroll" flex={1}>
                    {panel}
                  </Sheet.ScrollView>
                  <div className="p-2 border-t border-sidebar-border">
                    {commentEditor}
                  </div>
                </Sheet.Frame>
              </Sheet>
            </>
          )}
        </div>
      </DiscussionsProvider>
    </WebSiteProvider>
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
    <div
      className="flex fixed bottom-0 left-0 right-0 z-[999] p-2 bg-white dark:bg-background shadow-md rounded-md shadow-md border border-sidebar-border"
      onClick={onClick}
    >
      <Button
        variant="ghost"
        className="flex flex-1 justify-start items-center min-w-0"
      >
        <div className="shrink-0">
          <MessageSquare />
        </div>
        <span className="flex-1 ml-2 text-left truncate">
          {tx('Start a Discussion')}
        </span>
      </Button>
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
        'relative flex-shrink-0 w-full h-[25vh]',
        cover ? 'bg-transparent' : 'bg-(--brand11)',
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
  return (
    <div className="flex flex-col w-screen h-screen">
      <div className="flex flex-1 justify-center items-start px-4 py-12">
        <div className="flex flex-col flex-1 gap-4 p-6 w-full max-w-lg bg-white rounded-lg border shadow-lg border-border flex-0 dark:bg-background">
          <h2 className="text-2xl font-bold">Looking for a document...</h2>

          <p>
            Hang tight! We're currently searching the network to locate your
            document. This may take a moment as we retrieve the most up-to-date
            version.
          </p>
          <p>
            If the document is available, it will appear shortly. Thank you for
            your patience!
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
    <DocNavigationWrapper showCollapsed={showCollapsed}>
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
  return (
    <div className="flex">
      {onCitationsOpen && (
        <InteractionSummaryItem
          label="citation"
          active={activePanel?.type === 'citations'}
          count={citations || 0}
          onClick={() => {
            console.log('~ onCitationsOpen')
            onCitationsOpen()
          }}
          // @ts-ignore
          icon={<BlockQuote className="size-3" />}
        />
      )}

      {onCommentsOpen && (
        <InteractionSummaryItem
          label="comment"
          active={activePanel?.type === 'discussions'}
          count={comments || 0}
          onClick={onCommentsOpen}
          // @ts-ignore
          icon={<MessageSquare className="size-3" />}
        />
      )}

      {onVersionOpen && changes && (
        <InteractionSummaryItem
          label="version"
          active={activePanel?.type === 'versions'}
          count={changes || 0}
          onClick={onVersionOpen}
          // @ts-ignore
          icon={<HistoryIcon className="size-5" />}
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
    <Tooltip content={`${count} ${pluralS(count, label)}`}>
      <Button
        onClick={onClick}
        variant="ghost"
        className={cn(' p-0', active && 'bg-accent')}
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
  handleClose,
}: {
  activitySummary: React.ReactNode
  id: UnpackedHypermediaId
  blockId?: string
  handleBack: () => void
  handleClose: () => void
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
  const tx = useTx()
  return (
    <div className="flex flex-col gap-2 p-3">
      {blockId ? (
        <AccessoryBackButton onPress={handleBack} label={tx('All Citations')} />
      ) : null}
      {displayCitations ? (
        displayCitations.map((citation) => {
          return <DocumentCitationEntry citation={citation} />
        })
      ) : (
        <div className="flex justify-center items-center">
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

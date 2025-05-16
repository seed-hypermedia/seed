import {useCitations, useComments, useDocumentChanges} from '@/models'
import {HeadersFunction, MetaFunction} from '@remix-run/node'
import {useLocation, useNavigate} from '@remix-run/react'
import {
  getDocumentTitle,
  HMCitationsPayload,
  HMCommentsPayload,
  HMDocument,
  HMDocumentCitation,
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
import {DocumentCitationEntry} from '@shm/ui/citations'
import {Container} from '@shm/ui/container'
import {DocContent} from '@shm/ui/document-content'
import {extractIpfsUrlCid, useImageUrl} from '@shm/ui/get-file-url'
import {BlockQuote, HistoryIcon, IconComponent} from '@shm/ui/icons'
import {useDocumentLayout} from '@shm/ui/layout'
import {
  DocNavigationWrapper,
  DocumentOutline,
  useNodesOutline,
} from '@shm/ui/navigation'
import {Spinner} from '@shm/ui/spinner'
import {Tooltip} from '@shm/ui/tooltip'
import {useIsDark} from '@shm/ui/use-is-dark'
import {MessageSquare, X} from '@tamagui/lucide-icons'
import {XStack, YStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels'
import {ScrollView, Separator, Sheet, useMedia} from 'tamagui'
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
      commentId?: string
      rootReplyCommentId?: string
    }

export function DocumentPage(props: SiteDocumentPayload) {
  const isDark = useIsDark()
  const mainPanelRef = useRef<ImperativePanelHandle>(null)
  const media = useMedia()
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [editorAutoFocus, setEditorAutoFocus] = useState(false)

  let panel: any = null
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
  } = props

  useEffect(() => {
    if (!id) return
    addRecent(id.id, document?.metadata?.name || '')
  }, [id, document?.metadata?.name])

  useEffect(() => {
    if (comment) setActivePanel({type: 'discussions', commentId: comment.id})
  }, [comment])

  useEffect(() => {
    if (media.gtSm) {
      const mainPanel = mainPanelRef.current
      if (!mainPanel) return
      if (panel) {
        mainPanel.resize(60)
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

  const isHomeDoc = !id.path?.length
  const isShowOutline =
    (typeof document.metadata.showOutline == 'undefined' ||
      document.metadata.showOutline) &&
    !isHomeDoc
  const showSidebarOutlineDirectory = isShowOutline && !isHomeDoc

  const location = useLocation()
  const replace = useNavigate()
  // const match = location.hash.match(/^(.+?)(?:\[(\d+):(\d+)\])?$/);
  // const blockRef = match ? match[1].substring(1) : undefined;

  // const blockRange =
  //   match && match[2] && match[3]
  //     ? {start: parseInt(match[2]), end: parseInt(match[3])}
  //     : undefined;

  const {blockRef, blockRange} = useMemo(() => {
    const match = location.hash.match(/^(.+?)(?:\[(\d+):(\d+)\])?$/)
    const blockRef = match ? match[1].substring(1) : undefined
    const blockRange =
      match && match[2] && match[3]
        ? {start: parseInt(match[2]), end: parseInt(match[3])}
        : undefined

    return {blockRef, blockRange}
  }, [location.hash])

  const [activePanel, setActivePanel] = useState<WebAccessory | null>(() => {
    return {type: 'discussions', commentId: comment ? comment.id : undefined}
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

  const allCitations = useCitations(id)
  const citations: Array<HMDocumentCitation> = useMemo(() => {
    if (!allCitations.data) return []
    return allCitations.data.filter(
      (c): c is HMDocumentCitation => c.source.type === 'd',
    )
  }, [allCitations.data])

  const comments = useComments(id)

  function onBlockCitationClick(blockId?: string) {
    setActivePanel({type: 'citations', blockId: blockId})

    if (!media.gtSm) {
      const mainPanel = mainPanelRef.current
      if (!mainPanel) return
      setTimeout(() => {
        mainPanel.collapse()
      }, 1)
    }
  }

  function onBlockCommentClick(blockId?: string | null) {
    setActivePanel({type: 'discussions', blockId: blockId || undefined})
    if (!media.gtSm) {
      setIsSheetOpen(true)
    }
  }

  const onReplyCountClick = useCallback(
    (commentId: string, rootReplyCommentId: string) => {
      setActivePanel({
        type: 'discussions',
        commentId: commentId,
        rootReplyCommentId,
      })
    },
    [],
  )

  const onReplyClick = useCallback(
    (commentId: string, rootReplyCommentId: string) => {
      if (enableWebSigning) {
        setActivePanel({
          type: 'discussions',
          commentId,
          rootReplyCommentId,
        })
        if (!media.gtSm) {
          setIsSheetOpen(true)
        }
      } else {
        redirectToWebIdentityCommenting(id, commentId, rootReplyCommentId)
      }
    },
    [enableWebSigning],
  )

  const commentEditor =
    activePanel?.type == 'discussions' ? (
      <XStack
        paddingHorizontal="$4"
        paddingVertical="$2"
        w="100%"
        borderTopWidth={1}
        borderTopColor="$borderColor"
      >
        {enableWebSigning || WEB_IDENTITY_ENABLED ? (
          <WebCommenting
            autoFocus={editorAutoFocus}
            docId={id}
            replyCommentId={activePanel.commentId}
            rootReplyCommentId={activePanel.rootReplyCommentId}
            enableWebSigning={enableWebSigning || false}
            onSuccess={(data) => {
              setActivePanel({
                ...activePanel,
                commentId: data.id,
              })
            }}
          />
        ) : null}
      </XStack>
    ) : null
  if (activePanel?.type == 'discussions') {
    panel = (
      <WebDiscussionsPanel
        handleStartDiscussion={() => {
          setEditorAutoFocus(true)
        }}
        blockId={activePanel.blockId}
        commentId={activePanel.commentId}
        rootReplyCommentId={activePanel.rootReplyCommentId}
        handleClose={() => {
          setActivePanel(null)
        }}
        handleBack={() =>
          setActivePanel({
            ...activePanel,
            commentId: undefined,
            blockId: undefined,
            rootReplyCommentId: undefined,
          })
        }
        setBlockId={onBlockCommentClick}
        comments={comments.data}
        citations={allCitations.data}
        docId={id}
        homeId={originHomeId}
        document={document}
        originHomeId={originHomeId}
        siteHost={siteHost}
        enableWebSigning={enableWebSigning || false}
      />
    )
  }

  if (activePanel?.type == 'citations') {
    panel = (
      <WebCitationsPanel
        handleClose={() => {
          setActivePanel(null)
        }}
        citations={citations}
        handleBack={() =>
          setActivePanel({
            ...activePanel,
            blockId: undefined,
          })
        }
      />
    )
  }

  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={props.originHomeId}
      siteHost={siteHost}
    >
      <DiscussionsProvider
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
      >
        <WebSiteHeader
          noScroll={!!panel}
          homeMetadata={homeMetadata}
          originHomeId={originHomeId}
          docId={id}
          document={document}
          supportDocuments={supportDocuments}
          supportQueries={supportQueries}
          origin={origin}
        >
          <PanelGroup direction="horizontal">
            <Panel
              ref={mainPanelRef}
              collapsible
              id="main-panel"
              style={{overflowY: panel ? 'scroll' : undefined}}
            >
              <XStack
                w="100%"
                bg={isDark ? '$background' : '$backgroundStrong'}
                marginBottom={56}
                $gtSm={{
                  marginBottom: 0,
                }}
              >
                <YStack f={1}>
                  <DocumentCover cover={document.metadata.cover} id={id} />
                  <YStack w="100%" ref={elementRef} f={1} position="relative">
                    {!media.gtSm ? null : panel == null ? (
                      <XStack
                        position="absolute"
                        top={0}
                        right={8}
                        zIndex="$zIndex.7"
                        padding="$4"
                      >
                        <DocInteractionsSummary
                          docId={id}
                          citations={citations}
                          comments={comments.data}
                          onCitationsOpen={() => {
                            setActivePanel({type: 'citations'})
                            if (!media.gtSm) {
                              setIsSheetOpen(true)
                            }
                          }}
                          onCommentsOpen={() => {
                            setActivePanel({type: 'discussions'})
                            if (!media.gtSm) {
                              setIsSheetOpen(true)
                            }
                          }}
                          // onVersionOpen={() => {}}
                        />
                      </XStack>
                    ) : null}
                    <XStack {...wrapperProps}>
                      {showSidebars ? (
                        <YStack
                          marginTop={document.metadata?.cover ? 152 : 220}
                          {...sidebarProps}
                        >
                          <YStack
                            className="hide-scrollbar"
                            overflow="scroll"
                            height="100%"
                            // paddingTop={32}
                            paddingBottom={32}
                          >
                            <WebDocumentOutline
                              showCollapsed={showCollapsed}
                              supportDocuments={props.supportDocuments}
                              onActivateBlock={onActivateBlock}
                              id={id}
                              document={document}
                            />
                            {/* <DocNavigationWrapper showCollapsed={showCollapsed}>
                              <DocumentOutline
                                onActivateBlock={onActivateBlock}
                                document={document}
                                id={id}
                                // onCloseNav={() => {}}
                                supportDocuments={props.supportDocuments}
                                activeBlockId={id.blockRef}
                              />
                            </DocNavigationWrapper> */}
                          </YStack>
                        </YStack>
                      ) : null}
                      <YStack {...mainContentProps}>
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
                          onBlockCitationClick={onBlockCitationClick}
                          onBlockCommentClick={onBlockCommentClick}
                          originHomeId={originHomeId}
                          id={{...id, version: document.version}}
                          siteHost={siteHost}
                          supportDocuments={supportDocuments}
                          supportQueries={supportQueries}
                          citations={allCitations.data}
                          routeParams={{
                            uid: id.uid,
                            version: id.version || undefined,
                            blockRef: blockRef,
                            blockRange: blockRange,
                          }}
                          // onHoverIn={(id) => {
                          //   console.log('=== BLOCK HOVER EFFECT: hover in', id)
                          // }}
                          // onHoverOut={(id) => {
                          //   console.log('=== BLOCK HOVER EFFECT: hover out', id)
                          // }}
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
                      </YStack>
                      {showSidebars ? <YStack {...sidebarProps} /> : null}
                    </XStack>
                  </YStack>
                  <PageFooter enableWebSigning={enableWebSigning} id={id} />
                </YStack>
              </XStack>
            </Panel>
            {!media.gtSm ? null : panel ? (
              <>
                <PanelResizeHandle className="panel-resize-handle" />

                <Panel
                  defaultSize={media.gtSm ? 30 : 100}
                  maxSize={media.gtSm ? 40 : 100}
                  minSize={media.gtSm ? 20 : 100}
                >
                  <YStack
                    bg={isDark ? '$background' : '$backgroundStrong'}
                    borderLeftWidth={1}
                    borderLeftColor="$borderColor"
                    minHeight="100%"
                    height="100%"
                    top={0}
                    right={0}
                    gap="$4"
                  >
                    <ScrollView f={1} h="100%" overflow="scroll" flex={1}>
                      {panel}
                    </ScrollView>
                    {commentEditor}
                  </YStack>
                </Panel>
              </>
            ) : null}
          </PanelGroup>
        </WebSiteHeader>
        {media.gtSm ? null : (
          <>
            <XStack
              // @ts-expect-error tamagui mistake
              position="fixed"
              bottom={0}
              left={0}
              right={0}
              zIndex="$zIndex.9"
              bg={isDark ? '$background' : '$backgroundStrong'}
              p="$4"
              boxShadow="0px 0px 20px 0px rgba(0, 0, 0, 0.2)"
              height={56}
              jc="flex-end"
              borderRadius="$4"
              borderBottomLeftRadius={0}
              borderBottomRightRadius={0}
              overflow="hidden"
              onPress={() => {
                if (!panel) {
                  setActivePanel({type: 'discussions', blockId: null})
                }
                setIsSheetOpen(true)
              }}
            >
              <DocInteractionsSummary
                docId={id}
                citations={citations}
                comments={comments.data}
                onCitationsOpen={() => {
                  setActivePanel({type: 'citations', blockId: undefined})
                  if (!media.gtSm) {
                    setIsSheetOpen(true)
                  }
                }}
                onCommentsOpen={() => {
                  setActivePanel({type: 'discussions', blockId: undefined})
                  if (!media.gtSm) {
                    setIsSheetOpen(true)
                  }
                }}
                // onVersionOpen={() => {}}
              />
            </XStack>

            <Sheet
              snapPoints={[92]}
              onOpenChange={setIsSheetOpen}
              modal
              open={isSheetOpen}
              dismissOnSnapToBottom
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
                <XStack jc="flex-end" padding="$4">
                  <DocInteractionsSummary
                    docId={id}
                    citations={citations}
                    comments={comments.data}
                    onCitationsOpen={() => {
                      setActivePanel({type: 'citations', blockId: undefined})
                      if (!media.gtSm) {
                        setIsSheetOpen(true)
                      }
                    }}
                    onCommentsOpen={() => {
                      setActivePanel({type: 'discussions', blockId: undefined})
                      if (!media.gtSm) {
                        setIsSheetOpen(true)
                      }
                    }}
                    // onVersionOpen={() => {}}
                  />
                </XStack>
                <Sheet.ScrollView f={1} h="100%" overflow="scroll" flex={1}>
                  {/* <YStack f={1}>
                    {new Array(2000).fill(0).map((_, i) => (
                      <SizableText key={i} h={20} w="100%">
                        {i}
                      </SizableText>
                    ))}
                  </YStack> */}
                  {panel}
                </Sheet.ScrollView>
                <XStack paddingVertical="$2">{commentEditor}</XStack>
              </Sheet.Frame>
            </Sheet>
          </>
        )}
      </DiscussionsProvider>
    </WebSiteProvider>
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
    <XStack
      backgroundColor={cover ? '$backgroundTransparent' : 'brand11'}
      height="25vh"
      width="100%"
      position="relative"
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
    </XStack>
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
    <YStack>
      <PageHeader
        originHomeId={originHomeId}
        docMetadata={null}
        docId={id}
        authors={[]}
        updateTime={null}
        breadcrumbs={[]}
      />
      <YStack>
        <Container>
          <YStack
            alignSelf="center"
            width={600}
            gap="$5"
            borderWidth={1}
            borderColor="$color8"
            borderRadius="$4"
            padding="$5"
            elevation="$4"
          >
            <XStack alignItems="center" gap="$3">
              <SizableText size="$8" fontWeight="bold">
                Looking for a document...
              </SizableText>
            </XStack>
            <YStack gap="$3">
              <SizableText>
                Hang tight! We're currently searching the network to locate your
                document. This may take a moment as we retrieve the most
                up-to-date version.
              </SizableText>
              <SizableText>
                If the document is available, it will appear shortly. Thank you
                for your patience!
              </SizableText>
            </YStack>
          </YStack>
        </Container>
      </YStack>
      <PageFooter enableWebSigning={enableWebSigning} id={id} />
    </YStack>
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
  onCitationsOpen,
  onCommentsOpen,
  onVersionOpen,
}: {
  docId: UnpackedHypermediaId
  citations?: HMCitationsPayload
  comments?: HMCommentsPayload
  onCitationsOpen?: () => void
  onCommentsOpen?: () => void
  onVersionOpen?: () => void
}) {
  const changes = useDocumentChanges(docId)
  return (
    <XStack gap="$1.5">
      {onCitationsOpen && (
        <InteractionSummaryItem
          label="citation"
          count={citations?.length || 0}
          onPress={() => {
            console.log('~ onCitationsOpen')
            onCitationsOpen()
          }}
          icon={BlockQuote}
        />
      )}
      <Separator />
      {onCommentsOpen && (
        <InteractionSummaryItem
          label="comment"
          count={comments?.allComments.length || 0}
          onPress={onCommentsOpen}
          icon={MessageSquare}
        />
      )}
      <Separator />
      {onVersionOpen && (
        <InteractionSummaryItem
          label="version"
          count={changes.data?.length || 0}
          onPress={() => {
            console.log('~ onVersionOpen')
            onVersionOpen()
          }}
          icon={HistoryIcon}
        />
      )}
    </XStack>
  )
}

function InteractionSummaryItem({
  label,
  count,
  onPress,
  icon: Icon,
}: {
  label: string
  count: number
  onPress: () => void
  icon: IconComponent
}) {
  return (
    <Tooltip content={`${count} ${pluralS(count, label)}`}>
      <Button onPress={onPress} size="$1" chromeless icon={Icon}>
        <SizableText size="$1">{count}</SizableText>
      </Button>
    </Tooltip>
  )
}

function WebCitationsPanel({
  citations,
  blockId,
  handleBack,
  handleClose,
}: {
  citations?: Array<HMDocumentCitation>
  blockId?: string
  handleBack: () => void
  handleClose: () => void
}) {
  const filteredCitations = useMemo(() => {
    if (!blockId || !citations) return citations
    return citations?.filter(
      (citation) =>
        citation.targetFragment && citation.targetFragment?.blockId === blockId,
    )
  }, [citations, blockId])
  const isDark = useIsDark()
  return (
    <YStack gap="$4">
      <XStack
        paddingHorizontal="$4"
        paddingVertical="$3"
        alignItems="center"
        position="sticky"
        top={0}
        zIndex="$zIndex.8"
        h={56}
        borderBottomWidth={1}
        borderBottomColor="$borderColor"
        bg={isDark ? '$background' : '$backgroundStrong'}
        justifyContent="space-between"
      >
        <SizableText size="$3" fontWeight="bold">
          Citations
        </SizableText>
        <Button
          alignSelf="center"
          display="none"
          $gtSm={{display: 'flex'}}
          icon={X}
          chromeless
          onPress={handleClose}
        />
      </XStack>
      <YStack gap="$2" padding="$3">
        {blockId ? (
          <AccessoryBackButton onPress={handleBack} label="All Citations" />
        ) : null}
        {filteredCitations ? (
          filteredCitations.map((citation) => {
            return <DocumentCitationEntry citation={citation} />
          })
        ) : (
          <Spinner />
        )}
      </YStack>
    </YStack>
  )
}

import {useActivity, useCitations, useDocumentChanges} from '@/models'
import {HeadersFunction, MetaFunction} from '@remix-run/node'
import {useLocation, useNavigate} from '@remix-run/react'
import {
  formattedDateMedium,
  getDocumentTitle,
  HMCitationsPayload,
  HMComment,
  HMDocument,
  hmIdPathToEntityQueryPath,
  HMMetadata,
  hostnameStripProtocol,
  pluralS,
  UnpackedHypermediaId,
  WEB_IDENTITY_ENABLED,
} from '@shm/shared'
import {getActivityTime} from '@shm/shared/models/activity'
import '@shm/shared/styles/document.css'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {ChangeGroup, SubDocumentItem} from '@shm/ui/activity'
import {Button} from '@shm/ui/button'
import {DocumentCitationEntry} from '@shm/ui/citations'
import {Container} from '@shm/ui/container'
import {CommentGroup} from '@shm/ui/discussion'
import {BlocksContent, DocContent} from '@shm/ui/document-content'
import {extractIpfsUrlCid, useImageUrl} from '@shm/ui/get-file-url'
import {BlockQuote, HistoryIcon, IconComponent} from '@shm/ui/icons'
import {useDocumentLayout} from '@shm/ui/layout'
import {
  DocDirectory,
  DocNavigationWrapper,
  DocumentOutline,
} from '@shm/ui/navigation'
import {ActivitySection} from '@shm/ui/page-components'
import {Spinner} from '@shm/ui/spinner'
import {Tooltip} from '@shm/ui/tooltip'
import {useIsDark} from '@shm/ui/use-is-dark'
import {ChevronUp, MessageSquare, X} from '@tamagui/lucide-icons'
import {XStack, YStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import React, {useCallback, useEffect, useMemo, useState} from 'react'
import {Separator, View} from 'tamagui'
import {WebCommenting} from './client-lazy'
import {OpenCommentPanel} from './comment-panel'
import {CommentReplies, CommentRepliesEditor} from './comment-rendering'
import {WebDocContentProvider} from './doc-content-provider'
import type {SiteDocumentPayload} from './loaders'
import {addRecent, getRecents} from './local-db-recents'
import {defaultSiteIcon} from './meta'
import {NewspaperPage} from './newspaper'
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
      blockId: string | null
    }
  | {
      type: 'comments'
    }

export function DocumentPage(props: SiteDocumentPayload) {
  const isDark = useIsDark()
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
    addRecent(id.id, document?.metadata?.name || '').then(() => {
      getRecents().then((recents) => {
        console.log('added to recents', recents)
      })
    })
  }, [id, document?.metadata?.name])

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
  if (document.metadata.layout == 'Seed/Experimental/Newspaper') {
    return (
      <WebSiteProvider
        origin={origin}
        originHomeId={props.originHomeId}
        siteHost={siteHost}
      >
        <NewspaperPage {...props} />;
      </WebSiteProvider>
    )
  }

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
    if (comment) return {type: 'comments'}
    return null
  })

  useEffect(() => {
    if (comment) setActivePanel({type: 'comments'})
  }, [comment])

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

  const citations = useCitations(id)

  let panel = null

  const onCitationClick = (blockId?: string | null) => {
    console.log('~ onCitationClick', blockId)
    setActivePanel({type: 'citations', blockId: blockId || null})
  }

  if (activePanel?.type == 'comments' && comment) {
    panel = (
      <OpenCommentPanel
        comment={comment}
        docId={id}
        siteHost={siteHost}
        enableWebSigning={enableWebSigning}
      />
    )
    // } else if (blockRef) {
    //   panel = <BlockCommentsPanel blockRef={blockRef} docId={id} />
  }

  if (activePanel?.type == 'citations') {
    panel = (
      <WebCitationsPanel
        citations={citations.data}
        blockId={activePanel.blockId}
        setBlockId={(blockId) => setActivePanel({type: 'citations', blockId})}
      />
    )
  }

  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={props.originHomeId}
      siteHost={siteHost}
    >
      <WebSiteHeader
        homeMetadata={homeMetadata}
        originHomeId={originHomeId}
        docId={id}
        document={document}
        supportDocuments={supportDocuments}
        supportQueries={supportQueries}
        origin={origin}
      >
        <XStack w="100%">
          <YStack f={1}>
            <DocumentCover cover={document.metadata.cover} id={id} />
            <YStack w="100%" ref={elementRef} f={1} position="relative">
              <DocInteractionsSummary
                docId={id}
                citations={citations.data}
                onCitationsOpen={() =>
                  setActivePanel({type: 'citations', blockId: null})
                }
                onCommentsOpen={
                  comment ? () => setActivePanel({type: 'comments'}) : undefined
                }
                // onVersionOpen={() => {}}
              />
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
                      <DocNavigationWrapper showCollapsed={showCollapsed}>
                        <DocumentOutline
                          onActivateBlock={onActivateBlock}
                          document={document}
                          id={id}
                          // onCloseNav={() => {}}
                          supportDocuments={props.supportDocuments}
                          activeBlockId={id.blockRef}
                        />
                        <DocDirectory
                          // supportDocuments={props.supportDocuments}
                          supportQueries={props.supportQueries}
                          // documentMetadata={document.metadata}
                          id={id}
                        />
                      </DocNavigationWrapper>
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
                    onCitationClick={onCitationClick}
                    originHomeId={originHomeId}
                    id={{...id, version: document.version}}
                    siteHost={siteHost}
                    supportDocuments={supportDocuments}
                    supportQueries={supportQueries}
                    citations={citations.data}
                    routeParams={{
                      blockRef: blockRef,
                      blockRange: blockRange,
                    }}
                  >
                    <DocContent
                      document={document}
                      handleBlockReplace={() => {
                        // Replace the URL to not include fragment.
                        replace(
                          window.location.pathname + window.location.search,
                          {
                            replace: true,
                            preventScrollReset: true,
                          },
                        )
                        return true
                      }}
                    />
                  </WebDocContentProvider>
                  {document.metadata &&
                  document.metadata.showActivity === false ? null : (
                    <DocumentAppendix
                      id={id}
                      document={document}
                      originHomeId={originHomeId}
                      siteHost={siteHost}
                      enableWebSigning={enableWebSigning}
                    />
                  )}
                </YStack>
                {showSidebars ? <YStack {...sidebarProps} /> : null}
              </XStack>
            </YStack>
          </YStack>
          {panel ? (
            <YStack
              $sm={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                left: 0,
                zIndex: '$zIndex.7',
              }}
              $md={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                left: 0,
                zIndex: '$zIndex.7',
              }}
              // position="absolute"
              // right={0}
              // top={0}
              // bottom={0}
              // left={0}
              // zIndex="$zIndex.7"
              // f={1}
              // w="100%"
              // h="100%"
              bg={isDark ? '$background' : '$backgroundStrong'}
              $gtMd={{
                maxWidth: '25vw',
                minWidth: 220,
                w: '100%',
                borderLeftWidth: 1,
                borderBottomWidth: 1,
                borderLeftColor: '$color7',
                borderBottomColor: '$color7',
                borderBottomLeftRadius: '$2',
                position: 'relative',
                minHeight: '100%',
                top: 'unset',
                bottom: 'unset',
                left: 'unset',
                right: 'unset',

                // position: 'sticky',
                // height: 'calc(100vh - 56px)',
                // right: 0,
                // top: 56,
                // bottom: 0,
                // left: undefined,
              }}
            >
              <XStack
                paddingHorizontal="$2"
                paddingVertical="$2"
                alignItems="center"
                position="absolute"
                top={0}
                right={12}
                $gtMd={{
                  right: 0,
                }}
                zIndex="$zIndex.2"
              >
                <View flex={1} />
                <Tooltip content="Close Panel">
                  <Button
                    chromeless
                    size="$2"
                    icon={<X size={20} />}
                    onPress={() => {
                      setActivePanel(null)
                    }}
                  />
                </Tooltip>
              </XStack>
              {panel}
            </YStack>
          ) : null}
        </XStack>
      </WebSiteHeader>
      <PageFooter enableWebSigning={enableWebSigning} id={id} />
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

function DocumentAppendix({
  id,
  document,
  originHomeId,
  siteHost,
  enableWebSigning,
}: {
  id: UnpackedHypermediaId
  document: HMDocument
  originHomeId: UnpackedHypermediaId
  siteHost: string | undefined
  enableWebSigning?: boolean
}) {
  const docIdWithVersion: UnpackedHypermediaId = {
    ...id,
    version: document.version,
  }
  return (
    <Container>
      <ActivitySection>
        <DocumentActivity
          id={docIdWithVersion}
          document={document}
          originHomeId={originHomeId}
          siteHost={siteHost}
          enableReplies={enableWebSigning || WEB_IDENTITY_ENABLED}
          enableWebSigning={enableWebSigning || false}
        />

        {enableWebSigning || WEB_IDENTITY_ENABLED ? (
          <WebCommenting
            docId={docIdWithVersion}
            replyCommentId={null}
            rootReplyCommentId={null}
            enableWebSigning={enableWebSigning || false}
          />
        ) : null}
      </ActivitySection>
    </Container>
  )
}

function DocumentActivity({
  id,
  originHomeId,
  document,
  siteHost,
  enableReplies,
  enableWebSigning,
}: {
  id: UnpackedHypermediaId
  originHomeId: UnpackedHypermediaId
  document: HMDocument
  siteHost: string | undefined
  enableReplies: boolean | undefined
  enableWebSigning: boolean
}) {
  const activity = useActivity(id)
  const renderCommentContent = useCallback(
    (comment: HMComment) => {
      return (
        <WebDocContentProvider
          key={comment.id}
          originHomeId={originHomeId}
          id={id}
          siteHost={siteHost}
          comment={true}
        >
          <BlocksContent blocks={comment.content} parentBlockId={null} />
        </WebDocContentProvider>
      )
    },
    [originHomeId],
  )
  const [visibleCount, setVisibleCount] = useState(10)
  const activeChangeIds = new Set<string>(document.version?.split('.') || [])
  const activityItems = activity.data?.activity
  const accountsMetadata = activity.data?.accountsMetadata
  const latestDocChanges = new Set<string>(
    activity.data?.latestVersion?.split('.') || [],
  )
  if (!activityItems || !accountsMetadata) return null
  if (!activity) return null
  const prevActivity = activityItems.at(-visibleCount)
  const prevActivityTime = prevActivity && getActivityTime(prevActivity)

  return (
    <>
      {visibleCount < activityItems.length && prevActivity && (
        <Button
          onPress={() => setVisibleCount((count) => count + 10)}
          size="$2"
          icon={ChevronUp}
        >
          {prevActivityTime
            ? `Activity before ${formattedDateMedium(prevActivityTime)}`
            : 'Previous Activity'}
        </Button>
      )}
      {activityItems.slice(-visibleCount).map((activityItem, index) => {
        if (activityItem.type === 'commentGroup') {
          return (
            <CommentGroup
              key={activityItem.id}
              docId={id}
              commentGroup={activityItem}
              isLastGroup={index === activityItems.length - 1}
              authors={activity.data?.accountsMetadata}
              renderCommentContent={renderCommentContent}
              CommentReplies={CommentReplies}
              homeId={originHomeId}
              rootReplyCommentId={null}
              siteHost={siteHost}
              enableReplies={enableReplies}
              RepliesEditor={CommentRepliesEditor}
              enableWebSigning={enableWebSigning}
            />
          )
        }
        if (activityItem.type === 'document') {
          return (
            <SubDocumentItem
              key={activityItem.account + '/' + activityItem.path.join('/')}
              item={activityItem}
              originHomeId={originHomeId}
              accountsMetadata={accountsMetadata}
              markedAsRead
            />
          )
        }
        if (activityItem.type === 'changeGroup') {
          const author =
            activity.data?.accountsMetadata?.[activityItem.changes[0].author]
          if (!author) return null
          return (
            <ChangeGroup
              item={activityItem}
              key={activityItem.id}
              latestDocChanges={latestDocChanges}
              activeChangeIds={activeChangeIds}
              docId={id}
              author={author}
            />
          )
        }
        return null
      })}
    </>
  )
}

const DocInteractionsSummary = React.memo(_DocInteractionsSummary)

function _DocInteractionsSummary({
  docId,
  citations,
  onCitationsOpen,
  onCommentsOpen,
  onVersionOpen,
}: {
  docId: UnpackedHypermediaId
  citations?: HMCitationsPayload
  onCitationsOpen?: () => void
  onCommentsOpen?: () => void
  onVersionOpen?: () => void
}) {
  const changes = useDocumentChanges(docId)

  return (
    <XStack
      position="absolute"
      top={0}
      right={8}
      padding="$4"
      gap="$1.5"
      zIndex="$zIndex.7"
    >
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
          count={0} // TODO: add comments citations
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
  setBlockId,
}: {
  citations?: HMCitationsPayload
  blockId: string | null
  setBlockId: (blockId: string | null) => void
}) {
  const filteredCitations = useMemo(() => {
    if (!blockId || !citations) return citations
    return citations?.filter(
      (citation) =>
        citation.targetFragment && citation.targetFragment?.blockId === blockId,
    )
  }, [citations, blockId])
  return (
    <YStack>
      <XStack paddingHorizontal="$4" paddingVertical="$3" alignItems="center">
        <SizableText size="$3" fontWeight="bold">
          Citations
        </SizableText>
      </XStack>
      <YStack gap="$2" padding="$3">
        {blockId ? (
          <AccessoryBackButton
            onPress={() => setBlockId(null)}
            label="All Citations"
          />
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

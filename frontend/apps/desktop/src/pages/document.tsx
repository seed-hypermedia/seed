import {AccessoryLayout} from '@/components/accessory-sidebar'
import {triggerCommentDraftFocus} from '@/components/commenting'
import {DocNavigation} from '@/components/doc-navigation'
import {useDocumentAccessory} from '@/components/document-accessory'
import {DocumentHeadItems} from '@/components/document-head-items'
import {NotifSettingsDialog} from '@/components/email-notifs-dialog'
import {ImportDropdownButton} from '@/components/import-doc-button'
import {NewspaperLayout} from '@/components/newspaper-layout'
import {useTemplateDialog} from '@/components/site-template'
import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useEntityCitations, useSortedCitations} from '@/models/citations'
import {useContactsMetadata} from '@/models/contacts'
import {
  useAccountDraftList,
  useCreateDraft,
  useDocumentRead,
  useListDirectory,
} from '@/models/documents'
import {
  createNotifierRequester,
  getAccountNotifsSafe,
} from '@/models/email-notifications'
import {useSubscribedEntity} from '@/models/entities'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useDocumentChanges} from '@/models/versions'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import '@shm/editor/editor.css'
import {
  BlockRange,
  DocumentRoute,
  getDocumentTitle,
  HMDocument,
  HMEntityContent,
  hmId,
  HMQueryResult,
  pluralS,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {DiscussionsProvider} from '@shm/shared/discussions-provider'
import {useEntity} from '@shm/shared/models/entity'
import '@shm/shared/styles/document.css'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Container, panelContainerStyles} from '@shm/ui/container'
import {DocContent} from '@shm/ui/document-content'
import {DocumentDate} from '@shm/ui/document-date'
import {useImageUrl} from '@shm/ui/get-file-url'
import {SeedHeading} from '@shm/ui/heading'
import {HMIcon} from '@shm/ui/hm-icon'
import {
  ArrowRight,
  BlockQuote,
  HistoryIcon,
  IconComponent,
  MoreHorizontal,
} from '@shm/ui/icons'
import {useDocumentLayout} from '@shm/ui/layout'
import {Button} from '@shm/ui/legacy/button'
import {DocNavigationItem, getSiteNavDirectory} from '@shm/ui/navigation'
import {Separator as TSeparator} from '@shm/ui/separator'
import {SiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useIsDark} from '@shm/ui/use-is-dark'
import {cn} from '@shm/ui/utils'
import {MessageSquare, Plus} from '@tamagui/lucide-icons'
import React, {ReactNode, useCallback, useEffect, useMemo, useRef} from 'react'
import {ButtonText, XStack, YStack} from 'tamagui'
import {AppDocContentProvider} from './document-content-provider'

export default function DocumentPage() {
  const route = useNavRoute()
  const docId = route.key === 'document' && route.id
  useDocumentRead(docId)
  if (!docId) throw new Error('Invalid route, no document id')
  const accessoryKey = route.accessory?.key
  const replace = useNavigate('replace')

  const {accessory, accessoryOptions} = useDocumentAccessory({docId})

  const notifSettingsDialog = useAppDialog(NotifSettingsDialog)
  const immediatePromptNotifs =
    route.immediatelyPromptNotifs && !route.id?.path?.length

  const gatewayUrl = useGatewayUrl()
  const markPromptedKey = trpc.prompting.markPromptedKey.useMutation()
  useEffect(() => {
    if (immediatePromptNotifs) {
      getAccountNotifsSafe(
        createNotifierRequester(gatewayUrl.data),
        route.id.uid,
      ).then((result) => {
        if (result && !result.account?.email) {
          notifSettingsDialog.open({
            accountUid: route.id.uid,
            title: 'Get Emailed when Important Things Happen Here',
          })
          markPromptedKey.mutate({
            key: `account-email-notifs-${route.id.uid}`,
            isPrompted: true,
          })
        } else {
          // 'notifs already set on server! or disconnected from server',
        }
      })
      replace({...route, immediatelyPromptNotifs: false})
    }
  }, [immediatePromptNotifs])

  const mainPanelRef = useRef<HTMLDivElement>(null)
  const templateDialogContent = useTemplateDialog(route)

  return (
    <>
      <DiscussionsProvider
        onReplyClick={(replyComment) => {
          replace({
            ...route,
            accessory: {
              key: 'discussions',
              openComment: replyComment.id,
              isReplying: true,
            },
          })
          triggerCommentDraftFocus(docId.id, replyComment.id)
        }}
        onReplyCountClick={(replyComment) => {
          replace({
            ...route,
            accessory: {
              key: 'discussions',
              openComment: replyComment.id,
            },
          })
        }}
      >
        <div className="flex flex-col flex-1 h-full">
          <AccessoryLayout
            mainPanelRef={mainPanelRef}
            accessory={accessory}
            accessoryKey={accessoryKey}
            onAccessorySelect={(key: typeof accessoryKey) => {
              if (key === accessoryKey || key === undefined)
                return replace({...route, accessory: null})
              replace({...route, accessory: {key}})
            }}
            accessoryOptions={accessoryOptions}
          >
            <MainDocumentPage
              id={route.id}
              isBlockFocused={route.isBlockFocused || false}
              onScrollParamSet={useCallback((isFrozen) => {
                mainPanelRef.current?.style.setProperty(
                  'overflow',
                  isFrozen ? 'hidden' : 'auto',
                )
              }, [])}
              isCommentingPanelOpen={route.accessory?.key === 'discussions'}
              onAccessory={useCallback(
                (accessory) => {
                  replace({...route, accessory})
                },
                [route, replace],
              )}
            />
          </AccessoryLayout>
        </div>
        {templateDialogContent}
        {notifSettingsDialog.content}
      </DiscussionsProvider>
    </>
  )
}

function BaseDocContainer({children, ...props}: {children: ReactNode}) {
  return (
    <Container clearVerticalSpace padding={0} {...props}>
      {children}
    </Container>
  )
}

function NewspaperDocContainer({children, ...props}: {children: ReactNode}) {
  return (
    <div className="p-0" {...props}>
      {children}
    </div>
  )
}

function _MainDocumentPage({
  id,
  isBlockFocused,
  onScrollParamSet,
  isCommentingPanelOpen,
  onAccessory,
}: {
  id: UnpackedHypermediaId
  isBlockFocused: boolean
  onScrollParamSet: (isFrozen: boolean) => void
  isCommentingPanelOpen: boolean
  onAccessory: (accessory: DocumentRoute['accessory']) => void
}) {
  const replace = useNavigate('replace')
  const entity = useSubscribedEntity(
    id,
    // true for recursive subscription. this component may not require children, but the directory will also be recursively subscribing, and we want to avoid an extra subscription
    true,
    ({redirectTarget}) => {
      if (redirectTarget) {
        toast(`Redirected to this document from ${id.id}`)
        replace({key: 'document', id: redirectTarget})
      }
    },
  )
  console.log('~ loaded document', entity.data?.document)

  const siteHomeEntity = useSubscribedEntity(
    // if the route document ID matches the home document, then use it because it may be referring to a specific version
    id.path?.length ? hmId('d', id.uid) : id,
    // otherwise, create an ID with the latest version of the home document

    id.path?.length ? false : true, // avoiding redundant subscription if the doc is not the home document
  )

  const metadata = entity.data?.document?.metadata
  // IMPORTANT: Always call hooks at the top level, before any early returns
  // This ensures hooks are called in the same order on every render

  const docIsNewspaperLayout =
    metadata?.layout === 'Seed/Experimental/Newspaper'
  const isHomeDoc = !id.path?.length
  const isShowOutline =
    (typeof metadata?.showOutline == 'undefined' || metadata?.showOutline) &&
    !isHomeDoc
  const showSidebarOutlineDirectory = isShowOutline && !isHomeDoc

  const DocContainer = docIsNewspaperLayout
    ? NewspaperDocContainer
    : BaseDocContainer

  const {
    showSidebars,
    sidebarProps,
    mainContentProps,
    elementRef,
    showCollapsed,
    wrapperProps,
  } = useDocumentLayout({
    contentWidth: metadata?.contentWidth,
    showSidebars: showSidebarOutlineDirectory,
  })

  if (entity.isInitialLoading) return null

  if (entity.data?.redirectTarget) {
    return (
      <DocRedirected docId={id} redirectTarget={entity.data.redirectTarget} />
    )
  }

  if (entity.data?.document === undefined) {
    return <DocDiscovery docId={id} />
  }

  return (
    // this data attribute is used by the hypermedia highlight component
    <div data-docid={id.id} className={cn(panelContainerStyles)}>
      <AppDocSiteHeader
        siteHomeEntity={siteHomeEntity.data}
        docId={id}
        document={entity.data?.document}
        supportDocuments={[]} // todo: handle embeds for outline!!
        onScrollParamSet={onScrollParamSet}
      />
      <div className="flex flex-col flex-1 overflow-hidden">
        <ScrollArea ref={elementRef}>
          {!docIsNewspaperLayout && <DocumentCover docId={id} />}

          <div {...wrapperProps} className={cn(wrapperProps.className, 'flex')}>
            {showSidebars ? (
              <YStack
                {...sidebarProps}
                marginTop={entity.data?.document?.metadata.cover ? 152 : 220}
              >
                <YStack
                  className="hide-scrollbar"
                  overflow="scroll"
                  height="100%"
                  // paddingVertical="$4"
                >
                  <DocNavigation showCollapsed={showCollapsed} />
                </YStack>
              </YStack>
            ) : null}

            <DocContainer
              {...mainContentProps}
              $gtSm={{marginRight: 40, marginLeft: 0}}
            >
              {isHomeDoc ? null : <DocPageHeader docId={id} />}
              <div className="flex-1 pl-4 mt-4 mb-16 sm:pl-0">
                <DocPageContent
                  blockRef={id.blockRef}
                  blockRange={id.blockRange}
                  entity={entity.data}
                  isBlockFocused={isBlockFocused}
                />
              </div>
            </DocContainer>
            {showSidebars ? <YStack {...sidebarProps} /> : null}
          </div>
          <DocInteractionsSummary docId={id} />
        </ScrollArea>
      </div>
    </div>
  )
}
const MainDocumentPage = React.memo(_MainDocumentPage)
const AppDocSiteHeader = React.memo(_AppDocSiteHeader)

const DocInteractionsSummary = React.memo(_DocInteractionsSummary)

function _DocInteractionsSummary({docId}: {docId: UnpackedHypermediaId}) {
  const {docCitations, commentCitations} = useSortedCitations(docId)
  const changes = useDocumentChanges(docId)
  const route = useNavRoute()
  const docRoute = route.key === 'document' ? route : null
  const replace = useNavigate('replace')
  if (!docRoute) return null
  if (docRoute.accessory) return null
  return (
    <div className="absolute z-50 flex gap-1 px-3 py-2 bg-white rounded-md shadow-md top-2 right-2 dark:bg-background">
      <InteractionSummaryItem
        label="citation"
        count={docCitations.length || 0}
        onPress={() => {
          replace({...docRoute, accessory: {key: 'citations'}})
        }}
        icon={BlockQuote}
      />

      <Separator />
      <InteractionSummaryItem
        label="comment"
        count={commentCitations.length || 0}
        onPress={() => {
          replace({...docRoute, accessory: {key: 'discussions'}})
        }}
        icon={MessageSquare}
      />
      <Separator />
      <InteractionSummaryItem
        label="version"
        count={changes.data?.length || 0}
        onPress={() => {
          replace({...docRoute, accessory: {key: 'versions'}})
        }}
        icon={HistoryIcon}
      />
    </div>
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
        <SizableText size="xs">{count}</SizableText>
      </Button>
    </Tooltip>
  )
}

function _AppDocSiteHeader({
  siteHomeEntity,
  docId,
  children,
  document,
  supportDocuments,
  onScrollParamSet,
}: {
  siteHomeEntity: HMEntityContent | undefined | null
  docId: UnpackedHypermediaId
  children?: React.ReactNode
  document?: HMDocument
  supportDocuments?: HMEntityContent[]
  onScrollParamSet: (isFrozen: boolean) => void
}) {
  const homeDir = useListDirectory(siteHomeEntity?.id)
  const drafts = useAccountDraftList(docId.uid)
  const docDir = useListDirectory(docId, {mode: 'Children'})
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const supportQueries = useMemo(() => {
    const q: HMQueryResult[] = []
    if (docDir.data) {
      q.push({in: docId, results: docDir.data})
    }
    if (homeDir.data && siteHomeEntity?.id) {
      q.push({in: siteHomeEntity.id, results: homeDir.data})
    }
    return q
  }, [docId, docDir.data, homeDir.data, siteHomeEntity?.id])
  if (!siteHomeEntity) return null
  if (route.key !== 'document') return null
  const navItemBlocks =
    siteHomeEntity.document?.detachedBlocks?.navigation?.children
  const navItems = navItemBlocks
    ? navItemBlocks
        .map((itemBlock) => {
          if (itemBlock.block.type !== 'Link') return null
          const id = unpackHmId(itemBlock.block.link)
          return {
            key: itemBlock.block.id,
            id: id || undefined,
            webUrl: id ? undefined : itemBlock.block.link,
            isPublished: true,
            metadata: {
              name: itemBlock.block.text || '?',
            },
            sortTime: new Date(),
          } satisfies DocNavigationItem
        })
        .filter((b) => !!b)
    : getSiteNavDirectory({
        id: siteHomeEntity.id,
        supportQueries,
        drafts: drafts.data,
      })
  console.log('~ navItems', navItems)
  console.log('~ navItemBlocks', navItemBlocks)
  return (
    <SiteHeader
      originHomeId={hmId('d', siteHomeEntity.id.uid)}
      items={navItems}
      docId={docId}
      isCenterLayout={
        siteHomeEntity.document?.metadata.theme?.headerLayout === 'Center' ||
        siteHomeEntity.document?.metadata.layout ===
          'Seed/Experimental/Newspaper'
      }
      document={document}
      onBlockFocus={(blockId) => {
        replace({...route, id: {...route.id, blockRef: blockId}})
      }}
      supportDocuments={[...(supportDocuments || []), siteHomeEntity]}
      supportQueries={supportQueries}
      onShowMobileMenu={(isShown) => {
        onScrollParamSet(isShown)
      }}
    />
  )
}

export function NewSubDocumentButton({
  locationId,
  importDropdown = true,
}: {
  locationId: UnpackedHypermediaId
  importDropdown?: boolean
}) {
  const capability = useSelectedAccountCapability(locationId)
  const canEditDoc = roleCanWrite(capability?.role)
  const createDraft = useCreateDraft({
    locationUid: locationId.uid,
    locationPath: locationId.path || undefined,
  })
  if (!canEditDoc) return null
  return (
    <>
      <Tooltip content="Create a new document">
        <Button icon={Plus} color="$brand5" onPress={createDraft} size="$2">
          Create
        </Button>
      </Tooltip>
      {importDropdown && (
        <ImportDropdownButton
          id={locationId}
          button={<Button size="$1" circular icon={MoreHorizontal} />}
        />
      )}
    </>
  )
}

function DocPageHeader({docId}: {docId: UnpackedHypermediaId}) {
  const isDark = useIsDark()
  const entity = useEntity(docId)
  const hasCover = useMemo(
    () => !!entity.data?.document?.metadata.cover,
    [entity.data],
  )
  const hasIcon = useMemo(
    () => !!entity.data?.document?.metadata.icon,
    [entity.data],
  )
  const navigate = useNavigate()
  const authors = useMemo(() => entity.data?.document?.authors, [entity.data])
  const authorContacts = useContactsMetadata(authors || [])
  console.log('~~~ ', authors)

  if (entity.isLoading) return null
  if (entity.data?.document === undefined) return null

  return (
    <div>
      <Container
        marginTop={hasCover ? -40 : 0}
        paddingTop={!hasCover ? 60 : '$6'}
        className="bg-white dark:bg-background"
        data-docid={docId.id}
        borderRadius="$2"
      >
        <YStack group="header" gap="$4">
          {hasIcon ? (
            <XStack marginTop={hasCover ? -80 : 0}>
              <HMIcon
                size={100}
                id={docId}
                metadata={entity.data?.document?.metadata}
              />
            </XStack>
          ) : null}
          <XStack>
            <SeedHeading
              level={1}
              f={1}
              style={{fontWeight: 'bold', wordBreak: 'break-word'}}
            >
              {getDocumentTitle(entity.data?.document)}
            </SeedHeading>
          </XStack>
          <YStack gap="$2">
            {entity.data?.document?.metadata.siteUrl ? (
              <SiteURLButton
                siteUrl={entity.data?.document?.metadata.siteUrl}
              />
            ) : null}
            <XStack gap="$3" ai="center" jc="space-between" f={1}>
              <XStack gap="$3" ai="center" f={1} flexWrap="wrap">
                {entity.data?.document?.path.length || authors?.length !== 1 ? (
                  <>
                    <div className="flex flex-wrap items-center max-w-full gap-1">
                      {authors
                        ?.map((a, index) => {
                          const contact = authorContacts[a]
                          if (!contact) return null
                          return [
                            <ButtonText
                              key={contact.id.uid}
                              borderColor="$colorTransparent"
                              outlineColor="$colorTransparent"
                              hoverStyle={{
                                borderColor: '$colorTransparent',
                                textDecorationLine: 'underline',
                                textDecorationColor: 'currentColor',
                              }}
                              size="$2"
                              fontWeight="bold"
                              onPress={() => {
                                navigate({key: 'document', id: contact.id})
                              }}
                            >
                              {contact.metadata?.name || 'Untitled Contact'}
                            </ButtonText>,
                            index !== authors.length - 1 ? (
                              index === authors.length - 2 ? (
                                <SizableText
                                  key={`${a}-and`}
                                  size="xs"
                                  weight="bold"
                                >
                                  {' & '}
                                </SizableText>
                              ) : (
                                <SizableText
                                  key={`${a}-comma`}
                                  weight="bold"
                                  size="xs"
                                >
                                  {', '}
                                </SizableText>
                              )
                            ) : null,
                          ]
                        })
                        .filter(Boolean)}
                    </div>
                    <Separator />
                  </>
                ) : null}
                {entity.data?.document ? (
                  <DocumentDate
                    metadata={entity.data.document.metadata}
                    updateTime={entity.data.document.updateTime}
                    disableTooltip={false}
                  />
                ) : null}
              </XStack>
              {entity.data?.document && (
                <DocumentHeadItems
                  document={entity.data.document}
                  docId={docId}
                />
              )}
            </XStack>
          </YStack>
          <TSeparator />
        </YStack>
      </Container>
    </div>
  )
}

function DocRedirected({
  docId,
  redirectTarget,
}: {
  docId: UnpackedHypermediaId
  redirectTarget: UnpackedHypermediaId
}) {
  const navigate = useNavigate()
  return (
    <DocMessageBox
      title="Redirected"
      message="This document has been redirected to a new location."
      children={
        <Button
          icon={ArrowRight}
          onPress={() => {
            navigate({key: 'document', id: redirectTarget})
          }}
        >
          Go to New Location
        </Button>
      }
    />
  )
}

function DocMessageBox({
  title,
  message,
  children,
  spinner,
}: {
  title: string
  message: string
  children?: ReactNode
  spinner?: boolean
}) {
  return (
    <div className={cn(panelContainerStyles)}>
      <div className="mx-auto py-10 px-8">
        <div className="flex flex-col flex-1 w-full max-w-lg gap-4 p-6 border rounded-lg shadow-lg border-border flex-none bg-background dark:bg-black">
          {spinner ? (
            <div className="flex items-center justify-start">
              <Spinner className="size-6 fill-blue-500" />
            </div>
          ) : null}
          <SizableText size="2xl" weight="bold">
            {title}
          </SizableText>

          <SizableText asChild className="text-muted-foreground">
            <p>{message}</p>
          </SizableText>
          {children}
        </div>
      </div>
    </div>
  )
}
function DocDiscovery() {
  return (
    <DocMessageBox
      title="Looking for this document..."
      spinner
      message="This document is not on your node yet. Now finding a peer who can provide it."
    />
  )
}
const Separator = () => <TSeparator vertical />

function SiteURLButton({siteUrl}: {siteUrl?: string}) {
  const open = useOpenUrl()
  if (!siteUrl) return null
  return (
    <ButtonText
      color="$color10"
      size="$2"
      hoverStyle={{
        textDecorationLine: 'underline',
        textDecorationColor: 'currentColor',
      }}
      onPress={() => {
        open(siteUrl)
      }}
    >
      {siteUrl}
    </ButtonText>
  )
}

function DocumentCover({docId}: {docId: UnpackedHypermediaId}) {
  const entity = useEntity(docId)
  const imageUrl = useImageUrl()
  if (!entity.data?.document) return null
  if (!entity.data.document.metadata.cover) return null

  return (
    <XStack
      bg={
        entity.data.document.metadata.cover
          ? '$backgroundTransparent'
          : 'brand11'
      }
      height="25vh"
      width="100%"
      position="relative"
    >
      <img
        src={imageUrl(entity.data.document.metadata.cover, 'XL')}
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

function DocPageContent({
  entity,
  isBlockFocused,
  blockRef,
  blockRange,
}: {
  entity: HMEntityContent
  blockId?: string
  isBlockFocused: boolean
  blockRef?: string | null
  blockRange?: BlockRange | null
}) {
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const citations = useEntityCitations(entity.id)
  const docRoute = route.key === 'document' ? route : null
  if (entity.document!.metadata.layout === 'Seed/Experimental/Newspaper') {
    return (
      <NewspaperLayout id={entity.id} metadata={entity.document!.metadata} />
    )
  }
  return (
    <AppDocContentProvider
      routeParams={{
        uid: route.id?.uid || undefined,
        version: route.id?.version || undefined,
        blockRef: blockRef || undefined,
        blockRange: blockRange || undefined,
      }}
      blockCitations={useMemo(() => {
        if (!citations.data) return {}
        const blockCitations: Record<
          string,
          {citations: number; comments: number}
        > = {}
        citations.data.forEach((citation) => {
          const sourceId = citation.source.id
          if (!sourceId) return false
          const targetFragment = citation.targetFragment
          const targetBlockId = targetFragment?.blockId
          const blockCounts = targetBlockId
            ? (blockCitations[targetBlockId] = {
                citations: 0,
                comments: 0,
              })
            : null
          if (sourceId.type === 'c' && blockCounts) blockCounts.comments += 1
          if (sourceId.type === 'd' && blockCounts) blockCounts.citations += 1
        })
        return blockCitations
      }, [citations.data])}
      onBlockCitationClick={(blockId) => {
        if (!docRoute) return
        replace({
          ...docRoute,
          id: {
            ...docRoute.id,
            blockRef: blockId || null,
            blockRange: null,
          },
          accessory: {
            key: 'citations',
            openBlockId: blockId || null,
          },
        })
      }}
      docId={entity.id}
      onBlockCommentClick={(blockId, blockRangeInput) => {
        if (route.key !== 'document') return
        if (!blockId) return
        const blockRange =
          blockRangeInput &&
          'start' in blockRangeInput &&
          'end' in blockRangeInput
            ? blockRangeInput
            : null
        replace({
          ...route,
          id: {
            ...route.id,
            blockRef: blockId,
            blockRange,
          },
          accessory: {
            key: 'discussions',
            openBlockId: blockId,
            blockRange,
            autoFocus: true,
          },
        })
      }}
      isBlockFocused={isBlockFocused}
    >
      <DocContent
        document={entity.document!}
        focusBlockId={isBlockFocused ? blockRef || undefined : undefined}
        handleBlockReplace={() => {
          if (route.key === 'document') {
            // Remove block ref and range from the route.
            replace({
              ...route,
              id: {...route.id, blockRef: null, blockRange: null},
            })
            return true
          }
          return false
        }}
      />
    </AppDocContentProvider>
  )
}

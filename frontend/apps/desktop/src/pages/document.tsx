import {AccessoryLayout} from '@/components/accessory-sidebar'
import {triggerCommentDraftFocus} from '@/components/commenting'
import {DocNavigation} from '@/components/doc-navigation'
import {useDocumentAccessory} from '@/components/document-accessory'
import {DocumentHeadItems} from '@/components/document-head-items'
import {NotifSettingsDialog} from '@/components/email-notifs-dialog'
import {ImportDropdownButton} from '@/components/import-doc-button'
import {useTemplateDialog} from '@/components/site-template'
import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useEntityCitations, useSortedCitations} from '@/models/citations'
import {useAllDocumentComments} from '@/models/comments'
import {useContactsMetadata} from '@/models/contacts'
import {
  useCreateDraft,
  useDocumentRead,
  useListDirectory,
  useSiteNavigationItems,
} from '@/models/documents'
import {
  createNotifierRequester,
  getAccountNotifsSafe,
} from '@/models/email-notifications'
import {useSubscribedEntities, useSubscribedEntity} from '@/models/entities'
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
} from '@shm/shared'
import {DiscussionsProvider} from '@shm/shared/discussions-provider'
import {useAccount, useEntity} from '@shm/shared/models/entity'
import '@shm/shared/styles/document.css'
import {Button as TWButton} from '@shm/ui/button'
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
  MoreHorizontal,
} from '@shm/ui/icons'
import {useDocumentLayout} from '@shm/ui/layout'
import {Button} from '@shm/ui/legacy/button'
import {Separator as TSeparator} from '@shm/ui/separator'
import {SiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {AlertCircle, MessageSquare, Plus} from 'lucide-react'
import React, {ReactNode, useCallback, useEffect, useMemo, useRef} from 'react'
import {ButtonText} from 'tamagui'
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
        <div className="flex h-full flex-1 flex-col">
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

function BaseDocContainer({
  children,
  className,
  ...props
}: {children: ReactNode} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Container clearVerticalSpace className={className} {...props}>
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

  const account = useAccount(id.uid, {enabled: !id.path?.length})

  useEffect(() => {
    if (account.data?.id?.uid && account.data?.id?.uid !== id.uid) {
      toast.error('This account redirects to another account.')
      replace({key: 'document', id: account.data.id})
    }
  }, [account.data])

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

  const siteHomeEntity = useSubscribedEntity(
    // if the route document ID matches the home document, then use it because it may be referring to a specific version
    id.path?.length ? hmId('d', id.uid) : id,
    // otherwise, create an ID with the latest version of the home document

    id.path?.length ? false : true, // avoiding redundant subscription if the doc is not the home document
  )

  const metadata = entity.data?.document?.metadata
  // IMPORTANT: Always call hooks at the top level, before any early returns
  // This ensures hooks are called in the same order on every render

  const isHomeDoc = !id.path?.length
  const isShowOutline =
    (typeof metadata?.showOutline == 'undefined' || metadata?.showOutline) &&
    !isHomeDoc
  const showSidebarOutlineDirectory = isShowOutline && !isHomeDoc

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
      <div
        className="relative flex flex-1 flex-col overflow-hidden"
        ref={elementRef}
      >
        <DocInteractionsSummary docId={id} />
        <ScrollArea>
          <DocumentCover docId={id} />

          <div {...wrapperProps} className={cn(wrapperProps.className, 'flex')}>
            {showSidebars ? (
              <div
                {...sidebarProps}
                className={`${sidebarProps.className || ''} flex flex-col`}
                style={{
                  ...sidebarProps.style,
                  marginTop: entity.data?.document?.metadata.cover ? 152 : 220,
                }}
              >
                <div
                  className="hide-scrollbar flex h-full flex-col overflow-scroll"
                  // paddingVertical="$4"
                >
                  <DocNavigation showCollapsed={showCollapsed} />
                </div>
              </div>
            ) : null}

            <BaseDocContainer
              {...mainContentProps}
              className={cn(mainContentProps.className, 'sm:mr-10 sm:ml-0')}
            >
              {isHomeDoc ? null : <DocPageHeader docId={id} />}
              <div className="mt-4 mb-16 flex-1 pl-4 sm:pl-0">
                <DocPageContent
                  blockRef={id.blockRef}
                  blockRange={id.blockRange}
                  entity={entity.data}
                  isBlockFocused={isBlockFocused}
                />
              </div>
            </BaseDocContainer>
            {showSidebars ? (
              <div
                {...sidebarProps}
                className={`${sidebarProps.className || ''} flex flex-col`}
              />
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
const MainDocumentPage = React.memo(_MainDocumentPage)
const AppDocSiteHeader = React.memo(_AppDocSiteHeader)

const DocInteractionsSummary = React.memo(_DocInteractionsSummary)

function _DocInteractionsSummary({docId}: {docId: UnpackedHypermediaId}) {
  const {docCitations} = useSortedCitations(docId)
  const changes = useDocumentChanges(docId)
  const comments = useAllDocumentComments(docId)

  const route = useNavRoute()
  const docRoute = route.key === 'document' ? route : null
  const replace = useNavigate('replace')
  if (!docRoute) return null
  if (docRoute.accessory) return null
  return (
    <div className="dark:bg-background absolute top-2 right-2 z-[999] rounded-md bg-white shadow-md">
      <div className="flex">
        <InteractionSummaryItem
          label="citation"
          count={docCitations.length || 0}
          onPress={() => {
            replace({...docRoute, accessory: {key: 'citations'}})
          }}
          icon={<BlockQuote className="size-3" />}
        />

        <Separator />
        <InteractionSummaryItem
          label="comment"
          count={comments.data?.length || 0}
          onPress={() => {
            replace({...docRoute, accessory: {key: 'discussions'}})
          }}
          icon={<MessageSquare className="size-3" />}
        />
        <Separator />
        <InteractionSummaryItem
          label="version"
          count={changes.data?.length || 0}
          onPress={() => {
            replace({...docRoute, accessory: {key: 'versions'}})
          }}
          icon={<HistoryIcon size={16} color="currentColor" />}
        />
      </div>
    </div>
  )
}

function InteractionSummaryItem({
  label,
  count,
  onPress,
  icon,
}: {
  label: string
  count: number
  onPress: () => void
  icon: React.ReactNode
}) {
  return (
    <Tooltip content={`${count} ${pluralS(count, label)}`}>
      <TWButton onClick={onPress} size="sm" className={'p-0'}>
        {icon}
        <span className="text-xs">{count}</span>
      </TWButton>
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
  const docDir = useListDirectory(docId, {mode: 'Children'})
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const supportQueries = useMemo(() => {
    const q: HMQueryResult[] = []
    if (docDir.data) {
      q.push({in: docId, results: docDir.data})
    }
    return q
  }, [docId, docDir.data])
  if (!siteHomeEntity) return null
  if (route.key !== 'document') return null
  const navItems = useSiteNavigationItems(siteHomeEntity)
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
        <TWButton variant="outline" onClick={createDraft} size="xs">
          <Plus className="size-4" />
          Create
        </TWButton>
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
  useSubscribedEntities(
    entity.data?.document?.authors?.map((a) => ({id: hmId('d', a)})) || [],
  )
  const authorContacts = useContactsMetadata(authors || [])

  if (entity.isLoading) return null
  if (entity.data?.document === undefined) return null

  return (
    <div>
      <Container
        marginTop={hasCover ? -40 : 0}
        paddingTop={!hasCover ? 60 : '$6'}
        className="dark:bg-background bg-white"
        data-docid={docId.id}
        borderRadius="$2"
      >
        <div className="group flex flex-col gap-4" data-group="header">
          {hasIcon ? (
            <div
              className="flex"
              style={{
                marginTop: hasCover ? -80 : 0,
              }}
            >
              <HMIcon
                size={100}
                id={docId}
                metadata={entity.data?.document?.metadata}
              />
            </div>
          ) : null}
          <div className="flex">
            <SeedHeading
              level={1}
              f={1}
              style={{fontWeight: 'bold', wordBreak: 'break-word'}}
            >
              {getDocumentTitle(entity.data?.document)}
            </SeedHeading>
          </div>
          {entity.data.document?.metadata?.summary ? (
            <span className="font-body text-muted-foreground text-xl">
              {entity.data.document?.metadata?.summary}
            </span>
          ) : null}
          <div className="flex flex-col gap-2">
            {entity.data?.document?.metadata.siteUrl ? (
              <SiteURLButton
                siteUrl={entity.data?.document?.metadata.siteUrl}
              />
            ) : null}
            <div className="flex flex-1 items-center justify-between gap-3">
              <div className="flex flex-1 flex-wrap items-center gap-3">
                {entity.data?.document?.path.length || authors?.length !== 1 ? (
                  <>
                    <div className="flex max-w-full flex-wrap items-center gap-1">
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
                              {contact.metadata?.name ? (
                                contact.metadata.name
                              ) : (
                                <Tooltip content="Author has not yet loaded">
                                  <AlertCircle
                                    size={18}
                                    className="text-red-800"
                                  />
                                </Tooltip>
                              )}
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
                    <div className="bg-border h-6 w-px" />
                  </>
                ) : null}
                {entity.data?.document ? (
                  <DocumentDate
                    metadata={entity.data.document.metadata}
                    updateTime={entity.data.document.updateTime}
                    disableTooltip={false}
                  />
                ) : null}
              </div>
              {entity.data?.document && (
                <DocumentHeadItems
                  document={entity.data.document}
                  docId={docId}
                />
              )}
            </div>
          </div>
          <TSeparator />
        </div>
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
      <div className="mx-auto px-8 py-10">
        <div className="border-border bg-background flex w-full max-w-lg flex-1 flex-none flex-col gap-4 rounded-lg border p-6 shadow-lg dark:bg-black">
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
    <div
      className={`relative flex h-[25vh] w-full ${
        entity.data.document.metadata.cover ? 'bg-transparent' : 'bg-secondary'
      }`}
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
    </div>
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

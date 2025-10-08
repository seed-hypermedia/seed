import {AccessoryLayout} from '@/components/accessory-sidebar'
import {triggerCommentDraftFocus} from '@/components/commenting'
import {useDocumentAccessory} from '@/components/document-accessory'
import {DocumentHeadItems} from '@/components/document-head-items'
import {ImportDropdownButton} from '@/components/import-doc-button'
import {DesktopActivityService} from '@/desktop-activity-service'
import {DesktopCommentsService} from '@/desktop-comments-service'
import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useDocumentCitations} from '@/models/citations'
import {useContactsMetadata} from '@/models/contacts'
import {
  useCreateDraft,
  useDocumentRead,
  useSiteNavigationItems,
} from '@/models/documents'
import {useSubscribedResource, useSubscribedResources} from '@/models/entities'
import {useInteractionSummary} from '@/models/interaction-summary'
import {useOpenUrl} from '@/open-url'
import {useNavigate} from '@/utils/useNavigate'
import '@shm/editor/editor.css'
import {
  BlockRange,
  calculateBlockCitations,
  DocumentRoute,
  FeedRoute,
  getCommentTargetId,
  getDocumentTitle,
  HMDocument,
  HMEntityContent,
  hmId,
  HMResource,
  UnpackedHypermediaId,
} from '@shm/shared'
import {ActivityProvider} from '@shm/shared/activity-service-provider'
import {
  CommentsProvider,
  isRouteEqualToCommentTarget,
} from '@shm/shared/comments-service-provider'
import {useAccount, useResource} from '@shm/shared/models/entity'
import '@shm/shared/styles/document.css'
import {pluralS} from '@shm/shared/utils/language'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button, ButtonProps, Button as TWButton} from '@shm/ui/button'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Container, panelContainerStyles} from '@shm/ui/container'
import {DocContent} from '@shm/ui/document-content'
import {DocumentDate} from '@shm/ui/document-date'
import {Feed2} from '@shm/ui/feed'
import {SeedHeading} from '@shm/ui/heading'
import {HMIcon} from '@shm/ui/hm-icon'
import {ArrowRight, MoreHorizontal} from '@shm/ui/icons'
import {useDocumentLayout} from '@shm/ui/layout'
import {Separator as TSeparator} from '@shm/ui/separator'
import {SiteHeader} from '@shm/ui/site-header'
import {Spinner} from '@shm/ui/spinner'
import {SizableText, Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {AlertCircle, FilePlus, MessageSquare, Sparkle} from 'lucide-react'
import React, {ReactNode, useCallback, useEffect, useMemo, useRef} from 'react'
import {AppDocContentProvider} from './document-content-provider'

export default function FeedPage() {
  const commentsService = new DesktopCommentsService()
  const activityService = new DesktopActivityService()
  const route = useNavRoute()

  const docId: UnpackedHypermediaId | null =
    route.key == 'feed' ? route.id : null
  if (!docId) throw new Error('Invalid route, no document id')
  if (route.key != 'feed') throw new Error('Invalid route, key is not feed')

  const homeId = hmId(docId?.uid)

  useDocumentRead(docId)

  const accessoryKey = route.accessory?.key
  const replace = useNavigate('replace')
  const push = useNavigate('push')

  const {accessory, accessoryOptions} = useDocumentAccessory({docId})

  const mainPanelRef = useRef<HTMLDivElement>(null)

  return (
    <>
      <ActivityProvider service={activityService}>
        <CommentsProvider
          service={commentsService}
          onReplyClick={(replyComment) => {
            const targetRoute = isRouteEqualToCommentTarget({
              id: route.id,
              comment: replyComment,
            })

            if (targetRoute) {
              push({
                key: route.key,
                id: targetRoute,
                accessory: {
                  key: 'discussions',
                  openComment: replyComment.id,
                  isReplying: true,
                },
              })
            } else {
              console.log('targetRoute is the same. replacing...')
              replace({
                ...route,
                accessory: {
                  key: 'discussions',
                  openComment: replyComment.id,
                  isReplying: true,
                },
              })
            }
            triggerCommentDraftFocus(docId.id, replyComment.id)
          }}
          onReplyCountClick={(replyComment) => {
            const targetRoute = isRouteEqualToCommentTarget({
              id: route.id,
              comment: replyComment,
            })
            if (targetRoute) {
              // comment target is not the same as the route, so we need to change the whole route
              push({
                key: route.key,
                id: targetRoute,
                accessory: {
                  key: 'discussions',
                  openComment: replyComment.id,
                  isReplying: true,
                },
              })
            } else {
              // comment target is the same as the route, so we can replace safely
              replace({
                ...route,
                accessory: {
                  key: 'discussions',
                  openComment: replyComment.id,
                  isReplying: true,
                },
              })
            }
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
              <FeedContent
                id={homeId}
                route={route}
                isBlockFocused={false}
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
        </CommentsProvider>
      </ActivityProvider>
    </>
  )
}

function _FeedContent({
  id,
  isBlockFocused,
  onScrollParamSet,
  route,
}: {
  id: UnpackedHypermediaId
  isBlockFocused: boolean
  onScrollParamSet: (isFrozen: boolean) => void
  isCommentingPanelOpen: boolean
  onAccessory: (accessory: DocumentRoute['accessory']) => void
  route: DocumentRoute | FeedRoute
}) {
  const replace = useNavigate('replace')

  const account = useAccount(id.uid, {enabled: !id.path?.length})

  const homeId = hmId(id.uid)

  useEffect(() => {
    if (account.data?.id?.uid && account.data?.id?.uid !== id.uid) {
      toast.error('This account redirects to another account.')
      replace({key: route.key, id: account.data.id})
    }
  }, [account.data])

  const resource = useSubscribedResource(
    id,
    // true for recursive subscription. this component may not require children, but the directory will also be recursively subscribing, and we want to avoid an extra subscription
    true,
    ({redirectTarget}) => {
      if (redirectTarget) {
        toast(`Redirected to this document from ${id.id}`)
        replace({key: route.key, id: redirectTarget})
      }
    },
  )
  const loadedCommentResource =
    // @ts-ignore
    resource.data?.type == 'comment' ? resource.data : undefined
  useEffect(() => {
    if (loadedCommentResource) {
      const comment = loadedCommentResource.comment
      const targetDocId = getCommentTargetId(comment)
      if (targetDocId) {
        replace({
          key: route.key,
          id: targetDocId,
          accessory: {key: 'discussions', openComment: comment.id},
        })
      }
    }
  }, [loadedCommentResource])

  const siteHomeEntity = useSubscribedResource(
    // if the route document ID matches the home document, then use it because it may be referring to a specific version
    id.path?.length ? hmId(id.uid) : id,
    // otherwise, create an ID with the latest version of the home document

    id.path?.length ? false : true, // avoiding redundant subscription if the doc is not the home document
  )

  const document =
    // @ts-ignore
    resource.data?.type == 'document' ? resource.data.document : undefined
  const metadata = document?.metadata
  // IMPORTANT: Always call hooks at the top level, before any early returns
  // This ensures hooks are called in the same order on every render

  const {
    showSidebars,
    sidebarProps,
    mainContentProps,
    elementRef,
    wrapperProps,
  } = useDocumentLayout({
    contentWidth: metadata?.contentWidth,
    showSidebars: false,
  })

  if (resource.isInitialLoading) return null

  if (resource.data?.type === 'redirect') {
    return (
      <DocRedirected docId={id} redirectTarget={resource.data.redirectTarget} />
    )
  }

  if (resource.data?.type === 'not-found') {
    return <DocDiscovery />
  }

  if (loadedCommentResource) {
    return null
  }
  return (
    <div className={cn(panelContainerStyles)}>
      <AppDocSiteHeader
        // @ts-ignore
        siteHomeEntity={siteHomeEntity.data}
        docId={id}
        document={document}
        supportDocuments={[]} // todo: handle embeds for outline!!
        onScrollParamSet={onScrollParamSet}
      />
      <div
        className="relative flex flex-1 flex-col overflow-hidden"
        ref={elementRef}
      >
        <DocInteractionsSummary docId={id} />
        <ScrollArea>
          <div {...wrapperProps} className={cn(wrapperProps.className, 'flex')}>
            {showSidebars ? (
              <div
                {...sidebarProps}
                className={`${sidebarProps.className || ''} flex flex-col`}
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
              <TSeparator />
              <div className="-mx-5">
                <Feed2 filterResource={`${homeId.id}*`} />
              </div>
            </Container>
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
const FeedContent = React.memo(_FeedContent)
const AppDocSiteHeader = React.memo(_AppDocSiteHeader)

const DocInteractionsSummary = React.memo(_DocInteractionsSummary)

function _DocInteractionsSummary({docId}: {docId: UnpackedHypermediaId}) {
  const interactionSummary = useInteractionSummary(docId)

  const route = useNavRoute()
  const docRoute = route.key == 'document' || route.key == 'feed' ? route : null
  const replace = useNavigate('replace')
  if (!docRoute) return null
  if (docRoute.accessory) return null
  return (
    <div className="dark:bg-background absolute top-2 right-2 z-40 rounded-md bg-white shadow-md">
      <div className="flex">
        <InteractionSummaryItem
          label="activity"
          count={interactionSummary.data?.changes || 0}
          onPress={() => {
            replace({...docRoute, accessory: {key: 'activity'}})
          }}
          icon={<Sparkle className="size-3" color="currentColor" />}
        />
        <InteractionSummaryItem
          label="comment"
          count={interactionSummary.data?.comments || 0}
          onPress={() => {
            replace({...docRoute, accessory: {key: 'discussions'}})
          }}
          icon={<MessageSquare className="size-3" />}
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
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const navItems = useSiteNavigationItems(siteHomeEntity)
  if (!siteHomeEntity) return null
  if (route.key != 'document' && route.key != 'feed') return null
  return (
    <SiteHeader
      originHomeId={hmId(siteHomeEntity.id.uid)}
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
      onShowMobileMenu={(isShown) => {
        onScrollParamSet(isShown)
      }}
      isMainFeedVisible={route.key == 'feed'}
      handleToggleFeed={() => {
        replace({
          ...route,
          key: route.key == 'document' ? 'feed' : 'document',
        })
      }}
    />
  )
}

export function NewSubDocumentButton({
  locationId,
  size = 'sm',
  importDropdown = true,
}: {
  locationId: UnpackedHypermediaId
  importDropdown?: boolean
  size?: ButtonProps['size']
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
        <TWButton
          size={size}
          variant="default"
          className="w-full"
          onClick={createDraft}
        >
          <FilePlus className="size-4" />
          Create
        </TWButton>
      </Tooltip>
      {importDropdown && (
        <ImportDropdownButton
          id={locationId}
          button={
            <Button size="icon">
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
      )}
    </>
  )
}

function DocPageHeader({docId}: {docId: UnpackedHypermediaId}) {
  const resource = useResource(docId)
  const hasCover = useMemo(
    () =>
      resource.data?.type === 'document' &&
      !!resource.data.document?.metadata.cover,
    [resource.data],
  )
  const hasIcon = useMemo(
    () =>
      resource.data?.type === 'document' &&
      !!resource.data.document?.metadata.icon,
    [resource.data],
  )
  const navigate = useNavigate()
  const authors = useMemo(
    () =>
      resource.data?.type === 'document' ? resource.data.document?.authors : [],
    [resource.data],
  )
  useSubscribedResources(authors?.map((a) => ({id: hmId(a)})) || [])
  const authorContacts = useContactsMetadata(authors || [])

  if (resource.isLoading) return null
  if (resource.data?.type !== 'document') return null

  return (
    <Container
      className="dark:bg-background w-full rounded-lg bg-white"
      style={{
        marginTop: hasCover ? -40 : 0,
        paddingTop: !hasCover ? 60 : 24,
      }}
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
              name={resource.data?.document?.metadata?.name}
              icon={resource.data?.document?.metadata?.icon}
            />
          </div>
        ) : null}
        <div className="flex">
          <SeedHeading
            level={1}
            style={{fontWeight: 'bold', wordBreak: 'break-word'}}
          >
            {getDocumentTitle(resource.data?.document)}
          </SeedHeading>
        </div>
        {resource.data.document?.metadata?.summary ? (
          <span className="font-body text-muted-foreground text-xl">
            {resource.data.document?.metadata?.summary}
          </span>
        ) : null}
        <div className="flex flex-col gap-2">
          {resource.data?.document?.metadata.siteUrl ? (
            <SiteURLButton
              siteUrl={resource.data?.document?.metadata.siteUrl}
            />
          ) : null}
          <div className="flex flex-1 items-center justify-between gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-3">
              {resource.data?.document?.path.length || authors?.length !== 1 ? (
                <>
                  <div className="flex max-w-full flex-wrap items-center gap-1">
                    {authors
                      ?.map((a, index) => {
                        console.log('== a 2', a)
                        const contact = authorContacts[a]
                        if (!contact) return null
                        return [
                          <SizableText
                            key={contact.id.uid}
                            size="sm"
                            weight="bold"
                            className="underline-transparent hover:underline"
                            onClick={() => {
                              navigate({key: 'contact', id: contact.id})
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
                          </SizableText>,
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
              {resource.data?.document ? (
                <DocumentDate
                  metadata={resource.data.document.metadata}
                  updateTime={resource.data.document.updateTime}
                  disableTooltip={false}
                />
              ) : null}
            </div>
            {resource.data?.document && (
              <DocumentHeadItems
                document={resource.data.document}
                docId={docId}
              />
            )}
          </div>
        </div>
        <TSeparator />
      </div>
    </Container>
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
          onClick={() => {
            navigate({key: 'document', id: redirectTarget})
          }}
        >
          <ArrowRight className="size-4" />
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
        <div className="border-border bg-background flex w-full max-w-lg flex-none flex-col gap-4 rounded-lg border p-6 shadow-lg dark:bg-black">
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
    <SizableText
      size="sm"
      className="underline-transparent hover:underline"
      onClick={() => {
        open(siteUrl)
      }}
    >
      {siteUrl}
    </SizableText>
  )
}

function DocPageContent({
  resource,
  isBlockFocused,
  blockRef,
  blockRange,
}: {
  resource: HMResource | null | undefined
  blockId?: string
  isBlockFocused: boolean
  blockRef?: string | null
  blockRange?: BlockRange | null
}) {
  const replace = useNavigate('replace')
  const route = useNavRoute()
  const citations = useDocumentCitations(resource?.id)
  const docRoute = route.key === 'document' ? route : null
  if (!docRoute) return null
  if (resource?.type !== 'document') return null
  const document = resource.document
  return (
    <AppDocContentProvider
      routeParams={{
        uid: docRoute.id?.uid || undefined,
        version: docRoute.id?.version || undefined,
        blockRef: blockRef || undefined,
        blockRange: blockRange || undefined,
      }}
      blockCitations={useMemo(() => {
        if (!citations.data) return {}
        return calculateBlockCitations(citations.data)
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
      docId={resource.id}
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
        document={document}
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

import {useAppContext} from '@/app-context'
import {useSizeObserver} from '@/components/app-embeds'
import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useContact, useSelectedAccountContacts} from '@/models/contacts'
import {useAccountDraftList, useListDirectory} from '@/models/documents'
import {draftEditId, draftLocationId} from '@/models/drafts'
import {useIdEntities, useItemsFromId} from '@/models/entities'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {useHostSession} from '@/models/host'
import {NewSubDocumentButton} from '@/pages/document'
import {useNavigate} from '@/utils/useNavigate'
import {
  hmId,
  HMMetadata,
  HMQueryResult,
  hostnameStripProtocol,
  UnpackedHypermediaId,
} from '@shm/shared'
import {getContactMetadata, getDocumentTitle} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import {ContactRoute, DraftRoute} from '@shm/shared/routes'
import {useStream} from '@shm/shared/use-stream'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@shm/ui//hover-card'
import {Button} from '@shm/ui/button'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {DraftBadge} from '@shm/ui/draft-badge'
import {
  AlertCircle,
  Contact,
  Copy,
  File,
  Library,
  Sparkles,
  Star,
  X,
} from '@shm/ui/icons'
import {DocumentSmallListItem, getSiteNavDirectory} from '@shm/ui/navigation'
import {Spinner} from '@shm/ui/spinner'
import {SizableText, TextProps} from '@shm/ui/text'
import {TitleText, TitleTextButton} from '@shm/ui/titlebar'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {Sparkle} from 'lucide-react'
import {useMemo, useRef, useState} from 'react'
import {AiOutlineEllipsis} from 'react-icons/ai'
import {CopyReferenceButton} from './copy-reference-button'
import {FavoriteButton} from './favoriting'
import {DNSInstructions} from './publish-site'
import {DocOptionsButton} from './titlebar-common'
import {useWindowTitleSetter} from './window-title'

export function TitleContent({
  size = '$4',
  onPublishSite,
}: {
  // @ts-expect-error
  size?: FontSizeTokens
  onPublishSite: (input: {id: UnpackedHypermediaId}) => void
}) {
  const route = useNavRoute()
  const titleProps: TextProps = {
    size: 'md',
    weight: 'bold',
    // @ts-expect-error
    'data-testid': 'titlebar-title',
  }
  useWindowTitleSetter(async () => {
    if (route.key === 'contacts') return 'Contacts'
    if (route.key === 'explore') return 'Explore'
    if (route.key === 'favorites') return 'Favorites'
    if (route.key === 'library') return 'Library'
    if (route.key === 'drafts') return 'Drafts'
    // document, draft, contact are handled in the child components which have the relevant data!
    return null
  }, [route])

  if (route.key === 'contacts') {
    return (
      <>
        <Contact className="size-4" />
        <TitleText {...titleProps}>Contacts</TitleText>
      </>
    )
  }
  if (route.key === 'explore') {
    return (
      <>
        <Sparkles className="size-4" />
        <TitleText {...titleProps}>Explore</TitleText>
      </>
    )
  }
  if (route.key === 'favorites') {
    return (
      <>
        <Star className="size-4" />
        <TitleText {...titleProps}>Favorites</TitleText>
      </>
    )
  }
  if (route.key === 'library') {
    return (
      <>
        <Library className="size-4" />
        <TitleText {...titleProps}>Library</TitleText>
      </>
    )
  }
  if (route.key === 'drafts') {
    return (
      <>
        <File className="size-4" />
        <TitleText {...titleProps}>Drafts</TitleText>
      </>
    )
  }
  if (route.key === 'contact') {
    return <ContactTitle route={route} />
  }
  if (route.key === 'document' || route.key === 'feed') {
    return <BreadcrumbTitle entityId={route.id} onPublishSite={onPublishSite} />
  }
  if (route.key === 'draft') {
    return <DraftTitle route={route} />
  }
  return null
}

type CrumbDetails = {
  name?: string
  fallbackName?: string
  id: UnpackedHypermediaId | null
  isError?: boolean
  isLoading?: boolean
  crumbKey: string
}

function BreadcrumbTitle({
  entityId,
  hideControls = false,
  draftName,
  replaceLastItem = false,
  draft = false,
  onPublishSite,
}: {
  entityId: UnpackedHypermediaId
  hideControls?: boolean
  draftName?: string
  replaceLastItem?: boolean
  draft?: boolean
  onPublishSite?: (input: {id: UnpackedHypermediaId}) => void
}) {
  const navigate = useNavigate('push')
  const route = useNavRoute()
  const contacts = useSelectedAccountContacts()
  const latestDoc = useResource({...entityId, version: null, latest: true})
  const isLatest =
    // @ts-expect-error
    entityId.latest || entityId.version === latestDoc.data?.document?.version
  const entityIds = useItemsFromId(entityId)
  const entityContents = useIdEntities(entityIds)
  const homeMetadata = entityContents.at(0)?.entity?.document?.metadata
  const [collapsedCount, setCollapsedCount] = useState(0)
  const [itemMaxWidths, setItemMaxWidths] = useState<Record<string, number>>({})
  const widthInfo = useRef({} as Record<string, number>)
  const crumbDetails: (CrumbDetails | null)[] = useMemo(() => {
    const crumbs: (CrumbDetails | null)[] = []
    let items = entityIds.flatMap((id, idIndex) => {
      const contents = entityContents[idIndex]
      let name: string
      if (id.path?.length) {
        // @ts-ignore
        name = getDocumentTitle(contents.entity?.document) || ''
      } else {
        name = getContactMetadata(
          id.uid,
          // @ts-ignore
          contents.entity?.document?.metadata,
          contacts.data,
        ).name
      }
      return [
        {
          name,
          fallbackName: id.path?.at(-1),
          // @ts-ignore
          isError: contents.entity && !contents.entity.document,
          // @ts-ignore
          isLoading: !contents.entity,
          id,
          crumbKey: `id-${idIndex}`,
        },
      ]
    })

    crumbs.push(...items)

    if (draftName && replaceLastItem) {
      crumbs.pop()
    }

    if (draftName) {
      crumbs.push({
        name: draftName,
        fallbackName: draftName,
        id: null,
        crumbKey: `draft-${draftName}`,
      })
    }

    return crumbs
  }, [entityIds, entityContents])
  const isAllError = crumbDetails.every((details) => details?.isError)

  function updateWidths() {
    const containerWidth = widthInfo.current.container
    if (!containerWidth) return

    // 83 is the measured width of the controls like favorite, copy link, options dropdown.
    const availableContainerWidth = containerWidth - 83
    const spacerWidth = 15
    const ellipsisWidth = 20

    if (crumbDetails.length === 0) return

    // Calculate total width needed
    const crumbWidths: number[] = crumbDetails.map((details) => {
      return (details && widthInfo.current[details.crumbKey]) || 0
    })

    const separatorCount = crumbDetails.length - 1
    const totalSeparatorWidth = separatorCount * spacerWidth
    const totalCrumbWidth = crumbWidths.reduce((acc, w) => acc + w, 0)
    const totalNeededWidth = totalCrumbWidth + totalSeparatorWidth

    // If everything fits, no constraints needed
    if (totalNeededWidth <= availableContainerWidth) {
      setCollapsedCount(0)
      setItemMaxWidths({})
      return
    }

    // Try the original collapsing logic first
    const firstCrumbKey = crumbDetails[0]?.crumbKey
    const lastCrumbKey = crumbDetails.at(-1)?.crumbKey
    if (!firstCrumbKey || !lastCrumbKey || lastCrumbKey === firstCrumbKey) {
      setCollapsedCount(0)
      setItemMaxWidths({})
      return
    }

    const firstItemWidth = widthInfo.current[firstCrumbKey] || 0
    const lastItemWidth = widthInfo.current[lastCrumbKey] || 0
    const fixedItemWidth = firstItemWidth + lastItemWidth + spacerWidth

    const middleCrumbWidths = crumbWidths.slice(1, -1)
    let usableWidth = middleCrumbWidths.reduce(
      (acc, w) => acc + w + spacerWidth,
      0,
    )

    const maxCollapseCount = crumbDetails.length - 2
    let newCollapseCount = 0

    while (
      usableWidth +
        fixedItemWidth +
        (newCollapseCount ? spacerWidth + ellipsisWidth : 0) >
        availableContainerWidth &&
      newCollapseCount < maxCollapseCount
    ) {
      usableWidth -= (middleCrumbWidths[newCollapseCount] || 0) + spacerWidth
      newCollapseCount++
    }

    // Apply max-width constraints to non-last items if still overflowing
    const newMaxWidths: Record<string, number> = {}
    const finalLayoutWidth =
      firstItemWidth +
      lastItemWidth +
      (newCollapseCount > 0 ? ellipsisWidth + spacerWidth * 2 : spacerWidth) +
      usableWidth

    if (finalLayoutWidth > availableContainerWidth) {
      const overflow = finalLayoutWidth - availableContainerWidth
      const visibleNonLastItems = [firstCrumbKey]

      // Add visible middle items
      for (let i = newCollapseCount + 1; i < crumbDetails.length - 1; i++) {
        const key = crumbDetails[i]?.crumbKey
        if (key) visibleNonLastItems.push(key)
      }

      if (visibleNonLastItems.length > 0) {
        const reductionPerItem = overflow / visibleNonLastItems.length
        visibleNonLastItems.forEach((key) => {
          const currentWidth = widthInfo.current[key] || 0
          const newMaxWidth = Math.max(80, currentWidth - reductionPerItem)
          newMaxWidths[key] = newMaxWidth
        })
      }
    }

    setCollapsedCount(newCollapseCount)
    setItemMaxWidths(newMaxWidths)
  }

  const containerObserverRef = useSizeObserver(({width}) => {
    widthInfo.current.container = width
    requestAnimationFrame(() => {
      updateWidths()
    })
  })

  // @ts-ignore
  const activeItem: CrumbDetails | null = crumbDetails[crumbDetails.length - 1]
  useWindowTitleSetter(async () => {
    if (activeItem?.name) return activeItem.name
    return 'Document'
  }, [activeItem?.name])

  const firstInactiveDetail =
    crumbDetails[0] === activeItem ? null : crumbDetails[0]
  if (!activeItem) return null
  const firstItem = firstInactiveDetail ? (
    <BreadcrumbItem
      homeMetadata={homeMetadata}
      details={firstInactiveDetail}
      key={firstInactiveDetail.crumbKey}
      maxWidth={itemMaxWidths[firstInactiveDetail.crumbKey]}
      onSize={({width}: DOMRect) => {
        if (width) {
          widthInfo.current[firstInactiveDetail.crumbKey] = width
          updateWidths()
        }
      }}
    />
  ) : null

  const remainderItems = crumbDetails
    .slice(collapsedCount + 1, -1)
    .map((details) => {
      if (!details) return null
      return (
        <BreadcrumbItem
          homeMetadata={homeMetadata}
          key={details.crumbKey}
          details={details}
          maxWidth={itemMaxWidths[details.crumbKey]}
          onSize={({width}: DOMRect) => {
            if (width) {
              widthInfo.current[details.crumbKey] = width
              updateWidths()
            }
          }}
        />
      )
    })
  const displayItems = [firstItem]
  if (collapsedCount) {
    displayItems.push(
      <BreadcrumbEllipsis
        key="ellipsis"
        crumbDetails={crumbDetails}
        collapsedCount={collapsedCount}
      />,
    )
  }
  displayItems.push(...remainderItems)
  displayItems.push(
    <BreadcrumbItem
      homeMetadata={homeMetadata}
      details={activeItem}
      key={activeItem.crumbKey}
      isActive
      draft={draft}
      onSize={({width}: DOMRect) => {
        if (width) {
          widthInfo.current[activeItem.crumbKey] = width
          updateWidths()
        }
      }}
    />,
  )

  if (isAllError || !displayItems.length) return null

  return (
    <div
      ref={containerObserverRef}
      className="flex items-center gap-2 overflow-hidden"
    >
      <div className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <Button
          className="no-window-drag"
          variant={route.key == 'feed' ? 'default' : 'outline'}
          size="xs"
          onClick={() => {
            console.log('=== ROUTING', route)
            if (route.key == 'document') {
              navigate({
                key: 'feed',
                id: route.id,
                accessory: route.accessory,
              })
            } else if (route.key == 'feed') {
              navigate({
                ...route,
                key: 'document',
              })
            } else {
              console.log('FEED: impossible routing', route)
            }
          }}
        >
          <Sparkle className="size-3" />
          Feed
        </Button>
        {displayItems.flatMap((item, itemIndex) => {
          if (!item) return null
          return [
            item,
            itemIndex < displayItems.length - 1 ? (
              <BreadcrumbSeparator key={`seperator-${itemIndex}`} />
            ) : null,
          ]
        })}
      </div>
      {!hideControls ? (
        <div className="flex shrink-0 items-center justify-start">
          <PendingDomain id={entityId} />
          <FavoriteButton id={entityId} />
          <CopyReferenceButton
            docId={entityId}
            isBlockFocused={false} // TODO: learn why isBlockFocused is needed
            latest={isLatest}
          />
          {onPublishSite ? (
            <DocOptionsButton onPublishSite={onPublishSite} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function PendingDomainStatus({
  status,
  siteUrl,
}: {
  status: 'waiting-dns' | 'initializing' | 'error'
  siteUrl: string
}) {
  if (status === 'waiting-dns') {
    return (
      <SizableText color="muted">
        Waiting for DNS to resolve to {hostnameStripProtocol(siteUrl)}
      </SizableText>
    )
  }
  if (status === 'initializing') {
    return <SizableText color="muted">Initializing Domain...</SizableText>
  }
  return <SizableText className="text-destructive">Error</SizableText>
}

function PendingDomain({id}: {id: UnpackedHypermediaId}) {
  const hostSession = useHostSession()
  const site = useResource(id)

  if (id.path?.length) return null
  const pendingDomain = hostSession.pendingDomains?.find(
    (domain) => domain.siteUid === id.uid,
  )
  if (!pendingDomain) return null
  return (
    <div className="no-window-drag p-2">
      <HoverCard>
        <HoverCardTrigger>
          <Spinner size="small" />
        </HoverCardTrigger>
        <HoverCardContent side="bottom" align="start">
          <div className="no-window-drag gap-4 p-3">
            {pendingDomain.status === 'waiting-dns' ? (
              <DNSInstructions
                hostname={pendingDomain.hostname}
                // @ts-expect-error
                siteUrl={site.data?.document?.metadata?.siteUrl || ''}
              />
            ) : null}
            <PendingDomainStatus
              status={pendingDomain.status}
              // @ts-expect-error
              siteUrl={site.data?.document?.metadata?.siteUrl || ''}
            />
            <div className="flex justify-center">
              {hostSession.cancelPendingDomain.isLoading ? (
                <Spinner size="small" />
              ) : (
                <Button
                  size="iconSm"
                  variant="destructive"
                  onClick={() => {
                    hostSession.cancelPendingDomain.mutate(pendingDomain.id)
                  }}
                >
                  <X className="size-4" />
                  Cancel Domain Setup
                </Button>
              )}
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  )
}

function BreadcrumbEllipsis({
  crumbDetails,
  collapsedCount,
}: {
  crumbDetails: (CrumbDetails | null)[]
  collapsedCount: number
}) {
  const navigate = useNavigate()
  return (
    <HoverCard>
      <HoverCardTrigger className="no-window-drag">
        <Button size="iconSm" variant="ghost" className="no-window-drag">
          <AiOutlineEllipsis className="size-4" />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start">
        <div className="flex flex-col">
          {crumbDetails.slice(1, 1 + collapsedCount).map((crumb) => {
            if (!crumb) return null
            return (
              <TitleTextButton
                onClick={() => {
                  if (crumb.id) navigate({key: 'document', id: crumb.id})
                }}
              >
                {crumb?.name}
              </TitleTextButton>
            )
          })}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

function BreadcrumbSeparator() {
  return (
    <TitleText size="$4" color="$color10" className="font-thin">
      {' / '}
    </TitleText>
  )
}

function BreadcrumbErrorIcon() {
  return <AlertCircle size="$1" color="$red11" />
}

function BreadcrumbItem({
  details,
  isActive,
  onSize,
  homeMetadata,
  draft = false,
  maxWidth,
}: {
  details: CrumbDetails
  isActive?: boolean
  onSize: (rect: DOMRect) => void
  homeMetadata: HMMetadata | undefined
  draft?: boolean
  maxWidth?: number
}) {
  const navigate = useNavigate()
  const observerRef = useSizeObserver(onSize)
  if (details.isLoading) {
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (details.isError) {
    if (details.fallbackName) {
      return (
        <Tooltip content="Failed to Load this Document">
          <TitleTextButton
            className="no-window-drag text-destructive"
            onClick={() => {
              if (details.id) navigate({key: 'document', id: details.id})
            }}
          >
            {details.fallbackName}
          </TitleTextButton>
        </Tooltip>
      )
    }
    const {id} = details
    if (id) {
      return (
        <Tooltip content="Failed to Load">
          <Button
            size="iconSm"
            variant="ghost"
            className="no-window-drag m-0"
            onClick={() => {
              navigate({key: 'document', id})
            }}
          >
            <AlertCircle size={18} className="size-4 text-red-700" />
          </Button>
        </Tooltip>
      )
    }
    return <BreadcrumbErrorIcon />
  }
  if (!details?.name) return null

  const textStyle = maxWidth ? {maxWidth: `${maxWidth}px`} : {}

  let content = isActive ? (
    <div
      className="flex max-w-full min-w-0 items-center gap-2 overflow-hidden"
      style={textStyle}
    >
      <TitleText className={cn('min-w-0 flex-1 truncate font-bold')}>
        {details.name}
      </TitleText>
      {draft ? <DraftBadge className="flex-shrink-0" /> : null}
    </div>
  ) : (
    <TitleTextButton
      ref={observerRef}
      onClick={() => {
        if (details.id) navigate({key: 'document', id: details.id})
      }}
      className={cn('no-window-drag font-normal', maxWidth ? 'truncate' : '')}
      style={textStyle}
    >
      {details.name}
    </TitleTextButton>
  )
  return (
    <div className={cn('no-window-drag', isActive ? 'min-w-0 flex-1' : '')}>
      <HoverCard>
        <HoverCardTrigger>{content}</HoverCardTrigger>
        {draft ? null : (
          <HoverCardContent
            side="bottom"
            align="start"
            className="w-full max-w-lg p-1"
          >
            <PathItemCard details={details} homeMetadata={homeMetadata} />
          </HoverCardContent>
        )}
      </HoverCard>
    </div>
  )
}

function PathItemCard({
  details,
  homeMetadata,
}: {
  details: CrumbDetails
  homeMetadata: HMMetadata | undefined
}) {
  const docId = details.id ?? undefined
  const dir = useListDirectory(docId, {mode: 'Children'})
  const capability = useSelectedAccountCapability(docId)
  const canEditDoc = roleCanWrite(capability?.role)
  const drafts = useAccountDraftList(docId?.uid)
  if (!docId) return null
  const supportQueries: HMQueryResult[] = []
  if (dir.data) {
    supportQueries.push({
      in: docId,
      results: dir.data,
    })
  }
  const directoryItems = getSiteNavDirectory({
    id: docId,
    supportQueries,
    drafts: drafts.data,
  })
  return (
    <div className="flex max-h-[500px] max-w-lg flex-col justify-start gap-2 overflow-hidden p-2">
      <URLCardSection homeMetadata={homeMetadata} crumbDetails={details} />
      {directoryItems?.length ? (
        <>
          <ScrollArea className="flex-1 overflow-y-auto py-0">
            <div className="space-y-1">
              {directoryItems?.map((item) => {
                return (
                  <DocumentSmallListItem
                    key={
                      item.id?.path?.join('/') || item.id?.id || item.draftId
                    }
                    metadata={item.metadata}
                    id={item.id}
                    draftId={item.draftId}
                    isPublished={item.isPublished}
                  />
                )
              })}
            </div>
          </ScrollArea>
        </>
      ) : null}

      {canEditDoc ? (
        <div className="flex justify-start">
          <NewSubDocumentButton
            size="xs"
            locationId={docId}
            importDropdown={false}
          />
        </div>
      ) : null}
    </div>
  )
}

function URLCardSection({
  homeMetadata,
  crumbDetails,
}: {
  homeMetadata: HMMetadata | undefined
  crumbDetails: CrumbDetails
}) {
  const docId = crumbDetails.id ?? undefined
  const gwUrlStream = useGatewayUrlStream()
  const gwUrl = useStream(gwUrlStream)
  const siteBaseUrlWithProtocol =
    homeMetadata?.siteUrl || `${gwUrl || ''}/hm/${docId?.uid}`
  const siteBaseUrl = hostnameStripProtocol(siteBaseUrlWithProtocol)
  const {externalOpen} = useAppContext()
  const path = docId?.path || []
  if (!docId) return null
  return (
    <div>
      <div className="flex items-stretch rounded-md border">
        <Button
          size="xs"
          className="flex-1 justify-start overflow-hidden border-none text-left hover:cursor-pointer"
          onClick={() => {
            const url = siteBaseUrlWithProtocol + '/' + path.join('/')
            externalOpen(url)
          }}
        >
          <span className="text-muted-foreground truncate text-xs">
            {siteBaseUrl}

            {path &&
              path.map((p, index) => (
                <span key={`${p}-${index}`}>{`/${p}`}</span>
              ))}
          </span>
        </Button>

        <CopyReferenceButton
          docId={docId}
          isBlockFocused={false}
          latest
          copyIcon={Copy}
        />
      </div>
    </div>
  )
}

export function Title({
  size,
  onPublishSite,
}: {
  // @ts-expect-error
  size?: FontSizeTokens
  onPublishSite: (input: {id: UnpackedHypermediaId}) => void
}) {
  return (
    <div className="flex max-w-full min-w-64 flex-1 items-center gap-2 self-stretch overflow-hidden">
      <TitleContent size={size} onPublishSite={onPublishSite} />
    </div>
  )
}

function DraftTitle({route}: {route: DraftRoute; size?: string}) {
  const draft = useDraft(route.id)
  const navigate = useNavigate()
  const locationId = useMemo(() => {
    const lid = draftLocationId(draft.data)
    if (lid) return lid
    if (route.locationUid) {
      return hmId(route.locationUid, {
        path: route.locationPath,
      })
    } else {
      return undefined
    }
  }, [draft.data, route.locationUid, route.locationPath])

  useWindowTitleSetter(async () => {
    if (draft.data?.metadata.name) return `Draft: ${draft.data.metadata.name}`
    return 'Draft'
  }, [draft.data?.metadata.name])

  const editId = useMemo(() => {
    const eid = draftEditId(draft.data)
    if (eid) return eid
    if (route.editUid) {
      return hmId(route.editUid, {
        path: route.editPath,
      })
    }
    return undefined
  }, [draft.data, route.editUid, route.editPath])

  if (locationId)
    return (
      <BreadcrumbTitle
        entityId={locationId}
        hideControls
        draftName={draft.data?.metadata.name || 'New Draft'}
        draft
      />
    )

  if (editId)
    return (
      <BreadcrumbTitle
        entityId={editId}
        hideControls
        draftName={draft.data?.metadata.name}
        replaceLastItem={!!draft.data?.metadata.name}
        draft
      />
    )

  return (
    <div className="flex flex-1 items-stretch justify-stretch gap-2 overflow-hidden">
      <File className="size-4 self-center" />
      <TitleText
        className="no-window-drag self-center font-bold"
        onClick={() => {
          navigate({key: 'drafts'})
        }}
      >
        Drafts
      </TitleText>
      <BreadcrumbSeparator key={`draft-seperator`} />

      <TitleText className="self-center font-bold hover:underline">
        {draft.data?.metadata.name || 'New Draft'}
      </TitleText>
      <DraftBadge />
    </div>
  )
}

function ContactTitle({route}: {route: ContactRoute}) {
  const contact = useContact(route.id)
  const navigate = useNavigate()

  useWindowTitleSetter(async () => {
    if (contact.data?.metadata?.name)
      return `Contact: ${contact.data.metadata.name}`
    return 'Contact'
  }, [contact.data?.metadata?.name])

  return (
    <>
      <Contact className="size-4" />
      <TitleText
        className="no-window-drag self-center font-bold hover:underline"
        onClick={() => {
          navigate({key: 'contacts'})
        }}
      >
        Contacts
      </TitleText>
      <BreadcrumbSeparator key={`contacts-seperator`} />
      <TitleText fontWeight="bold">
        {contact.data?.metadata?.name || 'Untitled Contact'}
      </TitleText>
    </>
  )
}

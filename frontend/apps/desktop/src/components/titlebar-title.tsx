import {useAppContext} from '@/app-context'
import {useSizeObserver} from '@/components/app-embeds'
import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useContact, useSelectedAccountContacts} from '@/models/contacts'
import {useAccountDraftList, useListDirectory} from '@/models/documents'
import {useIdEntities, useItemsFromId} from '@/models/entities'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {useHostSession} from '@/models/host'
import {NewSubDocumentButton} from '@/pages/document'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  hmId,
  HMMetadata,
  HMQueryResult,
  hostnameStripProtocol,
  UnpackedHypermediaId,
} from '@shm/shared'
import {getContactMetadata, getDocumentTitle} from '@shm/shared/content'
import {useEntity} from '@shm/shared/models/entity'
import {ContactRoute, DraftRoute} from '@shm/shared/routes'
import {Button as TWButton} from '@shm/ui/button'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {DraftBadge} from '@shm/ui/draft-badge'
import {HoverCard} from '@shm/ui/hover-card'
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
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {TextProps} from '@shm/ui/text'
import {TitleText, TitleTextButton} from '@shm/ui/titlebar'
import {Tooltip} from '@shm/ui/tooltip'
import {useStream} from '@shm/ui/use-stream'
import {useMemo, useRef, useState} from 'react'
import {AiOutlineEllipsis} from 'react-icons/ai'
import {
  Button,
  FontSizeTokens,
  Popover,
  Text,
  Theme,
  View,
  XStack,
  YStack,
} from 'tamagui'
import {CopyReferenceButton} from './copy-reference-button'
import {FavoriteButton} from './favoriting'
import {DNSInstructions} from './publish-site'
import {DocOptionsButton} from './titlebar-common'
import {useWindowTitleSetter} from './window-title'

export function TitleContent({
  size = '$4',
  onPublishSite,
}: {
  size?: FontSizeTokens
  onPublishSite: (input: {id: UnpackedHypermediaId}) => void
}) {
  const route = useNavRoute()
  const titleProps: TextProps = {
    size: 'md',
    weight: 'bold',
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
        <Contact size={12} />
        <TitleText {...titleProps}>Contacts</TitleText>
      </>
    )
  }
  if (route.key === 'explore') {
    return (
      <>
        <Sparkles size={12} />
        <TitleText {...titleProps}>Explore</TitleText>
      </>
    )
  }
  if (route.key === 'favorites') {
    return (
      <>
        <Star size={12} />
        <TitleText {...titleProps}>Favorites</TitleText>
      </>
    )
  }
  if (route.key === 'library') {
    return (
      <>
        <Library size={12} />
        <TitleText {...titleProps}>Library</TitleText>
      </>
    )
  }
  if (route.key === 'drafts') {
    return (
      <>
        <File size={12} />
        <TitleTextButton
          fontWeight={'bold'}
          className="no-window-drag"
          hoverStyle={{textDecorationLine: 'none'}}
        >
          Drafts
        </TitleTextButton>
      </>
    )
  }
  if (route.key === 'contact') {
    return <ContactTitle route={route} />
  }
  if (route.key === 'document') {
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
  const contacts = useSelectedAccountContacts()
  const latestDoc = useEntity({...entityId, version: null, latest: true})
  const isLatest =
    entityId.latest || entityId.version === latestDoc.data?.document?.version
  const entityIds = useItemsFromId(entityId)
  const entityContents = useIdEntities(entityIds)
  const homeMetadata = entityContents.at(0)?.entity?.document?.metadata
  const [collapsedCount, setCollapsedCount] = useState(0)
  const widthInfo = useRef({} as Record<string, number>)
  const crumbDetails: (CrumbDetails | null)[] = useMemo(() => {
    const crumbs: (CrumbDetails | null)[] = []
    let items = entityIds.flatMap((id, idIndex) => {
      const contents = entityContents[idIndex]
      let name: string
      if (id.path?.length) {
        name = getDocumentTitle(contents.entity?.document) || ''
      } else {
        name = getContactMetadata(
          id.uid,
          contents.entity?.document?.metadata,
          contacts.data,
        ).name
      }
      return [
        {
          name,
          fallbackName: id.path?.at(-1),
          isError: contents.entity && !contents.entity.document,
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
    // 83 is the measured width of the controls like favorite, copy link, options dropdown.
    const availableContainerWidth = containerWidth - 83
    // If you change the controls in a way that affects width, please update this value ^^
    const spacerWidth = 15
    const ellipsisWidth = 20
    const firstCrumbKey = crumbDetails[0]?.crumbKey
    const lastCrumbKey = crumbDetails.at(-1)?.crumbKey
    if (!firstCrumbKey || !lastCrumbKey || lastCrumbKey === firstCrumbKey)
      return
    const firstItemWidth = widthInfo.current[firstCrumbKey]
    const lastItemWidth = widthInfo.current[lastCrumbKey]
    const fixedItemWidth = firstItemWidth + lastItemWidth + spacerWidth
    const crumbWidths: number[] = crumbDetails.map((details) => {
      return (details && widthInfo.current[details.crumbKey]) || 0
    })
    const desiredWidth = crumbWidths.slice(1, -1).reduce((acc, w) => {
      if (!w) return acc
      return acc + w + spacerWidth
    }, 0)
    let usableWidth = desiredWidth
    const maxCollapseCount = crumbDetails.length - 2
    let newCollapseCount = 0
    while (
      usableWidth +
        fixedItemWidth +
        (newCollapseCount ? spacerWidth + ellipsisWidth : 0) >
        availableContainerWidth &&
      newCollapseCount < maxCollapseCount
    ) {
      usableWidth -= crumbWidths[1 + newCollapseCount] + spacerWidth
      newCollapseCount++
    }
    setCollapsedCount(newCollapseCount)
  }

  const containerObserverRef = useSizeObserver(({width}) => {
    widthInfo.current.container = width
    requestAnimationFrame(() => {
      updateWidths()
    })
  })

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
    <XStack
      f={1}
      marginRight={'$4'}
      margin={0}
      ai="stretch"
      alignSelf="stretch"
      overflow="hidden"
      height="100%"
      ref={containerObserverRef}
      width="100%"
    >
      <XStack
        position="absolute"
        gap="$2"
        f={1}
        marginRight={'$4'}
        ai="center"
        width="100%"
        height="100%"
      >
        <XStack
          overflow="hidden"
          ai="center"
          height="100%"
          flexShrink={1}
          gap="$2"
        >
          {displayItems.flatMap((item, itemIndex) => {
            if (!item) return null
            return [
              item,
              itemIndex < displayItems.length - 1 ? (
                <BreadcrumbSeparator key={`seperator-${itemIndex}`} />
              ) : null,
            ]
          })}
        </XStack>
        {!hideControls ? (
          <XStack ai="center" f={1} flexShrink={0} jc="flex-start">
            <XStack ai="center" className="no-window-drag">
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
            </XStack>
          </XStack>
        ) : null}
      </XStack>
    </XStack>
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
      <Text color="$color11">
        Waiting for DNS to resolve to {hostnameStripProtocol(siteUrl)}
      </Text>
    )
  }
  if (status === 'initializing') {
    return <Text color="$color11">Initializing Domain...</Text>
  }
  return <Text color="$red8">Error</Text>
}

function PendingDomain({id}: {id: UnpackedHypermediaId}) {
  const hostSession = useHostSession()
  const site = useEntity(id)
  if (id.path?.length) return null
  const pendingDomain = hostSession.pendingDomains?.find(
    (domain) => domain.siteUid === id.uid,
  )
  if (!pendingDomain) return null
  return (
    <View className="no-window-drag" padding="$2">
      <HoverCard
        contentProps={{
          backgroundColor: '#1c1c1c',
        }}
        content={
          <Theme name="dark_blue">
            <YStack className="no-window-drag" gap="$4" padding="$3">
              {pendingDomain.status === 'waiting-dns' ? (
                <DNSInstructions
                  hostname={pendingDomain.hostname}
                  siteUrl={site.data?.document?.metadata?.siteUrl || ''}
                />
              ) : null}
              <PendingDomainStatus
                status={pendingDomain.status}
                siteUrl={site.data?.document?.metadata?.siteUrl || ''}
              />
              <XStack jc="center">
                {hostSession.cancelPendingDomain.isLoading ? (
                  <Spinner size="small" />
                ) : (
                  <Button
                    size="$2"
                    theme="red"
                    onPress={() => {
                      hostSession.cancelPendingDomain.mutate(pendingDomain.id)
                    }}
                    icon={X}
                  >
                    Cancel Domain Setup
                  </Button>
                )}
              </XStack>
            </YStack>
          </Theme>
        }
      >
        <Spinner size="small" />
      </HoverCard>
    </View>
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
    <Popover>
      <Popover.Trigger className="no-window-drag">
        <Button
          size="$1"
          icon={AiOutlineEllipsis}
          chromeless
          backgroundColor="$colorTransparent"
        ></Button>
      </Popover.Trigger>
      <Popover.Content bg="$backgroundStrong">
        <Popover.Arrow borderWidth={1} borderColor="$borderColor" />
        <YStack space="$3">
          {crumbDetails.slice(1, 1 + collapsedCount).map((crumb) => {
            if (!crumb) return null
            return (
              <TitleTextButton
                onPress={() => {
                  if (crumb.id) navigate({key: 'document', id: crumb.id})
                }}
              >
                {crumb?.name}
              </TitleTextButton>
            )
          })}
        </YStack>
      </Popover.Content>
    </Popover>
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
}: {
  details: CrumbDetails
  isActive?: boolean
  onSize: (rect: DOMRect) => void
  homeMetadata: HMMetadata | undefined
  draft?: boolean
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
            fontWeight={'bold'}
            color="$red10"
            className="no-window-drag"
            onPress={() => {
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
            chromeless
            size="$2"
            margin={0}
            color="$red10"
            backgroundColor="$colorTransparent"
            borderWidth={0}
            className="no-window-drag"
            icon={AlertCircle}
            onPress={() => {
              navigate({key: 'document', id})
            }}
          />
        </Tooltip>
      )
    }
    return <BreadcrumbErrorIcon />
  }
  if (!details?.name) return null

  let content = isActive ? (
    <div className="flex items-center gap-2">
      <TitleText fontWeight="bold">{details.name}</TitleText>
      {draft ? <DraftBadge /> : null}
    </div>
  ) : (
    <TitleTextButton
      ref={observerRef}
      alignItems="center"
      justifyContent="center"
      className="no-window-drag"
      onPress={() => {
        if (details.id) navigate({key: 'document', id: details.id})
      }}
      fontWeight={isActive ? 'bold' : 'normal'}
    >
      {details.name}
    </TitleTextButton>
  )
  return (
    <View
      marginTop="$4"
      paddingBottom="$4"
      className="no-window-drag"
      minHeight={40}
      justifyContent="center"
    >
      <HoverCard
        content={
          draft ? null : (
            <PathItemCard details={details} homeMetadata={homeMetadata} />
          )
        }
        contentProps={{padding: 0}}
      >
        {content}
      </HoverCard>
    </View>
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
    <div className="border-border flex max-h-[500px] max-w-lg flex-col justify-start gap-2 overflow-hidden rounded-md border p-2 shadow-md">
      <URLCardSection homeMetadata={homeMetadata} crumbDetails={details} />
      {directoryItems?.length || canEditDoc ? <Separator /> : null}
      {directoryItems?.length ? (
        <>
          <ScrollArea className="flex-1 overflow-y-auto py-0">
            {/* <YStack gap="$1"> */}
            {directoryItems?.map((item) => {
              return (
                <DocumentSmallListItem
                  key={item.id?.path?.join('/') || item.id?.id || item.draftId}
                  metadata={item.metadata}
                  id={item.id}
                  onPress={() => {}}
                  draftId={item.draftId}
                  isPublished={item.isPublished}
                />
              )
            })}
            {/* </YStack> */}
          </ScrollArea>
        </>
      ) : null}

      {canEditDoc ? (
        <div className="flex justify-start">
          <NewSubDocumentButton locationId={docId} importDropdown={false} />
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
        <TWButton
          size="xs"
          className="flex-1 justify-start overflow-hidden border-none text-left hover:cursor-pointer"
          onClick={() => {
            const url = siteBaseUrlWithProtocol + '/' + path.join('/')
            externalOpen(url)
          }}
        >
          <span className="truncate text-xs">
            {siteBaseUrl}

            {path &&
              path.map((p, index) => (
                <span key={`${p}-${index}`}>{`/${p}`}</span>
              ))}
          </span>
        </TWButton>

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
  size?: FontSizeTokens
  onPublishSite: (input: {id: UnpackedHypermediaId}) => void
}) {
  return (
    <XStack
      gap="$2"
      alignSelf="stretch"
      alignItems="center"
      paddingLeft="$2"
      maxWidth="100%"
      minWidth={240}
      f={1}
    >
      <TitleContent size={size} onPublishSite={onPublishSite} />
    </XStack>
  )
}

function DraftTitle({route}: {route: DraftRoute; size?: FontSizeTokens}) {
  const draft = useDraft(route.id)
  const navigate = useNavigate()
  const locationId = useMemo(() => {
    if (draft.data?.locationId) return draft.data.locationId
    let uId = draft.data?.locationUid || route.locationUid
    let path = draft.data?.locationPath || route.locationPath
    if (uId) {
      return hmId('d', uId, {
        path,
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
    if (draft.data?.editId) return draft.data.editId
    let uId = draft.data?.editUid || route.editUid
    let path = draft.data?.editPath || route.editPath
    if (uId) {
      return hmId('d', uId, {
        path,
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
    <XStack
      f={1}
      marginRight={'$4'}
      margin={0}
      ai="stretch"
      alignSelf="stretch"
      overflow="hidden"
      height="100%"
      width="100%"
    >
      <XStack
        position="absolute"
        gap="$2"
        f={1}
        marginRight={'$4'}
        ai="center"
        width="100%"
        // className="no-window-drag"
        height="100%"
      >
        <File size={12} />
        <TitleTextButton
          fontWeight={'bold'}
          className="no-window-drag"
          onPress={() => {
            navigate({key: 'drafts'})
          }}
        >
          Drafts
        </TitleTextButton>
        <BreadcrumbSeparator key={`draft-seperator`} />
        <XStack ai="center" gap="$1">
          <TitleText fontWeight="bold">
            {draft.data?.metadata.name || 'New Draft'}
          </TitleText>
          <DraftBadge />
        </XStack>
      </XStack>
    </XStack>
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
      <Contact size={12} />
      <TitleTextButton
        className="no-window-drag"
        onPress={() => {
          navigate({key: 'contacts'})
        }}
      >
        Contacts
      </TitleTextButton>
      <BreadcrumbSeparator key={`contacts-seperator`} />
      <TitleText fontWeight="bold">
        {contact.data?.metadata?.name || 'Untitled Contact'}
      </TitleText>
    </>
  )
}

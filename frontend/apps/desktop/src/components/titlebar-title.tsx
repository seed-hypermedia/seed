import {useSizeObserver} from '@/components/app-embeds'
import {roleCanWrite, useMyCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useAccountDraftList, useListDirectory} from '@/models/documents'
import {useRouteBreadcrumbRoutes, useRouteEntities} from '@/models/entities'
import {useGatewayUrlStream} from '@/models/gateway-settings'
import {useHostSession} from '@/models/host'
import {useOpenUrl} from '@/open-url'
import {NewSubDocumentButton} from '@/pages/document'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  HMMetadata,
  HMQueryResult,
  hostnameStripProtocol,
  UnpackedHypermediaId,
} from '@shm/shared'
import {getDocumentTitle} from '@shm/shared/content'
import {useEntity} from '@shm/shared/models/entity'
import {DocumentRoute, DraftRoute, NavRoute} from '@shm/shared/routes'
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
import {Spinner} from '@shm/ui/spinner'
import {TitleText, TitleTextButton} from '@shm/ui/titlebar'
import {Tooltip} from '@shm/ui/tooltip'
import {useStream} from '@shm/ui/use-stream'
import {useEffect, useMemo, useRef, useState} from 'react'
import {AiOutlineEllipsis} from 'react-icons/ai'
import {
  Button,
  ButtonText,
  FontSizeTokens,
  Popover,
  Text,
  TextProps,
  Theme,
  View,
  XStack,
  YStack,
} from 'tamagui'
import {CopyReferenceButton} from './copy-reference-button'
import {FavoriteButton} from './favoriting'
import {DNSInstructions} from './publish-site'

export function TitleContent({size = '$4'}: {size?: FontSizeTokens}) {
  const route = useNavRoute()
  const titleProps: TextProps = {
    size,
    fontWeight: 'bold',
    'data-testid': 'titlebar-title',
  }
  useEffect(() => {
    async function getTitleOfRoute(route: NavRoute): Promise<string> {
      if (route.key === 'contacts') return 'Contacts'
      return ''
    }
    getTitleOfRoute(route).then((title) => {
      // we set the window title so the window manager knows the title in the Window menu
      // @ts-ignore
      window.document.title = title
      // window.windowInfo.setTitle(title)
    })
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
        <TitleText {...titleProps}>Drafts</TitleText>
      </>
    )
  }

  if (route.key === 'document') {
    return <BreadcrumbTitle route={route} />
  }
  if (route.key === 'draft') {
    return <DraftTitle route={route} />
  }
  return null
}

type CrumbDetails = {
  name?: string
  fallbackName?: string
  route: NavRoute | null
  isError?: boolean
  isLoading?: boolean
  crumbKey: string
}

function BreadcrumbTitle({
  route,
  overwriteActiveTitle,
}: {
  route: DocumentRoute
  overwriteActiveTitle?: string
}) {
  const latestDoc = useEntity({...route.id, version: null, latest: true})
  const isLatest =
    route.id.latest || route.id.version === latestDoc.data?.document?.version
  const entityRoutes = useRouteBreadcrumbRoutes(route)
  const entityContents = useRouteEntities(entityRoutes)
  const homeMetadata = entityContents.at(0)?.entity?.document?.metadata
  const [collapsedCount, setCollapsedCount] = useState(0)
  const widthInfo = useRef({} as Record<string, number>)
  const crumbDetails: (CrumbDetails | null)[] = useMemo(
    () =>
      entityRoutes.flatMap((route, routeIndex) => {
        const contents = entityContents[routeIndex]
        return [
          {
            name: getDocumentTitle(contents.entity?.document) || undefined,
            fallbackName:
              typeof route.id === 'string' ? route.id : route.id?.path?.at(-1),
            isError: contents.entity && !contents.entity.document,
            isLoading: !contents.entity,
            route: {
              ...route,
              blockId: undefined,
              isBlockFocused: undefined,
              context: [...entityRoutes.slice(0, routeIndex)],
            },
            crumbKey: `r-${routeIndex}`,
          },
        ]
      }),
    [entityRoutes, entityContents],
  )
  const isAllError = crumbDetails.every((details) => details?.isError)

  function updateWidths() {
    const containerWidth = widthInfo.current.container
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
        containerWidth &&
      newCollapseCount < maxCollapseCount
    ) {
      usableWidth -= crumbWidths[1 + newCollapseCount] + spacerWidth
      newCollapseCount++
    }
    setCollapsedCount(newCollapseCount)
  }

  const containerObserverRef = useSizeObserver(({width}) => {
    widthInfo.current.container = width
    updateWidths()
  })
  const activeItem: CrumbDetails | null = crumbDetails[crumbDetails.length - 1]
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
      details={
        overwriteActiveTitle
          ? {...activeItem, isError: false, name: overwriteActiveTitle}
          : activeItem
      }
      key={activeItem.crumbKey}
      isActive
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
        // className="no-window-drag"
        height="100%"
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
        <XStack>
          <PendingDomain id={route.id} />
          <FavoriteButton id={route.id} />
          <CopyReferenceButton
            docId={route.id}
            isBlockFocused={route.isBlockFocused || false}
            latest={isLatest}
            size="$2"
          />
        </XStack>
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
                  if (crumb.route) navigate(crumb.route)
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
    <TitleText size="$4" color="$color10" flexShrink={0}>
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
}: {
  details: CrumbDetails
  isActive?: boolean
  onSize: (rect: DOMRect) => void
  homeMetadata: HMMetadata | undefined
}) {
  const navigate = useNavigate()
  const observerRef = useSizeObserver(onSize)
  if (details.isLoading) {
    return <Spinner />
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
              if (details.route) navigate(details.route)
            }}
          >
            {details.fallbackName}
          </TitleTextButton>
        </Tooltip>
      )
    }
    const {route} = details
    if (route) {
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
              navigate(route)
            }}
          />
        </Tooltip>
      )
    }
    return <BreadcrumbErrorIcon />
  }
  if (!details?.name) return null

  let content = isActive ? (
    <TitleText ref={observerRef} fontWeight="bold">
      {details.name}
    </TitleText>
  ) : (
    <TitleTextButton
      ref={observerRef}
      alignItems="center"
      justifyContent="center"
      className="no-window-drag"
      onPress={() => {
        if (details.route) navigate(details.route)
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
        content={<PathItemCard details={details} homeMetadata={homeMetadata} />}
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
  const docId = details.route?.key === 'document' ? details.route.id : undefined
  const dir = useListDirectory(docId, {mode: 'Children'})
  const capability = useMyCapability(docId)
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
    <YStack>
      <URLCardSection homeMetadata={homeMetadata} crumbDetails={details} />
      <YStack paddingVertical="$2" gap="$3">
        <YStack gap="$1">
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
        </YStack>
      </YStack>
      {canEditDoc ? (
        <XStack gap="$2" ai="center" paddingHorizontal="$2">
          <NewSubDocumentButton locationId={docId} importDropdown={false} />
        </XStack>
      ) : null}
    </YStack>
  )
}

function URLCardSection({
  homeMetadata,
  crumbDetails,
}: {
  homeMetadata: HMMetadata | undefined
  crumbDetails: CrumbDetails
}) {
  const docId =
    crumbDetails.route?.key === 'document' ? crumbDetails.route.id : undefined
  const gwUrlStream = useGatewayUrlStream()
  const gwUrl = useStream(gwUrlStream)
  const siteBaseUrlWithProtocol =
    homeMetadata?.siteUrl || `${gwUrl || ''}/hm/${docId?.uid}`
  const siteBaseUrl = hostnameStripProtocol(siteBaseUrlWithProtocol)
  const openUrl = useOpenUrl()
  const path = docId?.path || []
  const isHome = !path.length
  if (!docId) return null
  return (
    <YStack padding="$2" borderBottomWidth={1} borderColor="$borderColor">
      <XStack ai="center" gap="$2">
        <ButtonText
          cursor="pointer"
          onPress={() => {
            openUrl(siteBaseUrlWithProtocol + '/' + path.join('/'))
          }}
          group="item"
        >
          <Text
            color={isHome ? '$brand5' : '$color8'}
            $group-item-hover={{color: '$blue9'}}
          >
            {siteBaseUrl}
          </Text>
          {path &&
            path.map((p, index) => (
              <Text
                color={index === path.length - 1 ? '$brand5' : '$color8'}
                $group-item-hover={{color: '$blue9'}}
              >
                {`/${p}`}
              </Text>
            ))}
        </ButtonText>
        <CopyReferenceButton
          docId={docId}
          isBlockFocused={false}
          latest={true}
          size="$2"
          copyIcon={Copy}
        />
      </XStack>
    </YStack>
  )
}

export function Title({size}: {size?: FontSizeTokens}) {
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
      <TitleContent size={size} />
    </XStack>
  )
}

function DraftTitle({route}: {route: DraftRoute; size?: FontSizeTokens}) {
  const draft = useDraft(route.id)

  console.log(`== ~ DraftTitle ~ draft:`, route)

  // TODO: get the name from the draft
  const name = 'foo'

  let displayTitle = name || 'Untitled Document'

  useWindowTitle(name ? `Draft: ${name}` : undefined)

  const navigate = useNavigate()

  if (!route.id) {
    displayTitle = 'New Draft'
  }

  return (
    <XStack
      f={1}
      marginRight={'$4'}
      margin={0}
      alignItems="center"
      overflow="hidden"
      height="100%"
      width="100%"
      gap="$2"
    >
      <File size={12} />
      <TitleTextButton
        alignItems="center"
        justifyContent="center"
        className="no-window-drag"
        onPress={() => {
          navigate({key: 'drafts'})
        }}
      >
        Drafts
      </TitleTextButton>

      <BreadcrumbSeparator key={`seperator-draft`} />
      <TitleTextButton
        alignItems="center"
        justifyContent="center"
        className="no-window-drag"
        fontWeight="bold"
        onPress={() => {
          navigate({key: 'draft', id: route.id})
        }}
      >
        {displayTitle}
      </TitleTextButton>
    </XStack>
  )
  return (
    <BreadcrumbTitle
      route={{key: 'document', id: route.id}}
      overwriteActiveTitle={name || 'Untitled Document'}
    />
  )
}

function useWindowTitle(title?: string) {
  useEffect(() => {
    if (title) {
      window.document.title = title
    }
  }, [title])
}

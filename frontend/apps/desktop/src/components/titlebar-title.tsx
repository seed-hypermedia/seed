import {
  BreadcrumbIconKey,
  BreadcrumbItem,
  useRouteBreadcrumbs,
} from '@/hooks/use-route-breadcrumbs'
import {useHostSession} from '@/models/host'
import {useSizeObserver} from '@/utils/use-size-observer'
import {useNavigate} from '@/utils/useNavigate'
import {
  HMMetadata,
  hostnameStripProtocol,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@shm/ui//hover-card'
import {Button} from '@shm/ui/button'
import {DraftBadge} from '@shm/ui/draft-badge'
import {useHighlighter} from '@shm/ui/highlight-context'
import {AlertCircle, Contact, File, Star, X} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {SizableText, TextProps} from '@shm/ui/text'
import {TitleText, TitleTextButton} from '@shm/ui/titlebar'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {ReactNode, useRef, useState} from 'react'
import {AiOutlineEllipsis} from 'react-icons/ai'
import {BookmarkButton} from './bookmarking'
import {CopyReferenceButton} from './copy-reference-button'
import {DNSInstructions} from './publish-site'
import {useWindowTitleSetter} from './window-title'

function BreadcrumbIcon({icon}: {icon: BreadcrumbIconKey}): ReactNode {
  if (icon === 'contact') return <Contact className="size-4" />
  if (icon === 'star') return <Star className="size-4" />
  if (icon === 'file') return <File className="size-4" />
  return null
}

export function TitleContent({
  size = '$4',
  extraButtons,
}: {
  // @ts-expect-error
  size?: FontSizeTokens
  extraButtons?: ReactNode
}) {
  const breadcrumbs = useRouteBreadcrumbs()
  const navigate = useNavigate()
  const titleProps: TextProps = {
    size: 'md',
    weight: 'bold',
    // @ts-expect-error
    'data-testid': 'titlebar-title',
  }

  useWindowTitleSetter(async () => {
    return breadcrumbs.windowTitle
  }, [breadcrumbs.windowTitle])

  if (breadcrumbs.isAllError || !breadcrumbs.items.length) return null

  // Simple routes (single item, no entity)
  if (
    !breadcrumbs.entityId &&
    breadcrumbs.items.length <= 2 &&
    !breadcrumbs.isDraft
  ) {
    const icon = <BreadcrumbIcon icon={breadcrumbs.icon} />
    if (breadcrumbs.items.length === 1) {
      return (
        <span className="flex items-center gap-2">
          {icon}
          <TitleText {...titleProps}>{breadcrumbs.items[0].name}</TitleText>
        </span>
      )
    }
    // Contact/profile routes (2 items: parent + name)
    return (
      <>
        {icon}
        <TitleText
          className="no-window-drag self-center font-bold hover:underline"
          onClick={() => {
            if (breadcrumbs.items[0].crumbKey === 'contacts-parent') {
              navigate({key: 'contacts'})
            }
          }}
        >
          {breadcrumbs.items[0].name}
        </TitleText>
        <BreadcrumbSeparator />
        <TitleText fontWeight="bold">{breadcrumbs.items[1].name}</TitleText>
      </>
    )
  }

  // Draft fallback (Drafts / DraftName)
  if (breadcrumbs.isDraft && !breadcrumbs.entityId) {
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
        <BreadcrumbSeparator />
        <TitleText className="self-center font-bold hover:underline">
          {breadcrumbs.items[1]?.name || 'New Draft'}
        </TitleText>
        <DraftBadge />
      </div>
    )
  }

  // Entity routes (document, feed, directory, etc.) and draft with entity
  if (breadcrumbs.entityId) {
    return (
      <BreadcrumbTitleView
        items={breadcrumbs.items}
        entityId={breadcrumbs.entityId}
        isLatest={breadcrumbs.isLatest}
        isDraft={breadcrumbs.isDraft}
        hideControls={breadcrumbs.hideControls}
        extraButtons={extraButtons}
      />
    )
  }

  return null
}

function BreadcrumbTitleView({
  items,
  entityId,
  isLatest,
  isDraft,
  hideControls = false,
  extraButtons,
}: {
  items: BreadcrumbItem[]
  entityId: UnpackedHypermediaId
  isLatest: boolean
  isDraft: boolean
  hideControls?: boolean
  extraButtons?: ReactNode
}) {
  const homeMetadata = undefined // homeMetadata is only used in PathItemCard which isn't rendered inline
  const [collapsedCount, setCollapsedCount] = useState(0)
  const [itemMaxWidths, setItemMaxWidths] = useState<Record<string, number>>({})
  const widthInfo = useRef({} as Record<string, number>)

  function updateWidths() {
    const containerWidth = widthInfo.current.container
    if (!containerWidth) return

    // 83 is the measured width of the controls like bookmark, copy link, options dropdown.
    const availableContainerWidth = containerWidth - 83
    const spacerWidth = 15
    const ellipsisWidth = 20

    if (items.length === 0) return

    // Calculate total width needed
    const crumbWidths: number[] = items.map((details) => {
      return (details && widthInfo.current[details.crumbKey]) || 0
    })

    const separatorCount = items.length - 1
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
    const firstCrumbKey = items[0]?.crumbKey
    const lastCrumbKey = items.at(-1)?.crumbKey
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

    const maxCollapseCount = items.length - 2
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
      for (let i = newCollapseCount + 1; i < items.length - 1; i++) {
        const key = items[i]?.crumbKey
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
  const activeItem: BreadcrumbItem | null = items[items.length - 1]
  const firstInactiveDetail = items[0] === activeItem ? null : items[0]
  if (!activeItem) return null
  const firstItem = firstInactiveDetail ? (
    <BreadcrumbItemView
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

  const remainderItems = items.slice(collapsedCount + 1, -1).map((details) => {
    if (!details) return null
    return (
      <BreadcrumbItemView
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
        crumbDetails={items}
        collapsedCount={collapsedCount}
      />,
    )
  }
  displayItems.push(...remainderItems)
  displayItems.push(
    <BreadcrumbItemView
      homeMetadata={homeMetadata}
      details={activeItem}
      key={activeItem.crumbKey}
      isActive
      draft={isDraft}
      onSize={({width}: DOMRect) => {
        if (width) {
          widthInfo.current[activeItem.crumbKey] = width
          updateWidths()
        }
      }}
    />,
  )

  const isAllError = items.every((details) => details?.isError)
  if (isAllError || !displayItems.length) return null

  return (
    <div
      ref={containerObserverRef}
      className="flex items-center gap-2 overflow-hidden"
    >
      <div className="flex h-full min-w-0 flex-1 items-center gap-2 overflow-hidden">
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
          <BookmarkButton id={entityId} />
          <CopyReferenceButton
            docId={entityId}
            isBlockFocused={false} // TODO: learn why isBlockFocused is needed
            latest={isLatest}
          />
          {extraButtons}
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
  crumbDetails: (BreadcrumbItem | null)[]
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

function BreadcrumbItemView({
  details,
  isActive,
  onSize,
  homeMetadata,
  draft = false,
  maxWidth,
}: {
  details: BreadcrumbItem
  isActive?: boolean
  onSize: (rect: DOMRect) => void
  homeMetadata: HMMetadata | undefined
  draft?: boolean
  maxWidth?: number
}) {
  const navigate = useNavigate()
  const observerRef = useSizeObserver(onSize)
  const highlighter = useHighlighter()

  if (details.isLoading) {
    return (
      <div className="flex items-center justify-center">
        <TitleTextButton className="no-window-drag text-foreground-muted">
          {details.fallbackName}
        </TitleTextButton>
      </div>
    )
  }
  if (details.isTombstone) {
    return (
      <Tooltip content="This Document has been deleted">
        <TitleTextButton className="no-window-drag text-destructive">
          {details.fallbackName}
        </TitleTextButton>
      </Tooltip>
    )
  }
  if (details.isNotFound) {
    return (
      <Tooltip content="Document not found on the network">
        <TitleTextButton className="no-window-drag text-destructive">
          {details.fallbackName}
        </TitleTextButton>
      </Tooltip>
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
      className="flex max-w-full min-w-0 items-center gap-2 overflow-hidden pr-2"
      style={textStyle}
      {...highlighter(details.id)}
    >
      <TitleText className={cn('min-w-0 flex-1 truncate font-bold')}>
        {details.name}
      </TitleText>
      {draft ? <DraftBadge className="flex-shrink-0" /> : null}
    </div>
  ) : (
    <TitleText
      ref={observerRef}
      className={cn('no-window-drag font-normal', maxWidth ? 'truncate' : '')}
      style={textStyle}
      {...highlighter(details.id)}
    >
      {details.name}
    </TitleText>
  )
  return (
    <div className={cn('no-window-drag', isActive ? 'min-w-0 flex-1' : '')}>
      {content}
    </div>
  )
}

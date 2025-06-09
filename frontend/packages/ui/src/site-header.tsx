import {
  getMetadataName,
  HMDocument,
  HMEntityContent,
  HMMetadata,
  HMQueryResult,
  hostnameStripProtocol,
  NavRoute,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useTxString, useTxUtils} from '@shm/shared/translation'
import {XStack, YStack} from '@tamagui/stacks'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button} from './components/button'
import {DraftBadge} from './draft-badge'
import {ArrowRight, Close, Menu, X} from './icons'
import {LinkDropdown, LinkItemType} from './link-dropdown'
import {
  DocNavigationDocument,
  DocumentOutline,
  DocumentSmallListItem,
  getSiteNavDirectory,
  useNodesOutline,
} from './navigation'
import {HeaderSearch, MobileSearch} from './search'
import {SiteLogo} from './site-logo'
import {Tooltip} from './tooltip'
import {useIsDark} from './use-is-dark'
import {cn} from './utils'

export function SiteHeader({
  originHomeId,
  docId,
  items,
  isCenterLayout = false,
  children,
  document,
  supportDocuments,
  onBlockFocus,
  onShowMobileMenu,
  supportQueries,
  origin,
  onScroll,
  noScroll = false,
  isLatest = true,
}: {
  originHomeId: UnpackedHypermediaId | null
  docId: UnpackedHypermediaId | null
  items?: DocNavigationDocument[]
  isCenterLayout?: boolean
  children?: React.ReactNode
  document?: HMDocument
  supportDocuments?: HMEntityContent[]
  onBlockFocus?: (blockId: string) => void
  onShowMobileMenu?: (isOpen: boolean) => void
  supportQueries?: HMQueryResult[]
  origin?: string
  onScroll?: () => void
  noScroll?: boolean
  isLatest?: boolean
}) {
  const isDark = useIsDark()
  const [isMobileMenuOpen, _setIsMobileMenuOpen] = useState(false)
  function setIsMobileMenuOpen(isOpen: boolean) {
    _setIsMobileMenuOpen(isOpen)
    onShowMobileMenu?.(isOpen)
  }
  const homeDoc = !docId?.path?.length
    ? {document, id: docId}
    : supportDocuments?.find(
        (doc) => doc.id.uid === docId?.uid && !doc.id.path?.length,
      )
  const headerSearch = (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn('md:hidden')}
        onClick={() => {
          setIsMobileMenuOpen(true)
        }}
      >
        <Menu size={20} />
      </Button>
      {originHomeId ? (
        <XStack display="none" $gtSm={{display: 'flex'}}>
          <HeaderSearch originHomeId={originHomeId} />
        </XStack>
      ) : null}
    </>
  )
  const isHomeDoc = !docId?.path?.length
  if (!homeDoc) return null
  const headerHomeId = homeDoc.id
  if (!headerHomeId) return null

  return (
    <>
      {docId && document ? (
        <GotoLatestBanner isLatest={isLatest} id={docId} document={document} />
      ) : null}
      {docId && origin && originHomeId && originHomeId.uid !== docId.uid ? (
        <HypermediaHostBanner origin={origin} />
      ) : null}
      <header
        className={cn(
          'w-full p-4 border-b border-muted flex bg-white dark:bg-black',
          {
            'flex-col': isCenterLayout,
            'flex-row items-center': !isCenterLayout,
          },
        )}
        // this data attribute is used by the hypermedia highlight component
        data-docid={headerHomeId.id}
      >
        <div
          className={cn(' flex items-center self-stretch shrink-0', {
            'justify-center': isCenterLayout,
            'flex-start': !isCenterLayout,
          })}
        >
          <div className="flex flex-1 justify-center">
            <SiteLogo id={headerHomeId} metadata={homeDoc.document?.metadata} />
          </div>
          {isCenterLayout ? headerSearch : null}
        </div>

        <div
          className={cn('px-2 flex-1 overflow-hidden', {
            flex: !isCenterLayout,
          })}
        >
          {items?.length ? (
            <SiteHeaderMenu
              items={items}
              docId={docId}
              isCenterLayout={isCenterLayout}
            />
          ) : null}
        </div>

        {isCenterLayout ? null : headerSearch}
        <MobileMenu
          open={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
          renderContent={() => (
            <div>
              <MobileSearch originHomeId={originHomeId} />

              {isHomeDoc ? null : ( // if we are on the home page, we will see the home directory below the outline
                <YStack gap="$2.5" marginTop="$2.5" marginBottom="$4">
                  {items?.map((item) => (
                    <DocumentSmallListItem
                      onPress={() => {
                        console.log('~ onPress')
                        setIsMobileMenuOpen(false)
                      }}
                      key={item.id?.id || ''}
                      id={item.id}
                      metadata={item.metadata}
                      draftId={item.draftId}
                      isPublished={item.isPublished}
                    />
                  ))}
                </YStack>
              )}

              {docId && document && !isHomeDoc && (
                <MobileMenuOutline
                  onActivateBlock={(blockId) => {
                    setIsMobileMenuOpen(false)
                    onBlockFocus?.(blockId)
                  }}
                  document={document}
                  docId={docId}
                  supportDocuments={supportDocuments}
                />
              )}
              {docId && isHomeDoc && (
                <NavItems
                  id={docId}
                  supportQueries={supportQueries}
                  onPress={() => {
                    console.log('~ onPress')
                    setIsMobileMenuOpen(false)
                  }}
                />
              )}
            </div>
          )}
        />
      </header>
    </>
  )
}

function NavItems({
  id,
  supportQueries,
  onPress,
}: {
  id: UnpackedHypermediaId
  supportQueries?: HMQueryResult[]
  onPress?: () => void
}) {
  const directoryItems = getSiteNavDirectory({
    id,
    supportQueries,
    // todo: pass drafts
  })
  return (
    <YStack gap="$2.5">
      {directoryItems
        ? directoryItems.map((doc) => (
            <DocumentSmallListItem
              onPress={onPress}
              key={id.path?.join('/') || id.id}
              metadata={doc.metadata}
              id={doc.id}
              indented={0}
              draftId={doc.draftId}
              isPublished={doc.isPublished}
            />
          ))
        : null}
    </YStack>
  )
}

function MobileMenuOutline({
  onActivateBlock,
  document,
  docId,
  supportDocuments,
}: {
  onActivateBlock: (blockId: string) => void
  document: HMDocument
  docId: UnpackedHypermediaId
  supportDocuments: HMEntityContent[] | undefined
}) {
  const outline = useNodesOutline(document, docId, supportDocuments)

  return (
    <DocumentOutline
      onActivateBlock={onActivateBlock}
      outline={outline}
      id={docId}
      activeBlockId={docId.blockRef}
    />
  )
}

export function SmallSiteHeader({
  originHomeMetadata,
  originHomeId,
  siteHost,
}: {
  originHomeMetadata: HMMetadata
  originHomeId: UnpackedHypermediaId
  siteHost: string
}) {
  return (
    <YStack
      backgroundColor="$backgroundStrong"
      // this data attribute is used by the hypermedia highlight component
      data-docid={originHomeId.id}
      ai="center"
      width="100vw"
    >
      <XStack maxWidth={600} width="100%">
        <XStack paddingHorizontal="$4" paddingVertical="$2">
          <SiteLogo id={originHomeId} metadata={originHomeMetadata} />
        </XStack>
      </XStack>
    </YStack>
  )
}

function HeaderLinkItem({
  id,
  metadata,
  active,
  draftId,
  isPublished,
}: {
  id?: UnpackedHypermediaId
  draftId?: string | null
  metadata: HMMetadata
  active: boolean
  isPublished?: boolean
}) {
  // TODO: change this to use the draft id
  const linkProps = useRouteLink(
    draftId
      ? {
          key: 'draft',
          id: draftId,
          accessory: {key: 'options'},
        }
      : id
      ? {
          key: 'document',
          id,
        }
      : null,
  )
  return (
    <div className={cn('flex items-center gap-1 px-1')} data-docid={id?.id}>
      <span
        className={cn(
          'truncate select-none font-bold px-1 cursor-pointer transition-colors',
          active ? 'text-foreground' : 'text-muted-foreground',
          'hover:text-foreground',
        )}
        {...linkProps}
      >
        {getMetadataName(metadata)}
      </span>
      {draftId ? <DraftBadge /> : null}
    </div>
  )
}

export function MobileMenu({
  renderContent,
  open,
  onClose,
}: {
  renderContent: () => React.JSX.Element
  open: boolean
  onClose: () => void
}) {
  return (
    <div
      className={cn(
        'md:hidden bg-background fixed inset-0 z-[800] transition-transform duration-200',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="h-screen sticky top-0">
        <div className="p-4 flex items-center justify-end">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <Close size={24} />
          </Button>
        </div>
        <div className="p-4 pb-12 flex-1 overflow-scroll mobile-menu">
          {open ? renderContent() : null}
        </div>
      </div>
    </div>
  )
}

function GotoLatestBanner({
  isLatest = true,
  id,
  document,
}: {
  isLatest: boolean
  id: UnpackedHypermediaId
  document: HMDocument
}) {
  const [hideVersionBanner, setHideVersionBanner] = useState(false)

  const tx = useTxString()
  const {formattedDateLong} = useTxUtils()
  const show = useMemo(() => {
    if (hideVersionBanner) return false
    return !isLatest
  }, [isLatest, hideVersionBanner])

  const latestLinkProps = useRouteLink({
    key: 'document',
    id: {
      ...id,
      latest: true,
      version: null,
    },
  })

  return show ? (
    <div
      className={cn(
        'absolute top-12 px-4 left-0 right-0 z-50 w-full flex justify-center pointer-events-none',
      )}
    >
      <div className="flex items-center bg-background gap-4 max-w-xl p-2 rounded-sm shadow-lg border border-border shadow-lg pointer-events-auto">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setHideVersionBanner(true)}
        >
          <X color="var(--color-muted-foreground)" size={20} />
        </Button>
        <p className="text-sm text-muted-foreground">
          {tx('version_from', ({date}) => `Version from ${date}`, {
            date: formattedDateLong(document.updateTime),
          })}
        </p>
        <Button variant="outline" size="sm" {...latestLinkProps}>
          <span className="text-muted-foreground">{tx('Go to Latest')}</span>
          <ArrowRight color="var(--color-muted-foreground)" size={20} />
        </Button>
      </div>
    </div>
  ) : null
}

export function SiteHeaderMenu({
  items,
  docId,
  isCenterLayout = false,
}: {
  items?: DocNavigationDocument[]
  docId: UnpackedHypermediaId | null
  isCenterLayout?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<string, any>>(new Map())
  const [visibleItems, setVisibleItems] = useState<DocNavigationDocument[]>([])
  const [overflowItems, setOverflowItems] = useState<DocNavigationDocument[]>(
    [],
  )
  const [isMeasured, setIsMeasured] = useState(false)

  // Measure the actual width of each element and calculate visibility
  const updateVisibility = useCallback(() => {
    if (!containerRef.current || !items?.length) {
      return
    }

    const container = containerRef.current
    const containerWidth = container.getBoundingClientRect().width

    // Reserve space for dropdown button plus a small buffer for visual comfort
    const reservedWidth = 200 // px
    const availableWidth = containerWidth - reservedWidth

    let currentWidth = 0
    const visible: DocNavigationDocument[] = []
    const overflow: DocNavigationDocument[] = []

    // Create array of items with their measured widths
    const itemWidths: Array<{item: DocNavigationDocument; width: number}> = []

    for (const item of items) {
      const key = item.id?.id || item.draftId || '?'
      const element = itemRefs.current.get(key)

      if (element) {
        const width = element.getBoundingClientRect().width
        itemWidths.push({item, width})
      } else {
        // If we can't measure, use an estimate
        itemWidths.push({item, width: 150})
      }
    }

    // Add items until we run out of space
    // The key change: we check if adding this item would overflow
    // That way, we avoid partially visible items
    for (const {item, width} of itemWidths) {
      // Check if adding this item would overflow
      if (currentWidth + width < availableWidth) {
        visible.push(item)
        currentWidth += width
      } else {
        overflow.push(item)
      }
    }

    // Ensure we show at least one item
    if (visible.length === 0 && items.length > 0) {
      visible.push(items[0])
      overflow.splice(0, 1)
    }

    setVisibleItems(visible)
    setOverflowItems(overflow)
    setIsMeasured(true)
  }, [items])

  // Measure on mount and when items change
  useEffect(() => {
    // Reset measurement state when items change
    setIsMeasured(false)

    // Initial update
    updateVisibility()

    // Second update after render to ensure accurate measurements
    const timer = setTimeout(() => {
      updateVisibility()
    }, 100)

    return () => clearTimeout(timer)
  }, [items, updateVisibility])

  // Setup resize observer
  useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver(() => {
      updateVisibility()
    })

    observer.observe(containerRef.current)
    window.addEventListener('resize', updateVisibility)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateVisibility)
    }
  }, [updateVisibility])

  // Build menu items for dropdown
  const linkDropdownItems: LinkItemType[] = useMemo(() => {
    return overflowItems
      .map((item) => {
        const isActive =
          !!docId?.path &&
          !!item.id?.path &&
          item.id.path?.[0] === docId.path[0]

        const route: NavRoute | null = item.draftId
          ? ({
              key: 'draft',
              id: item.draftId,
            } as const)
          : item.id
          ? ({key: 'document', id: item.id} as const)
          : null
        if (!route) return null
        return {
          key: item.id?.id || item.draftId || '?',
          label: getMetadataName(item.metadata) || 'Untitled',
          icon: () => null,
          route,
          color: isActive
            ? '$color'
            : item.isPublished === false
            ? '$color9'
            : '$color10',
        }
      })
      .filter((item) => !!item)
  }, [overflowItems, docId])

  if (!items?.length) return null

  return (
    <div
      ref={containerRef}
      className={cn(
        'hidden flex-1 items-center gap-5 w-full p-0 overflow-hidden',
        'md:flex md:p-2',
        isCenterLayout ? 'justify-center' : 'justify-end',
      )}
    >
      {/* Hidden measurement container */}
      <div className="absolute pointer-events-none opacity-0 flex items-center gap-5">
        {items.map((item) => {
          const key = item.id?.id || item.draftId || '?'
          return (
            <div
              key={`measure-${key}`}
              ref={(el) => {
                if (el) {
                  itemRefs.current.set(key, el)
                } else {
                  itemRefs.current.delete(key)
                }
              }}
            >
              <HeaderLinkItem
                id={item.id}
                metadata={item.metadata}
                draftId={item.draftId}
                isPublished={item.isPublished}
                active={
                  !!docId?.path &&
                  !!item.id?.path &&
                  item.id.path?.[0] === docId.path[0]
                }
              />
            </div>
          )
        })}
      </div>

      {/* Visible items */}
      {visibleItems.map((item) => {
        const key = item.id?.id || item.draftId || '?'
        return (
          <HeaderLinkItem
            key={key}
            id={item.id}
            metadata={item.metadata}
            draftId={item.draftId}
            isPublished={item.isPublished}
            active={
              !!docId?.path &&
              !!item.id?.path &&
              item.id.path?.[0] === docId.path[0]
            }
          />
        )
      })}

      {overflowItems.length > 0 && (
        <Tooltip content="More Menu items">
          <LinkDropdown items={linkDropdownItems} />
        </Tooltip>
      )}
    </div>
  )
}

function HypermediaHostBanner({origin}: {origin?: string}) {
  return (
    <div className="w-full bg-(--brand5) p-1">
      <p className="text-sm flex gap-1 flex-wrap text-white items-center justify-center">
        <span>Hosted on</span>
        <a href="/" className="underline">
          {hostnameStripProtocol(origin)}
        </a>
        <span>via the</span>
        <a href="https://hyper.media" target="_blank" className="underline">
          Hypermedia Protocol
        </a>
      </p>
    </div>
  )
}

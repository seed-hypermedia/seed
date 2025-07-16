import {
  getMetadataName,
  HMDocument,
  HMEntityContent,
  HMMetadata,
  HMQueryResult,
  hostnameStripProtocol,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useTxString, useTxUtils} from '@shm/shared/translation'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button} from './button'
import {ScrollArea} from './components/scroll-area'
import {DraftBadge} from './draft-badge'
import {ArrowRight, Close, Menu, X} from './icons'
import {LinkDropdown} from './link-dropdown'

import {
  DocNavigationItem,
  DocumentOutline,
  DocumentSmallListItem,
  getSiteNavDirectory,
  useNodesOutline,
} from './navigation'
import {HeaderSearch, MobileSearch} from './search'
import {SiteLogo} from './site-logo'
import {Tooltip} from './tooltip'
import {cn} from './utils'

export function SiteHeader({
  originHomeId,
  docId,
  items,
  isCenterLayout = false,
  document,
  supportDocuments,
  onBlockFocus,
  onShowMobileMenu,
  supportQueries,
  origin,
  isLatest = true,
  editNavPane,
}: {
  originHomeId: UnpackedHypermediaId | null
  docId: UnpackedHypermediaId | null
  items?: DocNavigationItem[] | null
  isCenterLayout?: boolean
  document?: HMDocument | undefined
  supportDocuments?: HMEntityContent[]
  onBlockFocus?: (blockId: string) => void
  onShowMobileMenu?: (isOpen: boolean) => void
  supportQueries?: HMQueryResult[]
  origin?: string
  isLatest?: boolean
  editNavPane?: React.ReactNode
}) {
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
        <div className="hidden sm:block">
          <HeaderSearch originHomeId={originHomeId} />
        </div>
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
          'border-border dark:bg-background flex w-full border-b bg-white p-4',
          {
            'flex-col': isCenterLayout,
            'flex-row items-center': !isCenterLayout,
          },
        )}
        // this data attribute is used by the hypermedia highlight component
        data-docid={headerHomeId.id}
      >
        <div
          className={cn('flex shrink-0 items-center self-stretch', {
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
          className={cn('flex-1 overflow-hidden px-2', {
            flex: !isCenterLayout,
          })}
        >
          <SiteHeaderMenu
            items={items}
            docId={docId}
            isCenterLayout={isCenterLayout}
            editNavPane={editNavPane}
          />
        </div>

        {isCenterLayout ? null : headerSearch}
        <MobileMenu
          open={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
          renderContent={() => (
            <>
              <MobileSearch
                originHomeId={originHomeId}
                onSelect={() => {
                  setIsMobileMenuOpen(false)
                }}
              />
              {isHomeDoc ? null : ( // if we are on the home page, we will see the home directory below the outline
                <div className="mt-2.5 mb-4 flex flex-col gap-2.5">
                  {items?.map((item) => (
                    <DocumentSmallListItem
                      onPress={() => {
                        setIsMobileMenuOpen(false)
                      }}
                      key={item.id?.id || ''}
                      id={item.id}
                      metadata={item.metadata}
                      draftId={item.draftId}
                      isPublished={item.isPublished}
                    />
                  ))}
                </div>
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
                    setIsMobileMenuOpen(false)
                  }}
                />
              )}
            </>
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
    <div className="flex flex-col gap-2.5">
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
    </div>
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
    <div
      className="flex w-screen flex-col items-center bg-white dark:bg-black"
      // this data attribute is used by the hypermedia highlight component
      data-docid={originHomeId.id}
    >
      <div className="flex w-full max-w-lg">
        <div className="px-4 py-2">
          <SiteLogo id={originHomeId} metadata={originHomeMetadata} />
        </div>
      </div>
    </div>
  )
}

function HeaderLinkItem({
  id,
  metadata,
  active,
  draftId,
  webUrl,
}: {
  id?: UnpackedHypermediaId
  draftId?: string | null
  metadata: HMMetadata
  active: boolean
  webUrl?: string | undefined
}) {
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
      : webUrl || null,
    {handler: 'onClick'},
  )
  return (
    <div className={cn('flex items-center gap-1 px-1')} data-docid={id?.id}>
      <a
        className={cn(
          'cursor-pointer truncate px-1 font-bold transition-colors select-none',
          active ? 'text-foreground' : 'text-muted-foreground',
          'hover:text-foreground',
        )}
        {...linkProps}
      >
        {getMetadataName(metadata)}
      </a>
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
        'bg-background fixed inset-0 z-[800] h-screen transition-transform duration-200 md:hidden',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="sticky top-0 flex h-screen flex-col">
        <div className="flex flex-0 items-center justify-end p-4">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <Close size={24} />
          </Button>
        </div>
        <ScrollArea className="mobile-menu h-3/4">
          {open ? renderContent() : null}
          <div className="h-20"></div>
        </ScrollArea>
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

  const latestLinkProps = useRouteLink(
    {
      key: 'document',
      id: {
        ...id,
        latest: true,
        version: null,
      },
    },
    {
      handler: 'onClick',
    },
  )

  return show ? (
    <div
      className={cn(
        'pointer-events-none absolute top-12 right-0 left-0 z-[999] flex w-full justify-center px-4',
      )}
    >
      <div className="bg-background border-border pointer-events-auto flex max-w-xl items-center gap-4 rounded-sm border p-2 shadow-lg">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setHideVersionBanner(true)}
        >
          <X color="var(--color-muted-foreground)" size={20} />
        </Button>
        <p className="text-muted-foreground text-sm">
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
  editNavPane,
}: {
  items?: DocNavigationItem[] | null
  docId: UnpackedHypermediaId | null
  isCenterLayout?: boolean
  editNavPane?: React.ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<string, any>>(new Map())
  const editNavPaneRef = useRef<HTMLDivElement>(null)
  const [visibleItems, setVisibleItems] = useState<DocNavigationItem[]>([])
  const [overflowItems, setOverflowItems] = useState<DocNavigationItem[]>([])

  // Measure the actual width of each element and calculate visibility
  const updateVisibility = useCallback(() => {
    if (!containerRef.current || !items?.length) {
      setVisibleItems([])
      setOverflowItems([])
      return
    }

    const container = containerRef.current
    const containerWidth = container.getBoundingClientRect().width

    // Get editNavPane width if it exists
    const editNavPaneWidth =
      editNavPaneRef.current?.getBoundingClientRect().width || 0

    // Reserve space for dropdown button plus editNavPane plus a small buffer
    const reservedWidth =
      editNavPaneWidth +
      8 + // padding-2 size
      32 + // width of expand button (more realistic)
      20 // gap to expand button
    const availableWidth = containerWidth - reservedWidth

    console.log('SiteHeaderMenu measurements:', {
      containerWidth,
      availableWidth,
      itemsLength: items.length,
      editNavPaneWidth,
    })

    const visible: DocNavigationItem[] = []
    const overflow: DocNavigationItem[] = []

    // Create array of items with their measured widths and active status
    const itemWidths: Array<{
      item: DocNavigationItem
      width: number
      isActive: boolean
    }> = []

    for (const item of items) {
      const key = item.key
      const element = itemRefs.current.get(key)

      // Determine if this item is active using the same logic as in render
      const isActive =
        !!item.id &&
        !!docId &&
        item.id.uid === docId.uid &&
        !!docId?.path &&
        !!item.id?.path &&
        docId.path.join('/').startsWith(item.id.path.join('/'))

      if (element) {
        const width = element.getBoundingClientRect().width + 20 // add 20 because of the gap-5
        itemWidths.push({item, width, isActive})
        console.log(`Item ${key}: width=${width}, isActive=${isActive}`)
      } else {
        // If we can't measure, use an estimate
        itemWidths.push({item, width: 150, isActive})
        console.log(
          `Item ${key}: using estimated width=150, isActive=${isActive}`,
        )
      }
    }

    // Find the active item and reserve space for it first
    const activeItemData = itemWidths.find(({isActive}) => isActive)
    let remainingWidth = availableWidth

    if (activeItemData) {
      remainingWidth -= activeItemData.width
      console.log(
        `Reserved ${activeItemData.width}px for active item ${activeItemData.item.key}`,
      )
    }

    // Now go through items in original order and add them if they fit
    for (const {item, width, isActive} of itemWidths) {
      if (isActive) {
        // Always include the active item (space already reserved)
        visible.push(item)
        console.log(`Adding active item ${item.key}`)
      } else {
        // For non-active items, only add if there's remaining space
        if (width <= remainingWidth) {
          visible.push(item)
          remainingWidth -= width
          console.log(
            `Adding item ${item.key}, remainingWidth=${remainingWidth}`,
          )
        } else {
          overflow.push(item)
          console.log(`Moving item ${item.key} to overflow`)
        }
      }
    }

    // Ensure we show at least one item (fallback)
    if (visible.length === 0 && items.length > 0) {
      visible.push(items[0])
      const firstOverflowIndex = overflow.findIndex(
        (item) => item.key === items[0].key,
      )
      if (firstOverflowIndex !== -1) {
        overflow.splice(firstOverflowIndex, 1)
      }
    }

    console.log('Final result:', {
      visible: visible.length,
      overflow: overflow.length,
      visibleKeys: visible.map((i) => i.key),
      overflowKeys: overflow.map((i) => i.key),
    })

    setVisibleItems(visible)
    setOverflowItems(overflow)
  }, [items, editNavPane, docId])

  // Measure on mount and when items change
  useEffect(() => {
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

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative hidden w-full flex-1 items-center gap-5 overflow-hidden p-0',
        'md:flex md:p-2',
        isCenterLayout ? 'justify-center' : 'justify-end',
      )}
    >
      {editNavPane && <div ref={editNavPaneRef}>{editNavPane}</div>}
      {/* Hidden measurement container */}
      <div className="pointer-events-none absolute top-0 left-0 flex items-center gap-5 p-0 opacity-0 md:flex md:p-2">
        {items?.map((item) => {
          return (
            <div
              key={`measure-${item.key}`}
              ref={(el) => {
                if (el) {
                  itemRefs.current.set(item.key, el)
                } else {
                  itemRefs.current.delete(item.key)
                }
              }}
            >
              <HeaderLinkItem
                id={item.id}
                metadata={item.metadata}
                draftId={item.draftId}
                active={true}
              />
            </div>
          )
        })}
      </div>

      {/* Visible items */}
      {visibleItems.map((item) => {
        return (
          <HeaderLinkItem
            key={item.key}
            id={item.id}
            metadata={item.metadata}
            draftId={item.draftId}
            webUrl={item.webUrl}
            active={
              !!item.id &&
              !!docId &&
              item.id.uid === docId.uid &&
              !!docId?.path &&
              !!item.id?.path &&
              docId.path.join('/').startsWith(item.id.path.join('/'))
            }
          />
        )
      })}

      {overflowItems.length > 0 && (
        <Tooltip content="More Menu items">
          <LinkDropdown items={overflowItems} />
        </Tooltip>
      )}
    </div>
  )
}

function HypermediaHostBanner({origin}: {origin?: string}) {
  return (
    <div className="w-full bg-(--brand5) p-1">
      <p className="flex flex-wrap items-center justify-center gap-1 text-sm text-white">
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

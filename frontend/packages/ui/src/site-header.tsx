import {
  getMetadataName,
  HMDocument,
  HMEntityContent,
  HMMetadata,
  hostnameStripProtocol,
  SearchResult,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useTxString, useTxUtils} from '@shm/shared/translation'
import React, {useCallback, useMemo, useRef, useState} from 'react'
import {Button} from './button'
import {ScrollArea} from './components/scroll-area'
import {DraftBadge} from './draft-badge'
import {ArrowRight, ChevronDown, Close, Menu, X} from './icons'
import {useResponsiveItems} from './use-responsive-items'

import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {Sparkle} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/dropdown-menu'
import {
  DocNavigationItem,
  DocumentOutline,
  DocumentSmallListItem,
  useNodesOutline,
} from './navigation'
import {HeaderSearch, MobileSearch} from './search'
import {SiteLogo} from './site-logo'
import {SubscribeDialog} from './subscribe-dialog'
import {Tooltip} from './tooltip'
import useMedia from './use-media'
import {cn} from './utils'

// Stable width estimator functions
const getNavItemWidth = () => 150

export function SiteHeader({
  originHomeId,
  docId,
  items,
  homeNavigationItems,
  directoryItems,
  isCenterLayout = false,
  document,
  supportDocuments,
  onBlockFocus,
  onShowMobileMenu,
  hideSiteBarClassName,
  origin,
  isLatest = true,
  editNavPane,
  handleToggleFeed,
  isMainFeedVisible = false,
  wrapperClassName,
}: {
  originHomeId: UnpackedHypermediaId | null
  docId: UnpackedHypermediaId | null
  items?: DocNavigationItem[] | null
  homeNavigationItems?: DocNavigationItem[]
  directoryItems?: DocNavigationItem[]
  isCenterLayout?: boolean
  document?: HMDocument | undefined
  supportDocuments?: HMEntityContent[]
  onBlockFocus?: (blockId: string) => void
  onShowMobileMenu?: (isOpen: boolean) => void
  hideSiteBarClassName?: AutoHideSiteHeaderClassName
  origin?: string
  isLatest?: boolean
  editNavPane?: React.ReactNode
  handleToggleFeed: () => void
  isMainFeedVisible: boolean
  wrapperClassName?: string
}) {
  const [isMobileMenuOpen, _setIsMobileMenuOpen] = useState(false)
  const [isSubscribeDialogOpen, setIsSubscribeDialogOpen] = useState(false)

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
        <div className="hidden md:block">
          <HeaderSearch originHomeId={originHomeId} />
        </div>
      ) : null}
    </>
  )

  const headerRef = useRef<HTMLDivElement>(null)

  useIsomorphicLayoutEffect(() => {
    const updateHeaderHeight = () => {
      const headerHeight = headerRef.current?.offsetHeight || 60

      window.document.documentElement.style.setProperty(
        '--site-header-h',
        `${headerHeight}px`,
      )
    }

    // Initial measurement
    updateHeaderHeight()

    // Update on resize
    const resizeObserver = new ResizeObserver(updateHeaderHeight)
    if (headerRef.current) {
      resizeObserver.observe(headerRef.current)
    }

    // Cleanup
    return () => {
      resizeObserver.disconnect()
      window.document.documentElement.style.setProperty(
        '--site-header-h',
        '0px',
      )
    }
  }, [headerRef.current])

  const isHomeDoc = docId?.path?.length == 0

  console.log(`== ~ isHomeDoc:`, isHomeDoc)
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
        ref={headerRef}
        className={cn(
          'border-border dark:bg-background z-20 flex w-full transform-gpu border-b bg-white p-4 transition-transform duration-200',
          {
            'flex-col': isCenterLayout,
            'flex-row items-center': !isCenterLayout,
          },
          hideSiteBarClassName,
          'sm:translate-y-0',
          wrapperClassName,
        )}
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
          {isCenterLayout ? (
            <div className="flex items-center gap-2">
              {headerSearch}
              <Button
                variant="brand"
                size="sm"
                className="text-white"
                onClick={() => setIsSubscribeDialogOpen(true)}
              >
                Subscribe
              </Button>
            </div>
          ) : null}
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
            isMainFeedVisible={isMainFeedVisible}
            handleToggleFeed={handleToggleFeed}
          />
        </div>

        <div className="flex items-center gap-2">
          {!isCenterLayout && headerSearch}
          {!isCenterLayout && (
            <Button
              variant="brand"
              size="sm"
              className="text-white"
              onClick={() => setIsSubscribeDialogOpen(true)}
            >
              Subscribe
            </Button>
          )}
        </div>
        <MobileMenu
          open={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
          renderContent={() => (
            <>
              <MobileSearch
                originHomeId={originHomeId}
                // @ts-expect-error
                onSelect={(item: SearchResult) => {
                  setIsMobileMenuOpen(false)
                  console.log('SEARCH RESULT', item) // TODO: navigate to the document with the correct URL based on the site
                }}
              />

              {/* Always show home navigation items */}
              {homeNavigationItems && homeNavigationItems.length > 0 && (
                <div className="mt-2.5 mb-4">
                  <NavItems
                    items={homeNavigationItems}
                    onClick={() => {
                      setIsMobileMenuOpen(false)
                    }}
                  />
                </div>
              )}

              {/* Show directory items when not on home */}
              {directoryItems && directoryItems.length > 0 && (
                <div className="mb-4">
                  <div className="text-muted-foreground mb-2 px-2 text-xs font-medium uppercase">
                    Pages
                  </div>
                  <NavItems
                    items={directoryItems}
                    onClick={() => {
                      setIsMobileMenuOpen(false)
                    }}
                  />
                </div>
              )}

              {/* Show document outline when available */}
              {docId && document && (
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
            </>
          )}
        />

        <SubscribeDialog
          open={isSubscribeDialogOpen}
          onOpenChange={setIsSubscribeDialogOpen}
          accountId={headerHomeId?.uid}
          siteUrl={document?.metadata?.siteUrl || origin}
        />
      </header>
    </>
  )
}

function NavItems({
  items,
  onClick,
}: {
  items?: DocNavigationItem[] | null
  onClick?: () => void
}) {
  return (
    <div className="flex flex-col gap-2.5 px-2">
      {items
        ? items.map((doc) => {
            // Skip items without id or draftId to prevent routing errors
            if (!doc.id && !doc.draftId) return null
            return (
              <DocumentSmallListItem
                onClick={onClick}
                key={doc.id?.id || doc.draftId || ''}
                metadata={doc.metadata}
                id={doc.id}
                indented={0}
                draftId={doc.draftId}
                isPublished={doc.isPublished}
              />
            )
          })
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
}: {
  originHomeMetadata: HMMetadata
  originHomeId: UnpackedHypermediaId
  siteHost: string
}) {
  return (
    <div className="flex w-screen flex-col items-start border-b bg-white px-2 py-4 dark:bg-black">
      <div className="flex w-full justify-start">
        <div className="p-2">
          <SiteLogo id={originHomeId} metadata={originHomeMetadata} />
        </div>
      </div>
    </div>
  )
}

function OverflowMenuItem({
  item,
}: {
  item: {
    key: string
    id?: UnpackedHypermediaId
    draftId?: string | null
    metadata: HMMetadata
    webUrl?: string
  }
}) {
  const linkProps = useRouteLink(
    item.draftId
      ? {key: 'draft', id: item.draftId}
      : item.id
      ? {key: 'document', id: item.id}
      : item.webUrl || '',
    {handler: 'onClick'},
  )
  return (
    <DropdownMenuItem {...linkProps}>{item.metadata.name}</DropdownMenuItem>
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

export function SiteHeaderMenu({
  items,
  docId,
  isCenterLayout = false,
  editNavPane,
  isMainFeedVisible = false,
  handleToggleFeed,
}: {
  items?: DocNavigationItem[] | null
  docId: UnpackedHypermediaId | null
  isCenterLayout?: boolean
  editNavPane?: React.ReactNode
  isMainFeedVisible?: boolean
  handleToggleFeed?: () => void
}) {
  const editNavPaneRef = useRef<HTMLDivElement>(null)

  // Calculate reserved width for the dropdown button and edit pane
  const editNavPaneWidth =
    editNavPaneRef.current?.getBoundingClientRect().width || 0
  const reservedWidth = editNavPaneWidth + 8 + 32 + 20 // padding + button + gap

  // Determine active key based on current docId
  const activeKey = useMemo(() => {
    if (!docId || !items?.length) return undefined

    const activeItem = items.find(
      (item) =>
        !!item.id &&
        item.id.uid === docId.uid &&
        !!docId?.path &&
        !!item.id?.path &&
        docId.path.join('/').startsWith(item.id.path.join('/')),
    )

    return activeItem?.key
  }, [docId, items])

  const {containerRef, itemRefs, visibleItems, overflowItems} =
    useResponsiveItems({
      items: items || [],
      activeKey,
      getItemWidth: getNavItemWidth,
      reservedWidth,
      gapWidth: 20,
    })

  let feedLinkButton = handleToggleFeed ? (
    <a
      className={cn(
        'flex cursor-pointer items-center gap-2 truncate px-1 font-bold transition-colors select-none',
        isMainFeedVisible ? 'text-foreground' : 'text-muted-foreground',
        'hover:text-foreground',
      )}
      onClick={handleToggleFeed}
    >
      <Sparkle
        className={cn(
          'size-4 flex-none shrink-0',
          isMainFeedVisible
            ? 'text-foreground text-bold'
            : 'text-muted-foreground',
        )}
      />
      <span
        className={cn(
          'hidden md:block',
          isMainFeedVisible
            ? 'text-foreground text-bold'
            : 'text-muted-foreground',
        )}
      >
        Feed
      </span>
    </a>
  ) : null

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
        {/* {feedLinkButton} */}
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

      {feedLinkButton}

      {/* Overflow dropdown */}
      {overflowItems.length > 0 && (
        <Tooltip content="More Menu items">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button size="sm" variant="ghost" className="rounded-full">
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="max-h-[300px] w-50 overflow-y-scroll"
              side="bottom"
              align="end"
            >
              {overflowItems.map((item) => (
                <OverflowMenuItem key={item.key} item={item} />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Tooltip>
      )}
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
        'bg-background fixed inset-0 z-50 h-screen transition-transform duration-200 md:hidden',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <div className="sticky top-0 flex h-screen flex-col">
        <div className="flex flex-0 items-center justify-end p-4">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <Close className="size-4" />
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
        'pointer-events-none absolute top-[calc(var(--site-header-h)+12px)] right-0 left-0 z-50 flex w-full justify-center px-4',
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
          {tx(
            'version_from',
            ({date}: {date: string}) => `Version from ${date}`,
            {
              date: formattedDateLong(document.updateTime),
            },
          )}
        </p>
        <Button variant="outline" size="sm" {...latestLinkProps}>
          <span className="text-muted-foreground">{tx('Go to Latest')}</span>
          <ArrowRight color="var(--color-muted-foreground)" size={20} />
        </Button>
      </div>
    </div>
  ) : null
}

function HypermediaHostBanner({origin}: {origin?: string}) {
  return (
    <div className="bg-primary w-full p-1">
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

export type AutoHideSiteHeaderClassName = 'translate-y-0' | '-translate-y-full'

export function useAutoHideSiteHeader() {
  const media = useMedia()
  const prevScrollPos = useRef(0)
  const [className, setClassName] =
    useState<AutoHideSiteHeaderClassName>('translate-y-0')

  const onScroll = useCallback(
    (e: any) => {
      if (media.gtSm) return
      if (!e.currentTarget) return

      const currentScrollPos = e.currentTarget.scrollTop
      const threshold = 10 // Add threshold to prevent flickering on small movements

      // Only update if scroll difference is significant
      if (Math.abs(currentScrollPos - prevScrollPos.current) < threshold) {
        return
      }

      if (currentScrollPos > prevScrollPos.current && currentScrollPos > 50) {
        setClassName('-translate-y-full')
      } else {
        setClassName('translate-y-0')
      }

      prevScrollPos.current = currentScrollPos
    },
    [media.gtSm],
  )

  return {
    hideSiteBarClassName: className,
    onScroll,
  }
}

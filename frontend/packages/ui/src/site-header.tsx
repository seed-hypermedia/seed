import {
  getMetadataName,
  HMDocument,
  HMMetadata,
  HMResourceFetchResult,
  HMResourceVisibility,
  NavRoute,
  SearchResult,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useTxString, useTxUtils} from '@shm/shared/translation'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import {Button} from './button'
import {ScrollArea} from './components/scroll-area'
import {DraftBadge} from './draft-badge'
import {ArrowRight, ChevronDown, Close, Menu, X} from './icons'
import {useResponsiveItems} from './use-responsive-items'

import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {HistoryIcon, Lock} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/dropdown-menu'
import {useHighlighter} from './highlight-context'
import {
  DocNavigationItem,
  DocumentOutline,
  DocumentSmallListItem,
  useNodesOutline,
} from './navigation'
import {HeaderSearch, MobileSearch} from './search'
import {Separator} from './separator'
import {SiteLogo} from './site-logo'
import {SubscribeDialog} from './subscribe-dialog'
import {Tooltip} from './tooltip'
import useMedia from './use-media'
import {cn} from './utils'

// Stable width estimator functions
const getNavItemWidth = () => 150

export function SiteHeader({
  siteHomeId,
  docId,
  items,
  homeNavigationItems,
  directoryItems,
  isCenterLayout = false,
  document,
  draftMetadata,
  siteHomeDocument,
  embeds,
  onBlockFocus,
  onShowMobileMenu,
  hideSiteBarClassName,
  isLatest = true,
  editNavPane,
  isMainFeedVisible = false,
  wrapperClassName,
  notifyServiceHost,
  routeType,
}: {
  siteHomeId: UnpackedHypermediaId
  docId: UnpackedHypermediaId | null
  items?: DocNavigationItem[] | null
  homeNavigationItems?: DocNavigationItem[]
  directoryItems?: DocNavigationItem[]
  isCenterLayout?: boolean
  document?: HMDocument | undefined
  draftMetadata?: HMMetadata
  siteHomeDocument?: HMDocument | null
  embeds?: HMResourceFetchResult[]
  onBlockFocus?: (blockId: string) => void
  onShowMobileMenu?: (isOpen: boolean) => void
  hideSiteBarClassName?: AutoHideSiteHeaderClassName
  isLatest?: boolean
  editNavPane?: React.ReactNode
  isMainFeedVisible: boolean
  wrapperClassName?: string
  notifyServiceHost?: string
  routeType?: NavRoute['key']
}) {
  const [isMobileMenuOpen, _setIsMobileMenuOpen] = useState(false)
  const [isSubscribeDialogOpen, setIsSubscribeDialogOpen] = useState(false)

  function setIsMobileMenuOpen(isOpen: boolean) {
    _setIsMobileMenuOpen(isOpen)
    onShowMobileMenu?.(isOpen)
  }
  // Determine the home document for logo/branding
  // Priority: current doc if on home page, otherwise siteHomeDocument
  const homeDoc =
    docId && !docId.path?.length
      ? {document, id: docId} // On home page with actual docId
      : siteHomeDocument
      ? {document: siteHomeDocument, id: siteHomeId} // Non-home page or utility page
      : document
      ? {document, id: siteHomeId} // Fallback if document provided without docId
      : undefined
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
      {siteHomeId ? (
        <div className="hidden md:block">
          <HeaderSearch siteHomeId={siteHomeId} />
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

  if (!homeDoc) return null
  const headerHomeId = homeDoc.id
  if (!headerHomeId) return null
  return (
    <>
      {docId && document ? (
        <GotoLatestBanner isLatest={isLatest} id={docId} document={document} />
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
          className={cn('flex min-w-0 items-center self-stretch sm:shrink-0', {
            'justify-center md:relative': isCenterLayout,
            'flex-start': !isCenterLayout,
          })}
        >
          <div className="flex flex-1 justify-center overflow-hidden">
            <SiteLogo
              id={headerHomeId}
              metadata={draftMetadata || homeDoc.document?.metadata}
            />
          </div>
          {routeType != 'draft' && isCenterLayout ? (
            <div className="flex items-center gap-2 md:absolute md:right-0">
              {headerSearch}
              {notifyServiceHost && (
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
            siteHomeId={siteHomeId}
          />
        </div>

        <div className="flex items-center gap-2">
          {!isCenterLayout && headerSearch}
          {routeType != 'draft' && !isCenterLayout && (
            <Button
              variant="brand"
              size="sm"
              className="plausible-event-name=click-subscribe-button text-white"
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
                siteHomeId={siteHomeId}
                // @ts-expect-error
                onSelect={(item: SearchResult) => {
                  setIsMobileMenuOpen(false)
                  // Navigation not yet implemented for mobile search results
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
                <>
                  <Separator />
                  <div className="mb-4">
                    <NavItems
                      items={directoryItems}
                      onClick={() => {
                        setIsMobileMenuOpen(false)
                      }}
                    />
                  </div>
                </>
              )}

              {/* Show document outline when available */}
              {docId && document && (
                <>
                  <Separator />
                  <MobileMenuOutline
                    onActivateBlock={(blockId) => {
                      setIsMobileMenuOpen(false)
                      onBlockFocus?.(blockId)
                    }}
                    document={document}
                    docId={docId}
                    embeds={embeds}
                  />
                </>
              )}
            </>
          )}
        />

        <SubscribeDialog
          open={isSubscribeDialogOpen}
          onOpenChange={setIsSubscribeDialogOpen}
          accountId={headerHomeId?.uid}
          accountMeta={draftMetadata || homeDoc.document?.metadata}
          notifyServiceHost={notifyServiceHost}
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
                visibility={doc.visibility}
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
  embeds,
}: {
  onActivateBlock: (blockId: string) => void
  document: HMDocument
  docId: UnpackedHypermediaId
  embeds?: HMResourceFetchResult[]
}) {
  const outline = useNodesOutline(document, docId, embeds)

  return (
    <DocumentOutline
      onActivateBlock={onActivateBlock}
      outline={outline}
      id={docId}
      activeBlockId={docId.blockRef}
    />
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
    visibility?: HMResourceVisibility
  }
}) {
  const linkProps = useRouteLink(
    item.draftId
      ? {key: 'draft', id: item.draftId}
      : item.id
      ? {key: 'document', id: {...item.id, latest: true, version: null}}
      : item.webUrl || '',
  )
  return (
    <DropdownMenuItem {...linkProps}>
      <div className="flex w-full items-center justify-between gap-2">
        <span>{getMetadataName(item.metadata)}</span>
        {item.visibility === 'PRIVATE' ? (
          <Lock size={12} className="text-muted-foreground" />
        ) : null}
      </div>
    </DropdownMenuItem>
  )
}

function HeaderLinkItem({
  id,
  metadata,
  active,
  draftId,
  webUrl,
  visibility,
}: {
  id?: UnpackedHypermediaId
  draftId?: string | null
  metadata: HMMetadata
  active: boolean
  webUrl?: string | undefined
  visibility?: HMResourceVisibility
}) {
  const highlighter = useHighlighter()
  const linkProps = useRouteLink(
    draftId
      ? {
          key: 'draft',
          id: draftId,
          // panel: {key: 'options'},
        }
      : id
      ? {
          key: 'document',
          id: {...id, latest: true, version: null},
        }
      : webUrl || null,
  )
  return (
    <div className={cn('flex items-center gap-1 px-1')} {...highlighter(id)}>
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
      {visibility === 'PRIVATE' ? (
        <Lock size={12} className="text-muted-foreground" />
      ) : null}
      {draftId ? <DraftBadge /> : null}
    </div>
  )
}

export function SiteHeaderMenu({
  items,
  docId,
  siteHomeId,
  isCenterLayout = false,
  editNavPane,
  isMainFeedVisible = false,
}: {
  items?: DocNavigationItem[] | null
  docId: UnpackedHypermediaId | null
  siteHomeId: UnpackedHypermediaId
  isCenterLayout?: boolean
  editNavPane?: React.ReactNode
  isMainFeedVisible?: boolean
}) {
  const editNavPaneRef = useRef<HTMLDivElement>(null)
  const feedLinkButtonRef = useRef<HTMLAnchorElement>(null)
  // null = not measured yet (SSR), show text by default
  const [containerWidth, setContainerWidth] = useState<number | null>(null)

  // Calculate reserved width for the dropdown button, edit pane, and feed button
  const editNavPaneWidth =
    editNavPaneRef.current?.getBoundingClientRect().width || 0
  const feedLinkButtonWidth =
    feedLinkButtonRef.current?.getBoundingClientRect().width || 0
  const reservedWidth = editNavPaneWidth + feedLinkButtonWidth + 8 + 32 + 40 // padding + button + gaps

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

  const feedLinkProps = useRouteLink({
    key: 'feed',
    id: {...siteHomeId, latest: true, version: null},
  })

  // Track container width for responsive Feed button
  useIsomorphicLayoutEffect(() => {
    if (!containerRef.current) return

    const updateWidth = () => {
      setContainerWidth(containerRef.current?.offsetWidth || 0)
    }

    updateWidth()

    const resizeObserver = new ResizeObserver(updateWidth)
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [containerRef])

  // Show text by default (SSR) or when container is larger than 500px
  const showFeedText = containerWidth === null || containerWidth > 500

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
                visibility={item.visibility}
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
            visibility={item.visibility}
          />
        )
      })}

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
      <Tooltip content="Site Feed">
        <a
          ref={feedLinkButtonRef}
          className={cn(
            'flex cursor-pointer items-center gap-2 truncate px-1 font-bold transition-colors select-none',
            isMainFeedVisible ? 'text-foreground' : 'text-muted-foreground',
            'hover:text-foreground',
          )}
          onMouseEnter={() => {
            import('./feed').catch(() => {})
          }}
          {...feedLinkProps}
        >
          <HistoryIcon
            className={cn(
              'size-4 flex-none shrink-0',
              isMainFeedVisible
                ? 'text-foreground text-bold'
                : 'text-muted-foreground',
            )}
          />

          {showFeedText && (
            <span
              className={cn(
                isMainFeedVisible
                  ? 'text-foreground text-bold'
                  : 'text-muted-foreground',
              )}
            >
              Feed
            </span>
          )}
        </a>
      </Tooltip>
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

export type AutoHideSiteHeaderClassName = 'translate-y-0' | '-translate-y-full'

export function useAutoHideSiteHeader(
  scrollContainerRef?: React.RefObject<HTMLElement>,
) {
  const media = useMedia()
  const prevScrollPos = useRef(0)
  const [isHidden, setIsHidden] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      let currentScrollPos: number

      // Get scroll position from appropriate source
      if (media.gtSm && scrollContainerRef?.current) {
        // Desktop: use custom scroll container
        currentScrollPos = scrollContainerRef.current.scrollTop
      } else if (!media.gtSm) {
        // Mobile: use window scroll
        currentScrollPos = window.scrollY
      } else {
        // Desktop without container ref - skip
        return
      }

      const threshold = 10 // Prevent flickering on small movements

      // Only update if scroll difference is significant
      if (Math.abs(currentScrollPos - prevScrollPos.current) < threshold) {
        return
      }

      // Hide when scrolling down past 50px, show when scrolling up
      if (currentScrollPos > prevScrollPos.current && currentScrollPos > 50) {
        setIsHidden(true)
      } else {
        setIsHidden(false)
      }

      prevScrollPos.current = currentScrollPos
    }

    // Attach scroll listener to appropriate target
    if (media.gtSm && scrollContainerRef?.current) {
      // Desktop: listen to custom container
      const container = scrollContainerRef.current
      container.addEventListener('scroll', handleScroll, {passive: true})
      return () => {
        container.removeEventListener('scroll', handleScroll)
      }
    } else if (!media.gtSm) {
      // Mobile: listen to window
      window.addEventListener('scroll', handleScroll, {passive: true})
      return () => {
        window.removeEventListener('scroll', handleScroll)
      }
    }
    // Desktop without scroll ref - no cleanup needed
    return undefined
  }, [media.gtSm, scrollContainerRef])

  return {
    hideSiteHeaderClassName: isHidden
      ? '-translate-y-full'
      : ('translate-y-0' as AutoHideSiteHeaderClassName),
    hideMobileBarClassName: isHidden ? 'opacity-40' : '',
    onScroll: () => {}, // Keep for backward compatibility
  }
}

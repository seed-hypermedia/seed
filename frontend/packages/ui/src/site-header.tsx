import {
  getMetadataName,
  HMDocument,
  HMEntityContent,
  HMMetadata,
  HMQueryResult,
  hostnameStripProtocol,
  SearchResult,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useTxString, useTxUtils} from '@shm/shared/translation'
import React, {useLayoutEffect, useMemo, useRef, useState} from 'react'
import {Button} from './button'
import {ScrollArea} from './components/scroll-area'
import {DraftBadge} from './draft-badge'
import {ArrowRight, ChevronDown, Close, Menu, X} from './icons'
import {useResponsiveItems} from './use-responsive-items'

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
import {Tooltip} from './tooltip'
import {cn} from './utils'

// Stable width estimator functions
const getNavItemWidth = () => 150

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
        <div className="hidden md:block">
          <HeaderSearch originHomeId={originHomeId} />
        </div>
      ) : null}
    </>
  )

  const headerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
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
        ref={headerRef}
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
                // @ts-expect-error
                onSelect={(item: SearchResult) => {
                  setIsMobileMenuOpen(false)
                  console.log('SEARCH RESULT', item) // TODO: navigate to the document with the correct URL based on the site
                }}
              />
              {isHomeDoc ? null : ( // if we are on the home page, we will see the home directory below the outline
                <div className="mt-2.5 mb-4 flex flex-col gap-2.5">
                  {items?.map((item) => (
                    <DocumentSmallListItem
                      onClick={() => {
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
                  items={items}
                  onClick={() => {
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
  items,
  onClick,
}: {
  items?: DocNavigationItem[] | null
  onClick?: () => void
}) {
  return (
    <div className="flex flex-col gap-2.5 px-2">
      {items
        ? items.map((doc) => (
            <DocumentSmallListItem
              onClick={onClick}
              key={doc.id?.id || ''}
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
}: {
  originHomeMetadata: HMMetadata
  originHomeId: UnpackedHypermediaId
  siteHost: string
}) {
  return (
    <div
      className="flex w-screen flex-col items-center bg-white p-3 dark:bg-black"
      // this data attribute is used by the hypermedia highlight component
      data-docid={originHomeId.id}
    >
      <div className="flex w-full max-w-2xl justify-center">
        <div className="px-4 py-2">
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
}: {
  items?: DocNavigationItem[] | null
  docId: UnpackedHypermediaId | null
  isCenterLayout?: boolean
  editNavPane?: React.ReactNode
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
        'pointer-events-none absolute top-12 right-0 left-0 z-40 flex w-full justify-center px-4',
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

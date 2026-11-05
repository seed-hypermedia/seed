import {combine} from '@atlaskit/pragmatic-drag-and-drop/combine'
import {draggable, dropTargetForElements, monitorForElements} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import type {HMDocument, HMNavigationItem, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createWebHMUrl, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {ChevronDown, EllipsisVertical, FileText, Link as LinkIcon, Lock, Plus, X, type LucideIcon} from 'lucide-react'
import {nanoid} from 'nanoid'
import {useEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent} from 'react'
import {Button} from './button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from './components/dialog'
import {Input} from './components/input'
import {Label} from './components/label'
import {RadioGroup, RadioGroupItem} from './components/radio-group'
import {useImageUrl} from './get-file-url'
import {HMDocURLInput} from './hm-doc-url-input'
import {HMIcon} from './hm-icon'
import {OptionsDropdown} from './options-dropdown'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from './select-dropdown'
import {SettingsToggle, useReportDirty, type SpaceHomeUpdater} from './space-settings'
import {SizableText} from './text'
import {toast} from './toast'
import {Tooltip} from './tooltip'
import {useResponsiveItems} from './use-responsive-items'
import {cn} from './utils'

// UI values for the header-layout select.
const HEADER_LAYOUTS = [
  {value: 'horizontal', label: 'Horizontal', stored: '' as const},
  {value: 'center', label: 'Center', stored: 'Center' as const},
]

// Order aware equality for nav items.
function navItemsEqual(a: HMNavigationItem[], b: HMNavigationItem[]): boolean {
  if (a.length !== b.length) return false
  return a.every((item, i) => item.id === b[i]?.id && item.text === b[i]?.text && item.link === b[i]?.link)
}

// Published nav block.
function readPublishedNav(document: HMDocument): HMNavigationItem[] {
  return (
    document.detachedBlocks?.navigation?.children
      ?.map((child) => {
        const linkBlock = child.block?.type === 'Link' ? child.block : null
        if (!linkBlock) return null
        return {
          id: linkBlock.id,
          type: 'Link',
          text: linkBlock.text || '',
          link: linkBlock.link ?? '',
        } satisfies HMNavigationItem
      })
      .filter((item): item is HMNavigationItem => item !== null) ?? []
  )
}

/** Preview of the navigation items. */
export function getNavigationPreviewItems(items: HMNavigationItem[]): HMNavigationItem[] {
  return [{id: '__site_home__', type: 'Link', text: 'Home', link: ''}, ...items]
}

/** How many links the top bar holds. */
export const MAX_NAV_LINKS = 6

const CONTENT_WIDTHS = [
  {value: 'S', label: 'Small'},
  {value: 'M', label: 'Medium'},
  {value: 'L', label: 'Large'},
] as const

/** The Navigation tab of Space Settings. */
export function SpaceSettingsNavigation({
  siteId,
  document,
  updateHome,
  onDirtyChange,
}: {
  siteId: UnpackedHypermediaId
  document: HMDocument
  updateHome: SpaceHomeUpdater
  onDirtyChange: (isDirty: boolean) => void
}) {
  const [navItems, setNavItems] = useState<HMNavigationItem[] | null>(null)
  const [headerLayout, setHeaderLayout] = useState<string | null>(null)
  const [contentWidth, setContentWidth] = useState<'S' | 'M' | 'L' | null>(null)
  const [showOutline, setShowOutline] = useState<boolean | null>(null)
  const [dialogItem, setDialogItem] = useState<HMNavigationItem | null>(null)
  const [dialogIsNew, setDialogIsNew] = useState(false)

  const publishedMetadata = document.metadata
  const publishedNav = useMemo(() => readPublishedNav(document), [document])
  const storedLayout = publishedMetadata.theme?.headerLayout ?? ''
  const currentLayout = HEADER_LAYOUTS.find((l) => l.stored === storedLayout)?.value || 'horizontal'
  const currentContentWidth = publishedMetadata.contentWidth ?? 'M'
  const currentShowOutline = publishedMetadata.showOutline !== false
  // Dirty state is derived by comparing edits against the published values.
  // This lets it self clear once the save's refetch lands.
  const isDirty =
    (navItems !== null && !navItemsEqual(navItems, publishedNav)) ||
    (headerLayout !== null && headerLayout !== currentLayout) ||
    (contentWidth !== null && contentWidth !== currentContentWidth) ||
    (showOutline !== null && showOutline !== currentShowOutline)

  useReportDirty(isDirty, onDirtyChange)

  const navValue = navItems ?? publishedNav
  const layoutValue = headerLayout ?? currentLayout
  const contentWidthValue = contentWidth ?? currentContentWidth
  const showOutlineValue = showOutline ?? currentShowOutline
  const canSave = isDirty && !updateHome.isPending
  const atLinkLimit = navValue.length >= MAX_NAV_LINKS

  const setNav = (items: HMNavigationItem[]) => setNavItems(items)

  const openNewDialog = () => {
    setDialogItem({id: nanoid(), type: 'Link', text: '', link: ''})
    setDialogIsNew(true)
  }
  const openEditDialog = (item: HMNavigationItem) => {
    setDialogItem(item)
    setDialogIsNew(false)
  }
  const submitDialog = (item: HMNavigationItem) => {
    if (dialogIsNew) setNav([...navValue, item])
    else setNav(navValue.map((i) => (i.id === item.id ? item : i)))
    setDialogItem(null)
  }
  const removeItem = (id: string) => setNav(navValue.filter((i) => i.id !== id))

  async function handleSave() {
    try {
      const stored = HEADER_LAYOUTS.find((l) => l.value === layoutValue)?.stored ?? ''
      await updateHome.mutateAsync({
        updateMetadata: (current) => ({
          ...current,
          theme: {...current.theme, headerLayout: stored},
          // Width and outline apply to every document in the space once set, so
          // only write them when changed.
          ...(contentWidth !== null ? {contentWidth} : {}),
          ...(showOutline !== null ? {showOutline} : {}),
        }),
        ...(navItems ? {navigation: navItems} : {}),
      })
      toast.success('Navigation updated')
    } catch (error) {
      // Edits stay in place, so retrying sends the same changes again.
      toast.error(error instanceof Error ? error.message : 'Failed to update navigation', {
        action: {label: 'Retry', onClick: () => void handleSave()},
      })
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <SizableText size="2xl" weight="bold">
          Navigation
        </SizableText>
        <Button variant="default" disabled={!canSave} onClick={handleSave}>
          {updateHome.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <SizableText weight="bold">Bar links</SizableText>
        <HeaderPreview
          siteId={siteId}
          name={publishedMetadata.name}
          icon={publishedMetadata.icon}
          logo={publishedMetadata.seedExperimentalLogo}
          items={navValue}
          isCenter={layoutValue === 'center'}
        />
        <NavItemList items={navValue} onReorder={setNav} onEdit={openEditDialog} onRemove={removeItem} />
        <Tooltip asChild content={atLinkLimit ? `The top bar holds up to ${MAX_NAV_LINKS} links` : ''}>
          <div className="w-full max-w-sm">
            <button
              type="button"
              onClick={openNewDialog}
              disabled={atLinkLimit}
              className="border-border text-muted-foreground hover:text-foreground flex w-full items-center gap-2 rounded-md border border-dashed px-4 py-3 transition-colors hover:border-neutral-400 disabled:pointer-events-none disabled:opacity-50 dark:hover:border-neutral-500"
            >
              <Plus className="size-4" />
              Add a link
            </button>
          </div>
        </Tooltip>
      </div>

      <div className="flex flex-col gap-3">
        <SizableText weight="bold">Display</SizableText>
        <div className="grid grid-cols-1 items-end gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-2">
            <SizableText weight="medium">Header layout</SizableText>
            <Select value={layoutValue} onValueChange={setHeaderLayout}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HEADER_LAYOUTS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <SizableText weight="medium">Content Width</SizableText>
            <Select value={contentWidthValue} onValueChange={(value) => setContentWidth(value as 'S' | 'M' | 'L')}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_WIDTHS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SettingsToggle
            id="space-show-outline"
            label="Show outline"
            hint="Shows each document's outline beside its content."
            checked={showOutlineValue}
            onCheckedChange={setShowOutline}
          />
        </div>
      </div>

      {dialogItem ? (
        <NavItemDialog
          item={dialogItem}
          isNew={dialogIsNew}
          homeId={siteId}
          siteUrl={publishedMetadata.siteUrl}
          filterPresets={(candidate) => !navValue.some((i) => i.id !== dialogItem.id && i.link === candidate.link)}
          onSubmit={submitDialog}
          onClose={() => setDialogItem(null)}
        />
      ) : null}
    </>
  )
}

// Preview of the site header, reflecting the selected layout.
function HeaderPreview({
  siteId,
  name,
  icon,
  logo,
  items,
  isCenter,
}: {
  siteId: UnpackedHypermediaId
  name?: string
  icon?: string
  logo?: string
  items: HMNavigationItem[]
  isCenter: boolean
}) {
  const imageUrl = useImageUrl()
  const labelItems = useMemo(
    () =>
      getNavigationPreviewItems(items)
        .filter((i) => i.text.trim())
        .map((i) => ({key: i.id, text: i.text})),
    [items],
  )
  // Overflow items collapse into a caret dropdown instead of wrapping.
  const {containerRef, itemRefs, visibleItems, overflowItems} = useResponsiveItems({
    items: labelItems,
    gapWidth: 16,
    reservedWidth: 36,
  })

  // As in the site header, a logo replaces the icon and name.
  const brand = logo ? (
    <img alt={name || 'Space logo'} src={imageUrl(logo, 'M')} className="h-15 min-w-0 object-contain" />
  ) : (
    <>
      <HMIcon id={siteId} name={name} icon={icon} size={40} className="shrink-0" />
      {name ? <SizableText weight="bold">{name}</SizableText> : null}
    </>
  )

  const navRow =
    labelItems.length === 0 ? (
      <div className={cn('flex items-center', isCenter ? 'justify-center' : 'flex-1 justify-end')}>
        <SizableText color="muted" className="italic">
          No links added yet
        </SizableText>
      </div>
    ) : (
      <div
        ref={containerRef}
        className={cn(
          'relative flex items-center gap-4 overflow-hidden',
          isCenter ? 'w-full justify-center' : 'flex-1 justify-end',
        )}
      >
        {/* Hidden measurement container (measures each item's natural width) */}
        <div className="pointer-events-none absolute top-0 left-0 flex items-center gap-4 opacity-0">
          {labelItems.map((item) => (
            <div
              key={`measure-${item.key}`}
              ref={(el) => {
                if (el) itemRefs.current.set(item.key, el)
                else itemRefs.current.delete(item.key)
              }}
            >
              <SizableText weight="medium" className="whitespace-nowrap">
                {item.text}
              </SizableText>
            </div>
          ))}
        </div>
        {visibleItems.map((item) => (
          <SizableText key={item.key} weight="medium" color="muted" className="shrink-0 whitespace-nowrap">
            {item.text}
          </SizableText>
        ))}
        {overflowItems.length > 0 ? (
          <OptionsDropdown
            side="bottom"
            align="end"
            ariaLabel="More navigation items"
            button={
              <button className="text-muted-foreground hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-full">
                <ChevronDown className="size-4" />
              </button>
            }
            menuItems={overflowItems.map((item) => ({
              key: item.key,
              label: item.text,
              icon: null,
              onClick: () => {},
            }))}
          />
        ) : null}
      </div>
    )

  return (
    <div className="rounded-lg bg-black/5 p-4 dark:bg-black/40">
      {isCenter ? (
        <div className="border-border bg-panel flex flex-col items-center gap-3 rounded-md border p-4">
          <div className="flex items-center gap-2">{brand}</div>
          {navRow}
        </div>
      ) : (
        <div className="border-border bg-panel flex items-center gap-3 rounded-md border p-4">
          {brand}
          {navRow}
        </div>
      )}
    </div>
  )
}

function NavItemList({
  items,
  onReorder,
  onEdit,
  onRemove,
}: {
  items: HMNavigationItem[]
  onReorder: (items: HMNavigationItem[]) => void
  onEdit: (item: HMNavigationItem) => void
  onRemove: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [draggingOverId, setDraggingOverId] = useState<string | null>(null)
  const touchDrag = useRef<{
    id: string
    pointerId: number
    copy: HTMLElement
    startX: number
    startY: number
  } | null>(null)

  function moveItemOnto(fromId: string, toId: string) {
    const from = items.findIndex((i) => i.id === fromId)
    const to = items.findIndex((i) => i.id === toId)
    if (from === -1 || to === -1 || from === to) return
    const next = [...items]
    next.splice(to, 0, ...next.splice(from, 1))
    onReorder(next)
  }

  useEffect(() => {
    return monitorForElements({
      onDrag: ({location}) => setDraggingOverId((location.current.dropTargets[0]?.data.id as string) ?? null),
      onDrop: ({source, location}) => {
        setDraggingOverId(null)
        const over = location.current.dropTargets[0]
        if (over) moveItemOnto(source.data.id as string, over.data.id as string)
      },
    })
  }, [items, onReorder])

  // Drag handlers for touch screens.
  function touchDragHandlers(id: string) {
    const rowAtPointer = (event: PointerEvent<HTMLDivElement>) =>
      document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-nav-item-id]')?.dataset
        .navItemId ?? null
    function stopDragging() {
      touchDrag.current?.copy.remove()
      touchDrag.current = null
      setDraggingOverId(null)
    }
    return {
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        const row = event.currentTarget.closest<HTMLElement>('[data-nav-item-id]')
        // One finger drags at a time; any other finger is ignored until it lifts.
        if (event.pointerType !== 'touch' || !row || touchDrag.current) return
        event.currentTarget.setPointerCapture(event.pointerId)
        const {left, top, width, height} = row.getBoundingClientRect()
        const copy = row.cloneNode(true) as HTMLElement
        copy.className = cn(row.className, 'pointer-events-none fixed z-50 opacity-70 shadow-md')
        copy.setAttribute('aria-hidden', 'true')
        copy.setAttribute('inert', '')
        Object.assign(copy.style, {left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`})
        containerRef.current?.append(copy)
        touchDrag.current = {id, pointerId: event.pointerId, copy, startX: event.clientX, startY: event.clientY}
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const drag = touchDrag.current
        if (drag?.pointerId !== event.pointerId) return
        drag.copy.style.transform = `translate(${event.clientX - drag.startX}px, ${event.clientY - drag.startY}px)`
        setDraggingOverId(rowAtPointer(event))
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        const drag = touchDrag.current
        if (drag?.pointerId !== event.pointerId) return
        stopDragging()
        const toId = rowAtPointer(event)
        if (toId) moveItemOnto(drag.id, toId)
      },
      onPointerCancel: (event: PointerEvent<HTMLDivElement>) => {
        if (touchDrag.current?.pointerId === event.pointerId) stopDragging()
      },
    }
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      <div className="border-border bg-muted/40 flex items-center gap-3 rounded-md border px-3 py-2.5">
        <Lock className="text-muted-foreground size-4" />
        <SizableText className="flex-1">Home</SizableText>
        <SizableText size="sm" color="muted">
          Fixed
        </SizableText>
      </div>
      {items.map((item) => (
        <NavItemRow
          key={item.id}
          item={item}
          isDraggingOver={draggingOverId === item.id}
          onEdit={() => onEdit(item)}
          onRemove={() => onRemove(item.id)}
          touchDrag={touchDragHandlers(item.id)}
        />
      ))}
    </div>
  )
}

function NavItemRow({
  item,
  isDraggingOver,
  onEdit,
  onRemove,
  touchDrag,
}: {
  item: HMNavigationItem
  isDraggingOver: boolean
  onEdit: () => void
  onRemove: () => void
  touchDrag: HTMLAttributes<HTMLDivElement>
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!rowRef.current || !handleRef.current) return
    return combine(
      draggable({element: rowRef.current, dragHandle: handleRef.current, getInitialData: () => ({id: item.id})}),
      dropTargetForElements({element: rowRef.current, getData: () => ({id: item.id})}),
    )
  }, [item.id])

  return (
    <div
      ref={rowRef}
      data-nav-item-id={item.id}
      className={cn(
        'border-border flex items-center gap-3 rounded-md border bg-white px-3 py-2.5 dark:bg-black',
        isDraggingOver && 'ring-primary/60 ring-2',
      )}
    >
      <div
        ref={handleRef}
        className="text-muted-foreground hover:text-foreground cursor-grab touch-none p-1 active:cursor-grabbing"
        style={{userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none'}}
        {...touchDrag}
      >
        <EllipsisVertical className="size-4" />
      </div>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${item.text || 'link'}`}
        className="min-w-0 flex-1 text-left"
      >
        <SizableText className={cn('block truncate', !item.text.trim() && 'text-muted-foreground')}>
          {item.text || 'Untitled link'}
        </SizableText>
      </button>
      <Tooltip content="Remove link">
        <Button variant="ghost" size="icon" aria-label={`Remove ${item.text || 'link'}`} onClick={onRemove}>
          <X className="size-4" />
        </Button>
      </Tooltip>
    </div>
  )
}

type NavLinkKind = 'external' | 'document'

function NavItemDialog({
  item,
  isNew,
  homeId,
  siteUrl,
  filterPresets,
  onSubmit,
  onClose,
}: {
  item: HMNavigationItem
  isNew: boolean
  homeId: UnpackedHypermediaId
  siteUrl?: string
  filterPresets: (candidate: {link: string}) => boolean
  onSubmit: (item: HMNavigationItem) => void
  onClose: () => void
}) {
  const isDocumentLink = !!unpackHmId(item.link)
  const [kind, setKind] = useState<NavLinkKind | null>(item.link ? (isDocumentLink ? 'document' : 'external') : null)
  const [url, setUrl] = useState(isDocumentLink ? '' : item.link)
  const [docLink, setDocLink] = useState(isDocumentLink ? item.link : '')
  const [text, setText] = useState(item.text)
  // The URL error waits until the owner leaves the field, so it doesn't flag a half-typed address.
  const [isUrlTouched, setIsUrlTouched] = useState(false)

  const trimmedUrl = url.trim()
  const externalHref = /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`
  const isUrlValid = URL.canParse(externalHref) && new URL(externalHref).hostname.includes('.')
  const docId = kind === 'document' ? unpackHmId(docLink) : null
  // The address readers see on the space's own domain. Without a domain the address holds the account id, so it
  // stays hidden.
  const docAddress =
    siteUrl && docId?.uid === homeId.uid
      ? createWebHMUrl(docId.uid, {hostname: siteUrl, path: docId.path, originHomeId: homeId}).replace(
          /^https?:\/\//,
          '',
        )
      : null
  const showUrlError = isUrlTouched && !!trimmedUrl && !isUrlValid
  const nextItem: HMNavigationItem = {
    id: item.id,
    type: 'Link',
    text: text.trim(),
    link: kind === 'external' ? externalHref : docLink,
  }
  const isChanged = isNew || nextItem.text !== item.text || nextItem.link !== item.link
  const canAdd = !!nextItem.text && (kind === 'external' ? isUrlValid : !!docId) && isChanged

  // The desktop Edit menu's Select All has no shortcut, so Cmd+A does nothing in a plain input there.
  function selectAllOnCmdA(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'a' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      event.currentTarget.select()
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Visible overflow lets the document search results float past the dialog's edge. */}
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-visible"
        // Focusing the first field would open a phone's keyboard before the owner has chosen a link kind.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement).focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add link to the top bar' : 'Edit link'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 rounded-lg bg-black/5 p-4 dark:bg-black/40">
            <SizableText size="sm">What should this link to?</SizableText>
            <RadioGroup value={kind ?? ''} onValueChange={(value) => setKind(value as NavLinkKind)} className="gap-3">
              <NavLinkKindOption
                value="external"
                icon={LinkIcon}
                label="External URL Link"
                selected={kind === 'external'}
              />
              {kind === 'external' ? (
                <>
                  <Input
                    aria-label="URL"
                    autoFocus
                    value={url}
                    aria-invalid={showUrlError}
                    onChange={(e) => setUrl(e.target.value)}
                    onBlur={() => setIsUrlTouched(true)}
                    onKeyDown={selectAllOnCmdA}
                    placeholder="https://example.com"
                  />
                  {showUrlError ? (
                    <SizableText size="sm" color="destructive">
                      Enter a web address, like example.com
                    </SizableText>
                  ) : null}
                </>
              ) : null}
              <NavLinkKindOption
                value="document"
                icon={FileText}
                label="Existing document"
                selected={kind === 'document'}
              />
              {kind === 'document' ? (
                <HMDocURLInput
                  link={docLink}
                  homeId={homeId}
                  filterPresets={filterPresets}
                  overlayResults
                  onUpdate={(nextLink, title) => {
                    setDocLink(nextLink)
                    // Autofill the name from the selected doc's title if it isn't set.
                    if (title) setText((current) => (current.trim() ? current : title))
                  }}
                />
              ) : null}
            </RadioGroup>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="nav-link-name">Link name (shown in the top bar)</Label>
            <Input
              id="nav-link-name"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={selectAllOnCmdA}
              placeholder="e.g. About, Contact, Blog"
            />
            {docAddress ? (
              <SizableText size="sm" color="muted" className="truncate">
                {docAddress}
              </SizableText>
            ) : null}
          </div>
        </div>
        <DialogFooter className="flex-col items-center gap-3 sm:flex-col">
          <Button variant="default" className="w-full" disabled={!canAdd} onClick={() => onSubmit(nextItem)}>
            {isNew ? 'Add link' : 'Save link'}
          </Button>
          {/* <Button variant="link" onClick={onClose}>
            Manage links
          </Button> */}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// One of the two link kinds, as a card with its radio on the right.
function NavLinkKindOption({
  value,
  icon: Icon,
  label,
  selected,
}: {
  value: NavLinkKind
  icon: LucideIcon
  label: string
  selected: boolean
}) {
  return (
    <label
      className={cn(
        'bg-card flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition-colors',
        selected ? 'border-primary' : 'border-border hover:border-neutral-400 dark:hover:border-neutral-500',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <SizableText weight="bold" className="flex-1">
        {label}
      </SizableText>
      <RadioGroupItem value={value} />
    </label>
  )
}

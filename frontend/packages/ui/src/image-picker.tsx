import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useDebounce} from '@shm/shared/utils/use-debounce'
import {ImageUp, Search, WifiOff} from 'lucide-react'
import {ChangeEvent, DragEvent, ReactNode, useEffect, useMemo, useState, useSyncExternalStore} from 'react'
import {Button} from './button'
import {Popover, PopoverContent, PopoverTrigger} from './components/popover'
import {Spinner} from './spinner'
import {cn} from './utils'

/** A stock photo as returned by the web app's stock photo proxy. */
export type StockPhoto = {
  id: number
  alt: string
  width: number
  height: number
  color: string | null
  photographer: string
  photographerUrl: string
  pageUrl: string
  thumbUrl: string
  downloadUrl: string
}

/** Response body of the stock photo proxy. */
export type StockPhotoSearchResult = {photos: StockPhoto[]}

/** Path of the stock photo proxy route, served by the hyper.media gateway. */
export const STOCK_PHOTOS_PATH = '/hm/api/stock-photos'

/** What the picker produces the image for. Covers search stock photos; icons pick emoji. */
export type ImagePickerKind = 'cover' | 'icon'

type ImagePickerTab = 'photos' | 'emoji' | 'upload'

const SEARCH_DEBOUNCE_MS = 350
const EMOJI_FONT_STACK = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif"
const EMOJI_IMAGE_SIZE = 256

/**
 * Popover for choosing a cover or icon image. Covers can come from a stock
 * photo search or an upload; icons from an emoji or an upload. Whatever the
 * source, the chosen image reaches `onFile` as a File, so callers keep their
 * existing upload path. The popover closes once `onFile` resolves.
 */
export function ImagePickerPopover({
  kind,
  open,
  onOpenChange,
  onFile,
  onRemove,
  align = 'start',
  children,
}: {
  kind: ImagePickerKind
  open: boolean
  onOpenChange: (open: boolean) => void
  onFile: (file: File) => Promise<void> | void
  onRemove?: () => void
  align?: 'start' | 'center' | 'end'
  /** The element the popover is anchored to; it also toggles the popover. */
  children: ReactNode
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-[min(92vw,28rem)] overflow-hidden p-0"
        onClick={(event) => event.stopPropagation()}
      >
        {open ? (
          <ImagePickerPanel
            kind={kind}
            onFile={async (file) => {
              await onFile(file)
              onOpenChange(false)
            }}
            onRemove={
              onRemove
                ? () => {
                    onRemove()
                    onOpenChange(false)
                  }
                : undefined
            }
          />
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function ImagePickerPanel({
  kind,
  onFile,
  onRemove,
}: {
  kind: ImagePickerKind
  onFile: (file: File) => Promise<void>
  onRemove?: () => void
}) {
  const online = useIsOnline()
  const [tab, setTab] = useState<ImagePickerTab>(kind === 'icon' ? 'emoji' : online ? 'photos' : 'upload')
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tabs: {value: ImagePickerTab; label: string}[] =
    kind === 'icon'
      ? [
          {value: 'emoji', label: 'Emoji'},
          {value: 'upload', label: 'Upload'},
        ]
      : [
          {value: 'photos', label: 'Search photos'},
          {value: 'upload', label: 'Upload'},
        ]

  async function deliver(key: string, produceFile: () => Promise<File>) {
    if (pendingKey) return
    setPendingKey(key)
    setError(null)
    try {
      await onFile(await produceFile())
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Failed to set ${kind} image: ${message}`, err)
      setError('Could not add this image. Please try again.')
    } finally {
      setPendingKey(null)
    }
  }

  return (
    <div className="flex flex-col">
      <div className="border-border flex items-center gap-1 border-b px-2 pt-2" role="tablist">
        {tabs.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={tab === option.value}
            onClick={() => setTab(option.value)}
            className={cn(
              'focus-visible:ring-ring/50 -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]',
              tab === option.value
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {option.label}
          </button>
        ))}
        <div className="flex-1" />
        {onRemove ? (
          <Button type="button" variant="ghost" size="xs" className="text-muted-foreground mb-1" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>
      <div className="p-3">
        {tab === 'photos' ? (
          <StockPhotoSearch
            online={online}
            pendingKey={pendingKey}
            onPick={(photo) => deliver(`photo-${photo.id}`, () => downloadStockPhoto(photo))}
          />
        ) : null}
        {tab === 'emoji' ? (
          <EmojiSearch
            disabled={!!pendingKey}
            onPick={(emoji) => deliver(`emoji-${emoji.hexcode}`, async () => renderEmojiToFile(emoji))}
          />
        ) : null}
        {tab === 'upload' ? (
          <UploadDropzone
            kind={kind}
            pending={pendingKey === 'upload'}
            onFile={(file) => deliver('upload', async () => file)}
          />
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive pt-2 text-xs">
            {error}
          </p>
        ) : null}
      </div>
      {tab === 'photos' ? (
        <div className="border-border text-muted-foreground border-t px-3 py-2 text-xs">
          Photos by{' '}
          <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="text-foreground underline">
            Pexels
          </a>
        </div>
      ) : null}
    </div>
  )
}

function StockPhotoSearch({
  online,
  pendingKey,
  onPick,
}: {
  online: boolean
  pendingKey: string | null
  onPick: (photo: StockPhoto) => void
}) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query.trim(), SEARCH_DEBOUNCE_MS)
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{status: 'loading' | 'ready' | 'error'; photos: StockPhoto[]}>({
    status: 'loading',
    photos: [],
  })

  useEffect(() => {
    if (!online) return
    const controller = new AbortController()
    setResult((prev) => ({status: 'loading', photos: prev.photos}))
    fetchStockPhotos(debouncedQuery, controller.signal)
      .then((photos) => setResult({status: 'ready', photos}))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        console.error('Stock photo search failed', err)
        setResult({status: 'error', photos: []})
      })
    return () => controller.abort()
  }, [debouncedQuery, online, attempt])

  if (!online) {
    return (
      <div className="text-muted-foreground flex h-64 flex-col items-center justify-center gap-2 text-center text-sm">
        <WifiOff className="size-5" />
        <p>Photo search needs an internet connection.</p>
        <p className="text-xs">You can still upload an image from your computer.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="relative block">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <input
          type="search"
          autoFocus
          aria-label="Search photos"
          placeholder="Search photos…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="border-border bg-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border pr-3 pl-8 text-sm outline-none focus-visible:ring-[3px]"
        />
      </label>
      <p className="text-muted-foreground text-xs">{debouncedQuery ? `Results for “${debouncedQuery}”` : 'Featured'}</p>
      <div className="h-64 overflow-y-auto">
        {result.status === 'error' ? (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
            <p>Could not load photos.</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </div>
        ) : result.status === 'ready' && result.photos.length === 0 ? (
          <p className="text-muted-foreground flex h-full items-center justify-center text-sm">No photos found.</p>
        ) : (
          <div
            className={cn(
              'grid grid-cols-3 gap-2 transition-opacity',
              result.status === 'loading' && result.photos.length > 0 && 'opacity-60',
            )}
          >
            {result.photos.length === 0
              ? Array.from({length: 9}, (_, index) => (
                  <div key={index} className="bg-muted aspect-[3/2] animate-pulse rounded-md" />
                ))
              : result.photos.map((photo) => {
                  const pending = pendingKey === `photo-${photo.id}`
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      disabled={!!pendingKey}
                      aria-label={photo.alt ? `Use photo: ${photo.alt}` : `Use photo by ${photo.photographer}`}
                      onClick={() => onPick(photo)}
                      className="group/photo focus-visible:ring-ring relative aspect-[3/2] overflow-hidden rounded-md outline-none focus-visible:ring-2 disabled:cursor-default"
                      style={{backgroundColor: photo.color ?? undefined}}
                    >
                      <img
                        src={photo.thumbUrl}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-200 group-hover/photo:scale-105 motion-reduce:transition-none"
                      />
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 pt-3 pb-1 text-left text-[10px] text-white opacity-0 transition-opacity group-hover/photo:opacity-100 group-focus-visible/photo:opacity-100">
                        {photo.photographer}
                      </span>
                      {pending ? (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                          <Spinner />
                        </span>
                      ) : null}
                    </button>
                  )
                })}
          </div>
        )}
      </div>
    </div>
  )
}

function EmojiSearch({disabled, onPick}: {disabled: boolean; onPick: (emoji: EmojiEntry) => void}) {
  const [groups, setGroups] = useState<EmojiGroup[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    loadEmojiGroups()
      .then((loaded) => {
        if (!cancelled) setGroups(loaded)
      })
      .catch((err: unknown) => {
        console.error('Failed to load emoji data', err)
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visibleGroups = useMemo(() => {
    const needle = normalizeSearchText(query.trim())
    if (!groups || !needle) return groups
    return groups
      .map((group) => ({...group, emojis: group.emojis.filter((emoji) => emoji.search.includes(needle))}))
      .filter((group) => group.emojis.length > 0)
  }, [groups, query])

  return (
    <div className="flex flex-col gap-2">
      <label className="relative block">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <input
          type="search"
          autoFocus
          aria-label="Search emoji"
          placeholder="Search emoji…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="border-border bg-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border pr-3 pl-8 text-sm outline-none focus-visible:ring-[3px]"
        />
      </label>
      <div className="flex h-72 flex-col gap-3 overflow-y-auto">
        {loadFailed ? (
          <p className="text-muted-foreground flex h-full items-center justify-center text-sm">Could not load emoji.</p>
        ) : !visibleGroups ? (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : visibleGroups.length === 0 ? (
          <p className="text-muted-foreground flex h-full items-center justify-center text-sm">No emoji found.</p>
        ) : (
          visibleGroups.map((group) => (
            <section key={group.id} className="flex flex-col gap-1">
              <h3 className="text-muted-foreground px-0.5 text-xs font-semibold">{group.label}</h3>
              <div className="grid grid-cols-9 gap-0.5">
                {group.emojis.map((emoji) => (
                  <button
                    key={emoji.hexcode}
                    type="button"
                    disabled={disabled}
                    title={emoji.label}
                    aria-label={emoji.label}
                    onClick={() => onPick(emoji)}
                    className="hover:bg-muted focus-visible:ring-ring/50 flex aspect-square items-center justify-center rounded-md text-2xl outline-none focus-visible:ring-[3px] active:scale-95 disabled:opacity-50"
                    style={{fontFamily: EMOJI_FONT_STACK}}
                  >
                    {emoji.unicode}
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function UploadDropzone({
  kind,
  pending,
  onFile,
}: {
  kind: ImagePickerKind
  pending: boolean
  onFile: (file: File) => void
}) {
  const [dragging, setDragging] = useState(false)

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onFile(file)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) onFile(file)
  }

  return (
    <label
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'border-border text-muted-foreground hover:border-ring hover:bg-muted/50 focus-within:border-ring relative flex h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed text-center text-sm transition-colors',
        dragging && 'border-ring bg-muted/50',
      )}
    >
      {pending ? <Spinner /> : <ImageUp className="size-6" />}
      <span className="text-foreground font-medium">Choose an image from your computer</span>
      <span className="text-xs">{kind === 'icon' ? 'Square images work best' : 'or drag it here'}</span>
      <input
        type="file"
        accept="image/*"
        aria-label={kind === 'icon' ? 'Choose document icon' : 'Choose document cover image'}
        disabled={pending}
        className="sr-only"
        onChange={handleChange}
      />
    </label>
  )
}

/** Fetches featured photos, or search results when `query` is non-empty, from the gateway's stock photo proxy. */
export async function fetchStockPhotos(query: string, signal?: AbortSignal): Promise<StockPhoto[]> {
  const url = new URL(STOCK_PHOTOS_PATH, DEFAULT_GATEWAY_URL)
  if (query) url.searchParams.set('q', query)
  const response = await fetch(url, {signal})
  if (!response.ok) throw new Error(`Stock photo search failed (${response.status})`)
  const body = (await response.json()) as StockPhotoSearchResult
  return body.photos
}

async function downloadStockPhoto(photo: StockPhoto): Promise<File> {
  const response = await fetch(photo.downloadUrl)
  if (!response.ok) throw new Error(`Photo download failed (${response.status})`)
  const blob = await response.blob()
  return new File([blob], `pexels-${photo.id}.jpg`, {type: blob.type || 'image/jpeg'})
}

type EmojiEntry = {hexcode: string; unicode: string; label: string; search: string}
type EmojiGroup = {id: number; label: string; emojis: EmojiEntry[]}
type EmojibaseCompactEmoji = {hexcode: string; unicode: string; label: string; tags?: string[]; group?: number}

const EMOJI_GROUP_LABELS: Record<number, string> = {
  0: 'Smileys & emotion',
  1: 'People & body',
  3: 'Animals & nature',
  4: 'Food & drink',
  5: 'Travel & places',
  6: 'Activities',
  7: 'Objects',
  8: 'Symbols',
  9: 'Flags',
}

let emojiGroupsPromise: Promise<EmojiGroup[]> | null = null

/**
 * Loads the emoji set lazily, so the data only ships to users who open the
 * picker. English and Spanish names are both searchable.
 */
function loadEmojiGroups(): Promise<EmojiGroup[]> {
  emojiGroupsPromise ??= Promise.all([
    import('emojibase-data/en/compact.json'),
    import('emojibase-data/es/compact.json'),
  ])
    .then(([en, es]) => {
      const spanish = new Map((es.default as EmojibaseCompactEmoji[]).map((emoji) => [emoji.hexcode, emoji]))
      const groups = new Map<number, EmojiGroup>()
      for (const emoji of en.default as EmojibaseCompactEmoji[]) {
        if (emoji.group === undefined || !(emoji.group in EMOJI_GROUP_LABELS)) continue
        const translated = spanish.get(emoji.hexcode)
        const group = groups.get(emoji.group) ?? {id: emoji.group, label: EMOJI_GROUP_LABELS[emoji.group]!, emojis: []}
        groups.set(emoji.group, group)
        group.emojis.push({
          hexcode: emoji.hexcode,
          unicode: emoji.unicode,
          label: emoji.label,
          search: normalizeSearchText(
            [emoji.label, ...(emoji.tags ?? []), translated?.label ?? '', ...(translated?.tags ?? [])].join(' '),
          ),
        })
      }
      return Array.from(groups.values()).sort((a, b) => a.id - b.id)
    })
    .catch((err: unknown) => {
      emojiGroupsPromise = null
      throw err
    })
  return emojiGroupsPromise
}

function normalizeSearchText(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Draws an emoji onto a square canvas and returns it as a PNG, so an emoji icon
 * is stored like any uploaded icon and looks the same for every reader.
 */
async function renderEmojiToFile(emoji: EmojiEntry): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = EMOJI_IMAGE_SIZE
  canvas.height = EMOJI_IMAGE_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available')
  context.font = `${EMOJI_IMAGE_SIZE * 0.8}px ${EMOJI_FONT_STACK}`
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  const metrics = context.measureText(emoji.unicode)
  const baseline = (EMOJI_IMAGE_SIZE + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
  context.fillText(emoji.unicode, EMOJI_IMAGE_SIZE / 2, baseline)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not render emoji')
  return new File([blob], `emoji-${emoji.hexcode.toLowerCase()}.png`, {type: 'image/png'})
}

function subscribeToOnlineStatus(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

function useIsOnline() {
  return useSyncExternalStore(
    subscribeToOnlineStatus,
    () => navigator.onLine,
    () => true,
  )
}

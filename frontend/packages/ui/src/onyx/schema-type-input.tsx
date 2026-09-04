// A type reference input. The current type shows by the name of the page that
// defines it (Map, Hypermedia Blob, Character stats…); typing searches every
// document that carries a `schemaDefinition` — the explore document filter
// `has:schemaDefinition` — and picking one sets its hm:// URL. A pasted hm:// or
// ipfs:// URL is taken as is on Enter.
import {parseExploreQuery} from '@shm/shared/explore'
import {useExploreResults} from '@shm/shared/models/explore'
import {useResource} from '@shm/shared/models/entity'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useMemo, useState} from 'react'
import {Input} from '../components/input'
import {Popover, PopoverAnchor, PopoverContent} from '../components/popover'
import {cn} from '../utils'
import {ONYX_SCHEMAS, refToName} from './onyx-engine'
import {ONYX_PAGES} from './onyx-schemas.generated'

const isTypeUrl = (text: string) => /^(hm|ipfs):\/\/\S+$/.test(text.trim())

/** An entry offered before the search results: a URL to set, or a schema to apply as is. */
export type TypeOption = {label: string; hint?: string; url?: string; schema?: Record<string, any>}

const publicName = (url: string) => url.split('/').pop() ?? url

/** The display name of a type URL: its bundled page's name, else the defining document's name, else the URL. */
export function useTypeLabel(url: string): string {
  const slug = url ? refToName(url) : ''
  const bundled = slug && ONYX_SCHEMAS[slug] ? slug : null
  const unpacked = !bundled && url.startsWith('hm://') ? unpackHmId(url) : null
  const resource = useResource(unpacked)
  if (!url) return ''
  if (bundled) return ONYX_PAGES[bundled]?.name ?? bundled
  const doc = resource.data?.type === 'document' ? resource.data.document : undefined
  return doc?.metadata?.name || url
}

export function SchemaTypeInput({
  value,
  onChange,
  onPick,
  options = [],
  label: labelOverride,
  ariaLabel,
  placeholder = 'type',
  className,
}: {
  value: string
  onChange: (url: string) => void
  /** Applies an option that carries a schema (a string format, a type parameter). */
  onPick?: (schema: Record<string, any>) => void
  /** Offered before the search results, filtered by the query. */
  options?: TypeOption[]
  /** What to show for the current value when it is not a URL (⟨T⟩, HM link). */
  label?: string
  ariaLabel: string
  placeholder?: string
  className?: string
}) {
  // `text` is the query while the user types; null shows the current type's name.
  const [text, setText] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const resolvedLabel = useTypeLabel(value)
  const label = labelOverride ?? resolvedLabel
  const query = text ?? ''
  const parsed = useMemo(
    () =>
      parseExploreQuery(
        query.trim() && !isTypeUrl(query) ? `has:schemaDefinition name:"${query.trim()}"` : 'has:schemaDefinition',
      ),
    [query],
  )
  const results = useExploreResults(parsed, {type: 'node'}, {enabled: open, pageSize: 30})
  const commit = (url: string) => {
    onChange(url)
    setText(null)
    setOpen(false)
  }
  const pick = (option: TypeOption) => {
    if (option.schema && onPick) onPick(option.schema)
    else if (option.url) onChange(option.url)
    setText(null)
    setOpen(false)
  }
  const q = query.trim().toLowerCase()
  const shownOptions = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  const optionNames = new Set(options.map((o) => (o.url ? publicName(o.url) : '')))
  const documents = results.documents.filter((r) => r.type === 'document' && !optionNames.has(r.id.path?.at(-1) ?? ''))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          value={text ?? label}
          aria-label={ariaLabel}
          placeholder={placeholder}
          title={value || undefined}
          className={cn('min-w-40 text-sm', text === null && value && 'font-medium', className)}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text && isTypeUrl(text)) {
              e.preventDefault()
              commit(text.trim())
            } else if (e.key === 'Escape') {
              setText(null)
              setOpen(false)
            }
          }}
          onBlur={() => {
            // A pasted URL applies on blur too; anything else was a search, dropped.
            if (text && isTypeUrl(text)) onChange(text.trim())
            setText(null)
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="max-h-72 w-80 overflow-y-auto p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        data-testid="schema-type-results"
      >
        {shownOptions.map((o) => (
          <button
            key={`opt:${o.label}`}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(o)}
            className="hover:bg-muted flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left"
            data-testid="schema-type-option"
          >
            <span className="text-sm">{o.label}</span>
            {o.hint && <span className="text-muted-foreground text-[10px]">{o.hint}</span>}
          </button>
        ))}
        {shownOptions.length > 0 && documents.length > 0 && <div className="border-border my-1 border-t" />}
        {documents.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-xs">
            {results.isLoading
              ? 'Searching…'
              : text && isTypeUrl(text)
                ? 'Press Enter to use this URL'
                : shownOptions.length
                  ? 'Any document that defines a schema can be typed here'
                  : 'No schema documents found'}
          </p>
        ) : (
          documents.map((r) => {
            if (r.type !== 'document') return null
            const name = r.document?.metadata?.name || r.id.path?.at(-1) || r.id.uid
            const where = [r.id.uid.slice(0, 8) + '…', ...(r.id.path ?? [])].join('/')
            return (
              <button
                key={r.id.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(r.id.id)}
                className="hover:bg-muted flex w-full flex-col items-start rounded px-2 py-1 text-left"
              >
                <span className="text-sm">{name}</span>
                <span className="text-muted-foreground font-mono text-[10px]">{where}</span>
              </button>
            )
          })
        )}
      </PopoverContent>
    </Popover>
  )
}

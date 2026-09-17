// A type reference input. The current type shows by the name of the page that
// defines it (Map, Blob, Character Stats…); typing searches every
// document that carries a `schemaDefinition` — the explore document filter
// `has:schemaDefinition` — and picking one sets its hm:// URL. A pasted hm:// or
// ipfs:// URL is taken as is on Enter.
import {parseExploreQuery} from '@shm/shared/explore'
import {useExploreResults} from '@shm/shared/models/explore'
import {useResource} from '@shm/shared/models/entity'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useMemo, useRef, useState} from 'react'
import {Input} from '../components/input'
import {Popover, PopoverAnchor, PopoverContent} from '../components/popover'
import {cn} from '../utils'
import {HM_SCHEMAS, refToName} from './engine'
import {HM_SCHEMA_PAGES} from './schema-registry.generated'

const isTypeUrl = (text: string) => /^(hm|ipfs):\/\/\S+$/.test(text.trim())

/** A literal a user typed: exactly one value a field may hold. */
export type TypedLiteral = {value: string | number | boolean | null; kind: 'text' | 'number' | 'boolean' | 'null'}

/**
 * The literal a typed text stands for, or undefined when it is empty or a URL. `true`, `false` and
 * `null` are those values; a whole number is a number; `"quoted"` text is exactly that text (the way to
 * write a word that is also a type name, or `"true"` as text); anything else is the text as typed.
 */
export function literalFromText(text: string): TypedLiteral | undefined {
  const t = text.trim()
  if (!t || isTypeUrl(t)) return undefined
  if (t === 'true' || t === 'false') return {value: t === 'true', kind: 'boolean'}
  if (t === 'null') return {value: null, kind: 'null'}
  if (/^-?\d+$/.test(t) && Number.isSafeInteger(Number(t))) return {value: Number(t), kind: 'number'}
  const quoted = /^"(.*)"$/.exec(t)
  if (quoted) return {value: quoted[1]!, kind: 'text'}
  return {value: t, kind: 'text'}
}

/** An entry offered before the search results: a URL to set, or a schema to apply as is. */
export type TypeOption = {label: string; hint?: string; url?: string; schema?: Record<string, any>}

const publicName = (url: string) => url.split('/').pop() ?? url

/** The display name of a type URL: its bundled page's name, else the defining document's name, else the URL. */
export function useTypeLabel(url: string): string {
  const slug = url ? refToName(url) : ''
  const bundled = slug && HM_SCHEMAS[slug] ? slug : null
  const unpacked = !bundled && url.startsWith('hm://') ? unpackHmId(url) : null
  const resource = useResource(unpacked)
  if (!url) return ''
  if (bundled) return HM_SCHEMA_PAGES[bundled]?.name ?? bundled
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
  chip,
  literals = false,
}: {
  value: string
  onChange: (url: string) => void
  /** Applies an option that carries a schema (a string format, a type parameter), or a typed literal. */
  onPick?: (schema: any) => void
  /** Offered before the search results, filtered by the query. */
  options?: TypeOption[]
  /** What to show for the current value when it is not a URL (⟨T⟩, HM link). */
  label?: string
  ariaLabel: string
  placeholder?: string
  className?: string
  /** Show the current type as a compact chip sized to its name (the reading view's look); it becomes
   * a search field while typing. Pass the chip's colors in `className`. */
  chip?: boolean
  /** Also accept a literal: typed text, a number, true/false or null becomes a schema that accepts
   * exactly that value (offered first in the list, and what Enter picks unless a type name matches). */
  literals?: boolean
}) {
  // `text` is the query while the user types; null shows the current type's name.
  const [text, setText] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
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
  const literal = literals && onPick ? literalFromText(query) : undefined
  // A type whose name is exactly what was typed wins over the literal of the same word.
  const exactOption = q ? options.find((o) => o.label.toLowerCase() === q) : undefined
  const pickLiteral = (l: TypedLiteral) => {
    onPick!(l.value)
    setText(null)
    setOpen(false)
  }
  const optionNames = new Set(options.map((o) => (o.url ? publicName(o.url) : '')))
  const documents = results.documents.filter((r) => r.type === 'document' && !optionNames.has(r.id.path?.at(-1) ?? ''))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          value={text ?? label}
          aria-label={ariaLabel}
          placeholder={placeholder}
          title={value || undefined}
          className={cn(
            chip
              ? '[field-sizing:content] h-6 w-auto max-w-full min-w-8 cursor-pointer truncate rounded-md border-transparent px-1.5 py-0 font-mono text-xs shadow-none focus-visible:ring-2 md:text-xs'
              : 'min-w-40 text-sm',
            text === null && value && 'font-medium',
            className,
            // While searching, a chip is a plain field again.
            chip && text !== null && 'bg-background text-foreground border-border min-w-40 cursor-text',
          )}
          onFocus={() => setOpen(true)}
          // A click on an already-focused input (e.g. after Escape) reopens the list.
          onPointerDown={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text && isTypeUrl(text)) {
              e.preventDefault()
              commit(text.trim())
            } else if (e.key === 'Enter' && text && exactOption) {
              e.preventDefault()
              pick(exactOption)
            } else if (e.key === 'Enter' && literal) {
              e.preventDefault()
              pickLiteral(literal)
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
        // The input is the anchor, not part of the content: a pointer-down on it
        // must not count as "outside" (that would close the list on every click).
        onInteractOutside={(e) => {
          if (inputRef.current?.contains(e.target as Node)) e.preventDefault()
        }}
        data-testid="schema-type-results"
      >
        {literal ? (
          <>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickLiteral(literal)}
              className="hover:bg-muted flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left"
              data-testid="schema-type-literal"
            >
              <span className="min-w-0 truncate text-sm">
                Exactly <code className="bg-muted rounded px-1 font-mono text-xs">{JSON.stringify(literal.value)}</code>
              </span>
              <span className="text-muted-foreground shrink-0 text-[10px]">{literal.kind} literal</span>
            </button>
            <p className="text-muted-foreground px-2 pb-1 text-[10px] leading-snug">
              A literal accepts only this one value — in a union, one of the choices.
              {exactOption
                ? ` Enter picks the ${exactOption.label} type; quote it ("${query.trim()}") for the text instead.`
                : ' Numbers, true, false and null are typed values; quote a word to keep it as text.'}
            </p>
            {(shownOptions.length > 0 || documents.length > 0) && <div className="border-border my-1 border-t" />}
          </>
        ) : null}
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

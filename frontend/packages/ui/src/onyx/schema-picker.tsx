// Pick a schema for a value: none (free-form), a bundled library schema, or a
// pasted reference (an `ipfs://<cid>` schema blob or an `hm://` type document).
// Controlled on the schema REFERENCE (`hm://…` / `ipfs://…`), or null for none.
import {useMemo, useState} from 'react'
import {Input} from '../components/input'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '../select-dropdown'
import {kindOf, nameToUrl, ONYX_SCHEMAS} from './onyx-engine'

const NONE = ' none'
const CUSTOM = ' custom'

/** Bundled schemas a person would plausibly instantiate: named structs, not meta/instances/unions. */
export function instantiableLibrarySchemas(): {name: string; label: string; ref: string}[] {
  return Object.entries(ONYX_SCHEMAS)
    .filter(([name, s]) => {
      if (name.startsWith('onyx-') || name.startsWith('seed-rpc')) return false
      if (s.$type !== undefined) return false // an instance file, not a schema
      if (s.anyOf) return false
      const kind = s.type ? kindOf(s.type) : s.ref ? 'map' : null
      return kind === 'map' && (s.properties || s.values)
    })
    .map(([name]) => ({
      name,
      ref: nameToUrl(name)!,
      label: name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

const isRef = (v: string) => v.startsWith('hm://') || v.startsWith('ipfs://')

export function SchemaPicker({
  value,
  onChange,
  extraOptions = [],
  noneLabel = 'No schema (free-form data)',
  allowNone = true,
  className,
}: {
  /** The chosen schema reference, or null for none. */
  value: string | null
  onChange: (ref: string | null) => void
  /** Additional choices shown first (e.g. the schema a blob already carries). */
  extraOptions?: {ref: string; label: string}[]
  noneLabel?: string
  allowNone?: boolean
  className?: string
}) {
  const library = useMemo(instantiableLibrarySchemas, [])
  const known = (ref: string | null) =>
    !!ref && (extraOptions.some((o) => o.ref === ref) || library.some((o) => o.ref === ref))
  // A pasted reference keeps the input open; a picked one selects its item.
  const [custom, setCustom] = useState<string>(() => (value && !known(value) ? value : ''))
  const [customOpen, setCustomOpen] = useState(() => !!value && !known(value))
  const selectValue = value === null ? NONE : known(value) ? value : CUSTOM

  return (
    <div className={className ?? 'flex flex-wrap items-center gap-2'}>
      <Select
        value={customOpen ? CUSTOM : selectValue}
        onValueChange={(v) => {
          if (v === NONE) {
            setCustomOpen(false)
            onChange(null)
          } else if (v === CUSTOM) {
            setCustomOpen(true)
            if (custom && isRef(custom)) onChange(custom)
          } else {
            setCustomOpen(false)
            onChange(v)
          }
        }}
      >
        <SelectTrigger className="w-72" aria-label="Object schema">
          <SelectValue placeholder="Choose a schema" />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
          <SelectItem value={CUSTOM}>Paste a schema reference…</SelectItem>
          {extraOptions.map((o) => (
            <SelectItem key={o.ref} value={o.ref}>
              {o.label}
            </SelectItem>
          ))}
          {library.map((o) => (
            <SelectItem key={o.ref} value={o.ref}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {customOpen && (
        <Input
          value={custom}
          onChange={(e) => {
            const next = e.target.value
            setCustom(next)
            onChange(isRef(next.trim()) ? next.trim() : null)
          }}
          placeholder="hm://…/type-document or ipfs://<schema cid>"
          aria-label="Schema reference"
          className="w-80 font-mono text-xs"
        />
      )}
    </div>
  )
}

/** A short, human label for a schema reference — the ref itself (schemas carry no names). */
export function schemaRefLabel(ref: string): string {
  return ref
}

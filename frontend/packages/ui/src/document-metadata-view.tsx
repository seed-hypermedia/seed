import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {Braces, Check, ChevronDown, ChevronUp, Plus, X} from 'lucide-react'
import {useEffect, useMemo, useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {Switch} from './components/switch'
import {Textarea} from './components/textarea'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from './select-dropdown'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/**
 * A staged partial update: top-level keys map to their new value, or `null`
 * to remove the field (publishes a nullValue attribute op).
 */
export type MetadataPatch = Record<string, unknown>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const utf8 = new TextEncoder()

/**
 * Canonical map key order per the IPLD DAG-CBOR spec: shorter UTF-8 keys sort
 * first; equal-length keys compare bytewise.
 */
export function dagCborKeyCompare(a: string, b: string): number {
  const aBytes = utf8.encode(a)
  const bBytes = utf8.encode(b)
  if (aBytes.length !== bBytes.length) return aBytes.length - bBytes.length
  for (let i = 0; i < aBytes.length; i++) {
    if (aBytes[i] !== bBytes[i]) return aBytes[i]! - bBytes[i]!
  }
  return 0
}

/** Entries of an object in canonical DAG-CBOR key order, hiding null/undefined (deleted) values. */
function canonicalVisibleEntries(value: Record<string, unknown>): [string, unknown][] {
  return Object.entries(value)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => dagCborKeyCompare(a, b))
}

/** Rebuild a value with all nested object keys in canonical order (for JSON display). */
function toCanonicalOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toCanonicalOrder)
  if (isPlainObject(value)) {
    return Object.fromEntries(canonicalVisibleEntries(value).map(([k, v]) => [k, toCanonicalOrder(v)]))
  }
  return value
}

/**
 * Values must survive the publish pipeline: strings, whole numbers, booleans,
 * null, and plain objects of those. Floats would silently drop, and the
 * SetAttribute op has no list value type, so both are rejected upfront.
 */
function findInvalidValue(value: unknown, path: string[] = []): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return null
  if (typeof value === 'number') {
    return Number.isInteger(value) ? null : `"${path.join('.')}" must be a whole number`
  }
  if (Array.isArray(value)) {
    return `"${path.join('.')}" is a list — lists cannot be published in metadata`
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const problem = findInvalidValue(child, [...path, key])
      if (problem) return problem
    }
    return null
  }
  return `"${path.join('.')}" has an unsupported type`
}

/**
 * Publish ops are generated from the draft metadata without a base document,
 * so a nested key that simply disappears emits no op and its old value would
 * survive. Removed nested object keys therefore become explicit `null`
 * tombstones, which publish as nullValue ops and clear the attribute.
 */
function withNestedTombstones(prev: unknown, next: unknown): unknown {
  if (!isPlainObject(prev) || !isPlainObject(next)) return next
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(next)) {
    result[key] = withNestedTombstones(prev[key], value)
  }
  // Keys absent from `next` become (or remain) null tombstones.
  for (const [key, value] of Object.entries(prev)) {
    if (value !== undefined && !(key in next)) result[key] = null
  }
  return result
}

/**
 * Compute the staged patch that turns `prev` into `next` (removed keys → null
 * tombstones). `prev` must be the raw draft metadata including existing null
 * tombstones so they survive unrelated edits.
 */
export function diffMetadata(prev: Record<string, unknown>, next: Record<string, unknown>): MetadataPatch {
  const patch: MetadataPatch = {}
  for (const [key, value] of Object.entries(next)) {
    const merged = withNestedTombstones(prev[key], value)
    if (JSON.stringify(prev[key]) !== JSON.stringify(merged)) patch[key] = merged
  }
  for (const [key, value] of Object.entries(prev)) {
    if (value !== undefined && !(key in next)) patch[key] = null
  }
  return patch
}

const FIELD_LABEL_CLASS = 'text-muted-foreground text-xs font-medium tracking-wide uppercase'
const NESTED_GROUP_CLASS = 'border-border ml-1 flex flex-col gap-2 border-l-2 pl-3'

/**
 * Metadata view for the `:metadata` document route. Read-only without edit
 * permission; with `canEdit` + `onMetadata` it becomes a recursive editor
 * where every change is staged as a draft patch and published via the
 * standard publish flow. A raw JSON mode allows full editing in one place.
 */
export function DocumentMetadataView({
  metadata,
  canEdit = false,
  onMetadata,
}: {
  metadata?: HMMetadata | null
  canEdit?: boolean
  onMetadata?: (patch: MetadataPatch) => void
}) {
  const [jsonMode, setJsonMode] = useState(false)
  const current = useMemo(() => (metadata ?? {}) as Record<string, unknown>, [metadata])
  const entries = canonicalVisibleEntries(current)
  const editable = canEdit && !!onMetadata

  return (
    <div className="flex flex-col gap-4 py-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Metadata</h2>
        <Tooltip content={jsonMode ? 'Edit as fields' : 'Edit as JSON'}>
          <Button
            variant={jsonMode ? 'secondary' : 'ghost'}
            size="icon"
            aria-label={jsonMode ? 'Edit as fields' : 'Edit as JSON'}
            onClick={() => setJsonMode((mode) => !mode)}
          >
            <Braces className="size-4" />
          </Button>
        </Tooltip>
      </div>
      {jsonMode ? (
        <MetadataJsonEditor metadata={current} editable={editable} onMetadata={onMetadata} />
      ) : (
        <>
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">This document has no metadata.</p>
          ) : (
            <dl className="flex flex-col">
              {entries.map(([key, value]) => (
                <div key={key} className="group border-border flex items-start gap-2 border-b py-3 last:border-b-0">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <dt className={FIELD_LABEL_CLASS}>{key}</dt>
                    <dd>
                      {editable ? (
                        <ValueEditor value={value} onValue={(newValue) => onMetadata!({[key]: newValue})} />
                      ) : (
                        <ValueDisplay value={value} />
                      )}
                    </dd>
                  </div>
                  {editable && <RemoveButton label={`Remove ${key}`} onClick={() => onMetadata!({[key]: null})} />}
                </div>
              ))}
            </dl>
          )}
          {editable && (
            <AddFieldForm
              existingKeys={entries.map(([key]) => key)}
              onAdd={(key, value) => onMetadata!({[key]: value})}
            />
          )}
        </>
      )}
    </div>
  )
}

function RemoveButton({label, onClick, className}: {label: string; onClick: () => void; className?: string}) {
  return (
    <Tooltip content={label}>
      <Button
        variant="ghost"
        size="iconSm"
        aria-label={label}
        className={cn(
          'text-muted-foreground hover:text-destructive opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
          className,
        )}
        onClick={onClick}
      >
        <X className="size-4" />
      </Button>
    </Tooltip>
  )
}

/** Read-only recursive rendering of a metadata value. */
function ValueDisplay({value}: {value: unknown}) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-muted-foreground text-sm">Empty list</p>
    return (
      <div className={NESTED_GROUP_CLASS}>
        {value.map((item, index) => (
          <div key={index} className="flex items-baseline gap-2">
            <span className="text-muted-foreground font-mono text-xs">{index + 1}.</span>
            <ValueDisplay value={item} />
          </div>
        ))}
      </div>
    )
  }
  if (isPlainObject(value)) {
    const entries = canonicalVisibleEntries(value)
    if (entries.length === 0) return <p className="text-muted-foreground text-sm">No fields</p>
    return (
      <div className={NESTED_GROUP_CLASS}>
        {entries.map(([key, child]) => (
          <div key={key} className="flex flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>{key}</span>
            <ValueDisplay value={child} />
          </div>
        ))}
      </div>
    )
  }
  if (value === '') return <span className="text-muted-foreground text-sm">(empty)</span>
  return <span className="font-mono text-sm break-words whitespace-pre-wrap">{String(value)}</span>
}

/** Recursive type-aware editor for one metadata value. */
function ValueEditor({value, onValue}: {value: unknown; onValue: (value: unknown) => void}) {
  if (typeof value === 'boolean') {
    return <Switch checked={value} onCheckedChange={(checked) => onValue(checked)} />
  }
  if (typeof value === 'number') {
    return <NumberInput value={value} onValue={onValue} />
  }
  if (typeof value === 'string') {
    return <CommitOnBlurInput key={value} initialValue={value} onCommit={(text) => onValue(text)} />
  }
  if (Array.isArray(value)) {
    return <ListEditor value={value} onValue={onValue} />
  }
  if (isPlainObject(value)) {
    return <ObjectEditor value={value} onValue={onValue} />
  }
  return <span className="text-muted-foreground font-mono text-sm">{String(value)}</span>
}

/**
 * Recursive object editor: one row per (non-tombstoned) key. Removing a key
 * stages a `null` tombstone so the deletion actually publishes; changes bubble
 * up by rebuilding this object and calling `onValue`.
 */
function ObjectEditor({value, onValue}: {value: Record<string, unknown>; onValue: (value: unknown) => void}) {
  const entries = canonicalVisibleEntries(value)
  return (
    <div className={NESTED_GROUP_CLASS}>
      {entries.length === 0 && <p className="text-muted-foreground text-sm">No fields</p>}
      {entries.map(([key, child]) => (
        <div key={key} className="group/child flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>{key}</span>
            <ValueEditor value={child} onValue={(newChild) => onValue({...value, [key]: newChild})} />
          </div>
          <RemoveButton
            label={`Remove ${key}`}
            className="group-focus-within/child:opacity-100 group-hover/child:opacity-100"
            onClick={() => onValue({...value, [key]: null})}
          />
        </div>
      ))}
      <AddFieldForm
        compact
        existingKeys={entries.map(([key]) => key)}
        onAdd={(key, newChild) => onValue({...value, [key]: newChild})}
      />
    </div>
  )
}

/** Recursive list editor: edit, reorder, remove, and append items. */
function ListEditor({value, onValue}: {value: unknown[]; onValue: (value: unknown) => void}) {
  const move = (from: number, to: number) => {
    const next = [...value]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onValue(next)
  }
  return (
    <div className={NESTED_GROUP_CLASS}>
      {value.length === 0 && <p className="text-muted-foreground text-sm">Empty list</p>}
      {value.map((item, index) => (
        <div key={index} className="group/item flex items-start gap-2">
          <span className="text-muted-foreground mt-2 font-mono text-xs">{index + 1}.</span>
          <div className="min-w-0 flex-1">
            <ValueEditor
              value={item}
              onValue={(newItem) => onValue(value.map((v, i) => (i === index ? newItem : v)))}
            />
          </div>
          <div className="flex items-center opacity-0 transition-opacity group-focus-within/item:opacity-100 group-hover/item:opacity-100">
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
            >
              <ChevronUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Move down"
              disabled={index === value.length - 1}
              onClick={() => move(index, index + 1)}
            >
              <ChevronDown className="size-4" />
            </Button>
            <RemoveButton
              label="Remove item"
              className="opacity-100"
              onClick={() => onValue(value.filter((_, i) => i !== index))}
            />
          </div>
        </div>
      ))}
      <AddFieldForm compact itemMode onAdd={(_key, item) => onValue([...value, item])} />
    </div>
  )
}

/** Integer input that stages on blur/Enter, flags non-integers, resets on Escape. */
function NumberInput({value, onValue}: {value: number; onValue: (value: unknown) => void}) {
  const initial = String(value)
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setText(initial)
    setError(null)
  }, [initial])
  return (
    <div className="flex flex-col gap-1">
      <Input
        value={text}
        inputMode="numeric"
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        onBlur={() => {
          if (text === initial) return
          const parsed = Number(text)
          if (text.trim() === '' || !Number.isInteger(parsed)) {
            setError('Enter a whole number')
            return
          }
          onValue(parsed)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setText(initial)
        }}
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

/** Text input that stages its value on blur or Enter, resets on Escape. */
function CommitOnBlurInput({
  initialValue,
  placeholder,
  onCommit,
}: {
  initialValue: string
  placeholder?: string
  onCommit: (text: string) => void
}) {
  const [text, setText] = useState(initialValue)
  return (
    <Input
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== initialValue) onCommit(text)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setText(initialValue)
      }}
    />
  )
}

type NewFieldType = 'text' | 'number' | 'toggle' | 'object' | 'json'

/**
 * Collapsed "+ Add field" affordance that expands into an inline form.
 * `itemMode` drops the key input for appending list items. Object and List
 * create empty containers that are then edited in place.
 */
function AddFieldForm({
  existingKeys = [],
  itemMode = false,
  compact = false,
  onAdd,
}: {
  existingKeys?: string[]
  itemMode?: boolean
  compact?: boolean
  onAdd: (key: string, value: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [type, setType] = useState<NewFieldType>('text')
  const [textValue, setTextValue] = useState('')
  const [toggleValue, setToggleValue] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setOpen(false)
    setKey('')
    setType('text')
    setTextValue('')
    setToggleValue(true)
    setError(null)
  }

  if (!open) {
    return (
      <div>
        <Button
          variant="ghost"
          size="sm"
          className={cn('text-muted-foreground', compact && 'h-6 px-1 text-xs')}
          onClick={() => setOpen(true)}
        >
          <Plus className={compact ? 'size-3' : 'size-4'} />
          {itemMode ? 'Add item' : 'Add field'}
        </Button>
      </div>
    )
  }

  const submit = () => {
    const trimmedKey = key.trim()
    if (!itemMode) {
      if (!trimmedKey) {
        setError('Enter a field name')
        return
      }
      if (existingKeys.includes(trimmedKey)) {
        setError(`"${trimmedKey}" already exists — edit it above`)
        return
      }
    }
    let value: unknown
    if (type === 'text') value = textValue
    else if (type === 'toggle') value = toggleValue
    else if (type === 'object') value = {}
    else if (type === 'number') {
      const parsed = Number(textValue)
      if (!Number.isInteger(parsed) || textValue.trim() === '') {
        setError('Enter a whole number')
        return
      }
      value = parsed
    } else {
      try {
        value = JSON.parse(textValue)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invalid JSON')
        return
      }
      const problem = findInvalidValue(value, [trimmedKey || 'item'])
      if (problem) {
        setError(problem)
        return
      }
    }
    onAdd(trimmedKey, value)
    reset()
  }

  const needsValueInput = type === 'text' || type === 'number'

  return (
    <div className="border-border flex flex-col gap-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        {!itemMode && (
          <Input
            value={key}
            placeholder="Field name"
            className="w-44"
            autoFocus
            onChange={(e) => {
              setKey(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') reset()
            }}
          />
        )}
        <Select value={type} onValueChange={(v) => setType(v as NewFieldType)}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text">Text</SelectItem>
            <SelectItem value="number">Number</SelectItem>
            <SelectItem value="toggle">Toggle</SelectItem>
            <SelectItem value="object">Object</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
          </SelectContent>
        </Select>
        {type === 'toggle' && <Switch checked={toggleValue} onCheckedChange={setToggleValue} />}
        {needsValueInput && (
          <Input
            value={textValue}
            placeholder="Value"
            inputMode={type === 'number' ? 'numeric' : undefined}
            className="min-w-40 flex-1"
            autoFocus={itemMode}
            onChange={(e) => {
              setTextValue(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') reset()
            }}
          />
        )}
        <Button size="sm" onClick={submit}>
          <Check className="size-4" />
          Add
        </Button>
        <Button variant="ghost" size="sm" onClick={reset}>
          Cancel
        </Button>
      </div>
      {type === 'json' && (
        <Textarea
          value={textValue}
          placeholder='{"example": true}'
          rows={4}
          className="font-mono text-sm"
          onChange={(e) => {
            setTextValue(e.target.value)
            setError(null)
          }}
        />
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

/** Whole-metadata JSON editor: full editing in one textarea, applied as a diff. */
function MetadataJsonEditor({
  metadata,
  editable,
  onMetadata,
}: {
  metadata: Record<string, unknown>
  editable: boolean
  onMetadata?: (patch: MetadataPatch) => void
}) {
  const currentVisible = useMemo(
    () => toCanonicalOrder(Object.fromEntries(canonicalVisibleEntries(metadata))) as Record<string, unknown>,
    [metadata],
  )
  const serialized = useMemo(() => JSON.stringify(currentVisible, null, 2), [currentVisible])
  const [text, setText] = useState(serialized)
  useEffect(() => setText(serialized), [serialized])

  const validation = useMemo(() => {
    if (text === serialized) return {dirty: false as const}
    try {
      const parsed: unknown = JSON.parse(text)
      if (!isPlainObject(parsed)) return {dirty: true as const, error: 'Metadata must be a JSON object'}
      const problem = findInvalidValue(parsed)
      if (problem) return {dirty: true as const, error: problem}
      return {dirty: true as const, value: parsed}
    } catch (e) {
      return {dirty: true as const, error: e instanceof Error ? e.message : 'Invalid JSON'}
    }
  }, [text, serialized])

  if (!editable) {
    return <pre className="bg-muted/50 overflow-x-auto rounded-md p-4 font-mono text-sm">{serialized}</pre>
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={text}
        rows={Math.max(8, Math.min(28, text.split('\n').length + 1))}
        spellCheck={false}
        className={cn('font-mono text-sm', validation.dirty && 'error' in validation && 'border-destructive')}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex min-h-8 items-center gap-2">
        {validation.dirty ? (
          'error' in validation ? (
            <p className="text-destructive text-xs">{validation.error}</p>
          ) : (
            <>
              <Button
                size="sm"
                onClick={() => {
                  onMetadata!(diffMetadata(metadata, validation.value!))
                }}
              >
                <Check className="size-4" />
                Apply changes
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setText(serialized)}>
                Reset
              </Button>
            </>
          )
        ) : (
          <p className="text-muted-foreground text-xs">
            Values may be text, whole numbers, true/false, or nested objects.
          </p>
        )}
      </div>
    </div>
  )
}

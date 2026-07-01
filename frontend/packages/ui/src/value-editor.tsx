import {Check, ChevronDown, ChevronUp, Plus, X} from 'lucide-react'
import {useEffect, useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {Switch} from './components/switch'
import {Textarea} from './components/textarea'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from './select-dropdown'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/**
 * Behavior rules for the recursive value editor, so it can serve both the
 * document metadata editor (attribute-publish constraints) and the raw
 * DAG-CBOR blob editor (full CBOR data model).
 */
export type ValueEditorRules = {
  /** Allow list values and the List add-type. */
  lists: boolean
  /** Allow non-integer numbers. */
  floats: boolean
  /**
   * How removing an object key behaves. 'tombstone' sets it to null (metadata
   * publish semantics — a missing key would never clear); 'delete' removes it.
   */
  removeKeys: 'tombstone' | 'delete'
  /** Hide null-valued object entries (metadata treats null as deleted). */
  hideNullEntries: boolean
}

/** Rules for document metadata: what SetAttribute ops can publish. */
export const METADATA_VALUE_RULES: ValueEditorRules = {
  lists: false,
  floats: false,
  removeKeys: 'tombstone',
  hideNullEntries: true,
}

/** Rules for raw DAG-CBOR blobs: the full CBOR data model (as JSON types). */
export const CBOR_VALUE_RULES: ValueEditorRules = {
  lists: true,
  floats: true,
  removeKeys: 'delete',
  hideNullEntries: false,
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
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

/** Entries of an object in canonical DAG-CBOR key order. */
export function canonicalEntries(value: Record<string, unknown>, opts?: {hideNull?: boolean}): [string, unknown][] {
  return Object.entries(value)
    .filter(([, v]) => v !== undefined && (!opts?.hideNull || v !== null))
    .sort(([a], [b]) => dagCborKeyCompare(a, b))
}

/** Rebuild a value with all nested object keys in canonical order (for JSON display). */
export function toCanonicalOrder(value: unknown, opts?: {hideNull?: boolean}): unknown {
  if (Array.isArray(value)) return value.map((item) => toCanonicalOrder(item, opts))
  if (isPlainObject(value)) {
    return Object.fromEntries(canonicalEntries(value, opts).map(([k, v]) => [k, toCanonicalOrder(v, opts)]))
  }
  return value
}

/** Validate a value against the rules. Returns an error message or null. */
export function findInvalidValue(value: unknown, rules: ValueEditorRules, path: string[] = []): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return null
  if (typeof value === 'number') {
    if (rules.floats) return Number.isFinite(value) ? null : `"${path.join('.')}" must be a finite number`
    return Number.isInteger(value) ? null : `"${path.join('.')}" must be a whole number`
  }
  if (Array.isArray(value)) {
    if (!rules.lists) return `"${path.join('.')}" is a list — lists cannot be published in metadata`
    for (let i = 0; i < value.length; i++) {
      const problem = findInvalidValue(value[i], rules, [...path, String(i)])
      if (problem) return problem
    }
    return null
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const problem = findInvalidValue(child, rules, [...path, key])
      if (problem) return problem
    }
    return null
  }
  return `"${path.join('.')}" has an unsupported type`
}

export const FIELD_LABEL_CLASS = 'text-muted-foreground text-xs font-medium tracking-wide uppercase'
const NESTED_GROUP_CLASS = 'border-border ml-1 flex flex-col gap-2 border-l-2 pl-3'

export function RemoveButton({label, onClick, className}: {label: string; onClick: () => void; className?: string}) {
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

/** Read-only recursive rendering of a value. */
export function ValueDisplay({value, rules = CBOR_VALUE_RULES}: {value: unknown; rules?: ValueEditorRules}) {
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-muted-foreground text-sm">Empty list</p>
    return (
      <div className={NESTED_GROUP_CLASS}>
        {value.map((item, index) => (
          <div key={index} className="flex items-baseline gap-2">
            <span className="text-muted-foreground font-mono text-xs">{index + 1}.</span>
            <ValueDisplay value={item} rules={rules} />
          </div>
        ))}
      </div>
    )
  }
  if (isPlainObject(value)) {
    const entries = canonicalEntries(value, {hideNull: rules.hideNullEntries})
    if (entries.length === 0) return <p className="text-muted-foreground text-sm">No fields</p>
    return (
      <div className={NESTED_GROUP_CLASS}>
        {entries.map(([key, child]) => (
          <div key={key} className="flex flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>{key}</span>
            <ValueDisplay value={child} rules={rules} />
          </div>
        ))}
      </div>
    )
  }
  if (value === '') return <span className="text-muted-foreground text-sm">(empty)</span>
  return <span className="font-mono text-sm break-words whitespace-pre-wrap">{String(value)}</span>
}

/** Recursive type-aware editor for one value. */
export function ValueEditor({
  value,
  onValue,
  rules,
}: {
  value: unknown
  onValue: (value: unknown) => void
  rules: ValueEditorRules
}) {
  if (typeof value === 'boolean') {
    return <Switch checked={value} onCheckedChange={(checked) => onValue(checked)} />
  }
  if (typeof value === 'number') {
    return <NumberInput value={value} onValue={onValue} rules={rules} />
  }
  if (typeof value === 'string') {
    return <CommitOnBlurInput key={value} initialValue={value} onCommit={(text) => onValue(text)} />
  }
  if (Array.isArray(value)) {
    return <ListEditor value={value} onValue={onValue} rules={rules} />
  }
  if (isPlainObject(value)) {
    return <ObjectEditor value={value} onValue={onValue} rules={rules} />
  }
  return <span className="text-muted-foreground font-mono text-sm">{String(value)}</span>
}

/**
 * Recursive object editor: one row per visible key. Removal follows
 * `rules.removeKeys`; changes bubble up by rebuilding this object.
 */
export function ObjectEditor({
  value,
  onValue,
  rules,
}: {
  value: Record<string, unknown>
  onValue: (value: unknown) => void
  rules: ValueEditorRules
}) {
  const entries = canonicalEntries(value, {hideNull: rules.hideNullEntries})
  const removeKey = (key: string) => {
    if (rules.removeKeys === 'tombstone') {
      onValue({...value, [key]: null})
    } else {
      const next = {...value}
      delete next[key]
      onValue(next)
    }
  }
  return (
    <div className={NESTED_GROUP_CLASS}>
      {entries.length === 0 && <p className="text-muted-foreground text-sm">No fields</p>}
      {entries.map(([key, child]) => (
        <div key={key} className="group/child flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>{key}</span>
            <ValueEditor value={child} onValue={(newChild) => onValue({...value, [key]: newChild})} rules={rules} />
          </div>
          <RemoveButton
            label={`Remove ${key}`}
            className="group-focus-within/child:opacity-100 group-hover/child:opacity-100"
            onClick={() => removeKey(key)}
          />
        </div>
      ))}
      <AddFieldForm
        compact
        rules={rules}
        existingKeys={entries.map(([key]) => key)}
        onAdd={(key, newChild) => onValue({...value, [key]: newChild})}
      />
    </div>
  )
}

/** Recursive list editor: edit, reorder, remove, and append items. */
export function ListEditor({
  value,
  onValue,
  rules,
}: {
  value: unknown[]
  onValue: (value: unknown) => void
  rules: ValueEditorRules
}) {
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
              rules={rules}
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
      <AddFieldForm compact itemMode rules={rules} onAdd={(_key, item) => onValue([...value, item])} />
    </div>
  )
}

/** Number input that stages on blur/Enter, validates per rules, resets on Escape. */
function NumberInput({
  value,
  onValue,
  rules,
}: {
  value: number
  onValue: (value: unknown) => void
  rules: ValueEditorRules
}) {
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
          const valid = text.trim() !== '' && (rules.floats ? Number.isFinite(parsed) : Number.isInteger(parsed))
          if (!valid) {
            setError(rules.floats ? 'Enter a number' : 'Enter a whole number')
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

type NewFieldType = 'text' | 'number' | 'toggle' | 'object' | 'list' | 'null' | 'json'

/**
 * Collapsed "+ Add field" affordance that expands into an inline form.
 * `itemMode` drops the key input for appending list items. Object and List
 * create empty containers that are then edited in place. The JSON type is the
 * explicit escape hatch for pasting a subtree.
 */
export function AddFieldForm({
  existingKeys = [],
  itemMode = false,
  compact = false,
  rules,
  onAdd,
}: {
  existingKeys?: string[]
  itemMode?: boolean
  compact?: boolean
  rules: ValueEditorRules
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
    else if (type === 'list') value = []
    else if (type === 'null') value = null
    else if (type === 'number') {
      const parsed = Number(textValue)
      const valid = textValue.trim() !== '' && (rules.floats ? Number.isFinite(parsed) : Number.isInteger(parsed))
      if (!valid) {
        setError(rules.floats ? 'Enter a number' : 'Enter a whole number')
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
      const problem = findInvalidValue(value, rules, [trimmedKey || 'item'])
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
            {rules.lists && <SelectItem value="list">List</SelectItem>}
            {!rules.hideNullEntries && <SelectItem value="null">Null</SelectItem>}
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

import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {Braces, Check, Plus, X} from 'lucide-react'
import {useEffect, useMemo, useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {Switch} from './components/switch'
import {Textarea} from './components/textarea'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from './select-dropdown'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/**
 * A staged partial update: keys map to their new value, or `null` to remove
 * the field (publishes a nullValue attribute op).
 */
export type MetadataPatch = Record<string, unknown>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Document attributes only publish strings, integers, booleans, null, and
 * nested plain objects of those (see `getDocAttributeChanges`). Anything else
 * would silently drop on publish, so the editor rejects it upfront.
 */
function findUnpublishableValue(value: unknown, path: string[] = []): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return null
  if (typeof value === 'number') {
    return Number.isInteger(value) ? null : `"${path.join('.')}" must be a whole number`
  }
  if (Array.isArray(value)) return `"${path.join('.')}" is an array — arrays cannot be published`
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const problem = findUnpublishableValue(child, [...path, key])
      if (problem) return problem
    }
    return null
  }
  return `"${path.join('.')}" has an unsupported type`
}

/** Compute the staged patch that turns `prev` into `next` (removed keys → null). */
function diffMetadata(prev: Record<string, unknown>, next: Record<string, unknown>): MetadataPatch {
  const patch: MetadataPatch = {}
  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(value)) patch[key] = value
  }
  for (const key of Object.keys(prev)) {
    if (!(key in next)) patch[key] = null
  }
  return patch
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

/** Visible entries: null/undefined means deleted (or never set) and is hidden. */
function visibleEntries(metadata: Record<string, unknown>): [string, unknown][] {
  return Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null)
}

const FIELD_LABEL_CLASS = 'text-muted-foreground text-xs font-medium tracking-wide uppercase'

/**
 * Metadata view for the `:metadata` document route. Read-only without edit
 * permission; with `canEdit` + `onMetadata` it becomes an inline editor where
 * every change is staged as a draft patch and published via the standard
 * publish flow. A raw JSON mode allows full editing in one place.
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
  const entries = visibleEntries(current)
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
              {entries.map(([key, value]) =>
                editable ? (
                  <MetadataFieldRow
                    key={key}
                    fieldKey={key}
                    value={value}
                    onValue={(newValue) => onMetadata!({[key]: newValue})}
                    onRemove={() => onMetadata!({[key]: null})}
                  />
                ) : (
                  <div key={key} className="border-border flex flex-col gap-1 border-b py-3 last:border-b-0">
                    <dt className={FIELD_LABEL_CLASS}>{key}</dt>
                    <dd className="font-mono text-sm break-words whitespace-pre-wrap">{formatMetadataValue(value)}</dd>
                  </div>
                ),
              )}
            </dl>
          )}
          {editable && (
            <AddMetadataField existingKeys={Object.keys(current)} onAdd={(key, value) => onMetadata!({[key]: value})} />
          )}
        </>
      )}
    </div>
  )
}

/** One editable metadata field: type-aware control + remove button on hover. */
function MetadataFieldRow({
  fieldKey,
  value,
  onValue,
  onRemove,
}: {
  fieldKey: string
  value: unknown
  onValue: (value: unknown) => void
  onRemove: () => void
}) {
  return (
    <div className="group border-border flex items-start gap-2 border-b py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <dt className={FIELD_LABEL_CLASS}>{fieldKey}</dt>
        <dd>
          <MetadataValueEditor fieldKey={fieldKey} value={value} onValue={onValue} />
        </dd>
      </div>
      <Tooltip content={`Remove ${fieldKey}`}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${fieldKey}`}
          className="text-muted-foreground hover:text-destructive mt-4 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={onRemove}
        >
          <X className="size-4" />
        </Button>
      </Tooltip>
    </div>
  )
}

function MetadataValueEditor({
  fieldKey,
  value,
  onValue,
}: {
  fieldKey: string
  value: unknown
  onValue: (value: unknown) => void
}) {
  if (typeof value === 'boolean') {
    return <Switch checked={value} onCheckedChange={(checked) => onValue(checked)} aria-label={fieldKey} />
  }
  if (typeof value === 'number') {
    return (
      <CommitOnBlurInput
        key={String(value)}
        initialValue={String(value)}
        inputMode="numeric"
        onCommit={(text) => {
          const parsed = Number(text)
          if (Number.isInteger(parsed)) onValue(parsed)
        }}
      />
    )
  }
  if (typeof value === 'string') {
    return <CommitOnBlurInput key={value} initialValue={value} onCommit={(text) => onValue(text)} />
  }
  // Objects (and anything else) edit as JSON
  return <InlineJsonValueEditor value={value} onValue={onValue} />
}

/** Text input that stages its value on blur or Enter, resets on Escape. */
function CommitOnBlurInput({
  initialValue,
  inputMode,
  placeholder,
  onCommit,
}: {
  initialValue: string
  inputMode?: 'numeric'
  placeholder?: string
  onCommit: (text: string) => void
}) {
  const [text, setText] = useState(initialValue)
  return (
    <Input
      value={text}
      inputMode={inputMode}
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

/** Per-field JSON editor for object values. Applies on blur when valid. */
function InlineJsonValueEditor({value, onValue}: {value: unknown; onValue: (value: unknown) => void}) {
  const serialized = useMemo(() => JSON.stringify(value, null, 2), [value])
  const [text, setText] = useState(serialized)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setText(serialized)
    setError(null)
  }, [serialized])

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        value={text}
        rows={Math.min(12, text.split('\n').length)}
        className={cn('font-mono text-sm', error && 'border-destructive')}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text === serialized) return
          try {
            const parsed = JSON.parse(text)
            const problem = findUnpublishableValue(parsed, ['value'])
            if (problem) {
              setError(problem)
              return
            }
            setError(null)
            onValue(parsed)
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Invalid JSON')
          }
        }}
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

type NewFieldType = 'text' | 'number' | 'toggle' | 'json'

/** Collapsed "+ Add field" affordance that expands into an inline form. */
function AddMetadataField({
  existingKeys,
  onAdd,
}: {
  existingKeys: string[]
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
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Add field
        </Button>
      </div>
    )
  }

  const submit = () => {
    const trimmedKey = key.trim()
    if (!trimmedKey) {
      setError('Enter a field name')
      return
    }
    if (existingKeys.includes(trimmedKey)) {
      setError(`"${trimmedKey}" already exists — edit it above`)
      return
    }
    let value: unknown
    if (type === 'text') value = textValue
    else if (type === 'toggle') value = toggleValue
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
      const problem = findUnpublishableValue(value, [trimmedKey])
      if (problem) {
        setError(problem)
        return
      }
    }
    onAdd(trimmedKey, value)
    reset()
  }

  return (
    <div className="border-border flex flex-col gap-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
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
        <Select value={type} onValueChange={(v) => setType(v as NewFieldType)}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text">Text</SelectItem>
            <SelectItem value="number">Number</SelectItem>
            <SelectItem value="toggle">Toggle</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
          </SelectContent>
        </Select>
        {type === 'toggle' ? (
          <Switch checked={toggleValue} onCheckedChange={setToggleValue} aria-label="New field value" />
        ) : type === 'json' ? null : (
          <Input
            value={textValue}
            placeholder="Value"
            inputMode={type === 'number' ? 'numeric' : undefined}
            className="min-w-40 flex-1"
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
  const currentVisible = useMemo(() => Object.fromEntries(visibleEntries(metadata)), [metadata])
  const serialized = useMemo(() => JSON.stringify(currentVisible, null, 2), [currentVisible])
  const [text, setText] = useState(serialized)
  useEffect(() => setText(serialized), [serialized])

  const validation = useMemo(() => {
    if (text === serialized) return {dirty: false as const}
    try {
      const parsed: unknown = JSON.parse(text)
      if (!isPlainObject(parsed)) return {dirty: true as const, error: 'Metadata must be a JSON object'}
      const problem = findUnpublishableValue(parsed)
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
                  onMetadata!(diffMetadata(currentVisible, validation.value!))
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

import {ChevronDown, ChevronRight, Plus, X} from 'lucide-react'
import {useState} from 'react'
import type {BlobSchema} from './blob-schema'
import {
  addProperty,
  isRequiredProperty,
  removeProperty,
  renameProperty,
  SCHEMA_NODE_KIND_LABELS,
  SCHEMA_NODE_KINDS,
  schemaNodeKind,
  setRequiredProperty,
  setSchemaKeyword,
  setSchemaNodeKind,
  type SchemaNodeKind,
} from './blob-schema-edit'
import {Button} from './button'
import {Input} from './components/input'
import {Switch} from './components/switch'
import {isDagJsonLink, parseCidString} from './dag-json'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from './select-dropdown'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/**
 * Purpose-built form for authoring Seed Blob Schemas — the schema editor is
 * NOT the generic value editor with hints. Every dialect keyword has a
 * permanent, type-sensitive control: pick "Object" and you get a properties
 * table with required toggles and the extra-fields switch; pick "Text" and
 * you get options/length/pattern; and so on. The underlying data stays the
 * plain dialect value (the page's raw-fields and JSON modes edit the same
 * object), and keywords the form doesn't own — including ones from a
 * different type than the current pick — are preserved untouched.
 */
export function BlobSchemaEditor({
  value,
  onValue,
}: {
  /** The whole schema blob value (including the reserved `schema` link key). */
  value: Record<string, unknown>
  onValue: (value: unknown) => void
}) {
  const node = value as BlobSchema
  const patch = (next: BlobSchema) => onValue(next)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <LabeledField label="Title" hint="A short name for this schema">
          <TextField
            value={typeof node.title === 'string' ? node.title : ''}
            placeholder="e.g. Article"
            onCommit={(text) => patch(setSchemaKeyword(node, 'title', text || undefined))}
          />
        </LabeledField>
        <LabeledField label="Description" hint="What data this schema describes">
          <TextField
            value={typeof node.description === 'string' ? node.description : ''}
            placeholder="Optional help text"
            onCommit={(text) => patch(setSchemaKeyword(node, 'description', text || undefined))}
          />
        </LabeledField>
      </div>
      <SchemaNodeEditor node={node} onNode={patch} depth={0} isRoot />
      <DefsSection node={node} onNode={patch} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Node editor: type picker + per-type option panel
// ---------------------------------------------------------------------------

function SchemaNodeEditor({
  node,
  onNode,
  depth,
  isRoot = false,
}: {
  node: BlobSchema
  onNode: (node: BlobSchema) => void
  depth: number
  isRoot?: boolean
}) {
  const kind = schemaNodeKind(node)
  if (depth > 12) {
    return <p className="text-muted-foreground text-xs">Too deeply nested — use the raw editor for this level.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground w-14 shrink-0 text-xs font-medium">{isRoot ? 'Schema of' : 'Type'}</span>
        <Select value={kind} onValueChange={(next) => onNode(setSchemaNodeKind(node, next as SchemaNodeKind))}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCHEMA_NODE_KINDS.map((option) => (
              <SelectItem key={option} value={option}>
                {SCHEMA_NODE_KIND_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {kind === 'any' && <span className="text-muted-foreground text-xs">accepts any value</span>}
      </div>
      {kind === 'object' && <ObjectOptions node={node} onNode={onNode} depth={depth} />}
      {kind === 'text' && <TextOptions node={node} onNode={onNode} />}
      {(kind === 'integer' || kind === 'number') && <NumberOptions node={node} onNode={onNode} />}
      {kind === 'toggle' && <ToggleOptions node={node} onNode={onNode} />}
      {kind === 'list' && <ListOptions node={node} onNode={onNode} depth={depth} />}
      {kind === 'link' && <LinkOptions node={node} onNode={onNode} />}
      {kind === 'bytes' && <BytesOptions node={node} onNode={onNode} />}
      {kind === 'ref' && <RefOptions node={node} onNode={onNode} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Object: properties table, required toggles, extra-fields switch
// ---------------------------------------------------------------------------

function ObjectOptions({node, onNode, depth}: {node: BlobSchema; onNode: (node: BlobSchema) => void; depth: number}) {
  const properties = node.properties ?? {}
  const keys = Object.keys(properties)
  return (
    <div className="flex flex-col gap-2">
      <div className="border-border ml-1 flex flex-col gap-1 border-l-2 pl-3">
        <span className="text-muted-foreground text-xs font-medium">Fields</span>
        {keys.length === 0 && <p className="text-muted-foreground text-xs">No fields yet — add one below.</p>}
        {keys.map((key) => (
          <PropertyRow
            key={key}
            propertyKey={key}
            parent={node}
            node={properties[key] ?? {}}
            depth={depth}
            onParent={onNode}
          />
        ))}
        <AddPropertyForm parent={node} onParent={onNode} />
      </div>
      <label className="flex w-fit items-center gap-2 text-xs">
        <Switch
          checked={node.additionalProperties !== false}
          onCheckedChange={(allowed) =>
            onNode(setSchemaKeyword(node, 'additionalProperties', allowed ? undefined : false))
          }
        />
        <span className="text-muted-foreground">
          Allow fields beyond the ones declared above
          {node.additionalProperties === false && ' (undeclared fields will be warned about)'}
        </span>
      </label>
    </div>
  )
}

function PropertyRow({
  propertyKey,
  parent,
  node,
  depth,
  onParent,
}: {
  propertyKey: string
  parent: BlobSchema
  node: BlobSchema
  depth: number
  onParent: (parent: BlobSchema) => void
}) {
  const kind = schemaNodeKind(node)
  // Containers and refs open expanded — their options are the point.
  const [expanded, setExpanded] = useState(kind === 'object' || kind === 'list')
  const required = isRequiredProperty(parent, propertyKey)
  const onNode = (next: BlobSchema) =>
    onParent({...parent, properties: {...(parent.properties ?? {}), [propertyKey]: next}})
  const summary = [
    SCHEMA_NODE_KIND_LABELS[kind],
    typeof node.title === 'string' && node.title ? `“${node.title}”` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="group/prop flex flex-col gap-1 py-0.5">
      <div className="flex items-center gap-2">
        <button
          aria-label={expanded ? `Collapse ${propertyKey}` : `Expand ${propertyKey}`}
          className="text-muted-foreground hover:text-foreground flex size-4 shrink-0 items-center justify-center"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </button>
        <PropertyKeyInput
          propertyKey={propertyKey}
          siblingKeys={Object.keys(parent.properties ?? {}).filter((key) => key !== propertyKey)}
          onRename={(newKey) => onParent(renameProperty(parent, propertyKey, newKey))}
        />
        {!expanded && <span className="text-muted-foreground truncate text-xs">{summary}</span>}
        <span className="flex-1" />
        <Tooltip content={required ? 'Instances must include this field' : 'Optional field'}>
          <label className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
            <Switch
              checked={required}
              onCheckedChange={(next) => onParent(setRequiredProperty(parent, propertyKey, next))}
            />
            Required
          </label>
        </Tooltip>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={`Remove ${propertyKey}`}
          className="text-muted-foreground hover:text-destructive opacity-0 group-focus-within/prop:opacity-100 group-hover/prop:opacity-100"
          onClick={() => onParent(removeProperty(parent, propertyKey))}
        >
          <X className="size-4" />
        </Button>
      </div>
      {expanded && (
        <div className="border-border ml-2 border-l-2 pt-1 pb-1 pl-4">
          <div className="mb-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <TextField
              value={typeof node.title === 'string' ? node.title : ''}
              placeholder="Label (optional)"
              onCommit={(text) => onNode(setSchemaKeyword(node, 'title', text || undefined))}
            />
            <TextField
              value={typeof node.description === 'string' ? node.description : ''}
              placeholder="Help text (optional)"
              onCommit={(text) => onNode(setSchemaKeyword(node, 'description', text || undefined))}
            />
          </div>
          <SchemaNodeEditor node={node} onNode={onNode} depth={depth + 1} />
        </div>
      )}
    </div>
  )
}

function PropertyKeyInput({
  propertyKey,
  siblingKeys,
  onRename,
}: {
  propertyKey: string
  siblingKeys: string[]
  onRename: (newKey: string) => void
}) {
  const [text, setText] = useState(propertyKey)
  return (
    <input
      value={text}
      aria-label={`Field name: ${propertyKey}`}
      className="hover:border-border focus:border-border w-36 shrink-0 border-b border-transparent bg-transparent font-mono text-sm transition-colors outline-none"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = text.trim()
        if (!next || next === propertyKey || next === '/' || siblingKeys.includes(next)) {
          setText(propertyKey)
          return
        }
        onRename(next)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setText(propertyKey)
      }}
    />
  )
}

function AddPropertyForm({parent, onParent}: {parent: BlobSchema; onParent: (parent: BlobSchema) => void}) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [kind, setKind] = useState<SchemaNodeKind>('text')
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setOpen(false)
    setKey('')
    setKind('text')
    setError(null)
  }
  const submit = () => {
    const trimmed = key.trim()
    if (trimmed === '/') {
      setError('"/" is a reserved field name')
      return
    }
    const next = addProperty(parent, trimmed, setSchemaNodeKind({}, kind))
    if (!next) {
      setError(trimmed ? `"${trimmed}" already exists` : 'Enter a field name')
      return
    }
    onParent(next)
    reset()
  }

  if (!open) {
    return (
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-6 px-1 text-xs"
          onClick={() => setOpen(true)}
        >
          <Plus className="size-3" />
          Add field
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={key}
          placeholder="Field name"
          className="w-40"
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
        <Select value={kind} onValueChange={(next) => setKind(next as SchemaNodeKind)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCHEMA_NODE_KINDS.map((option) => (
              <SelectItem key={option} value={option}>
                {SCHEMA_NODE_KIND_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={submit}>
          Add
        </Button>
        <Button variant="ghost" size="sm" onClick={reset}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-type option panels
// ---------------------------------------------------------------------------

function TextOptions({node, onNode}: {node: BlobSchema; onNode: (node: BlobSchema) => void}) {
  return (
    <div className="flex flex-col gap-2">
      <EnumChips node={node} onNode={onNode} />
      <div className="flex flex-wrap items-end gap-3">
        <LabeledField label="Min length">
          <IntField
            value={typeof node.minLength === 'number' ? node.minLength : undefined}
            onCommit={(next) => onNode(setSchemaKeyword(node, 'minLength', next))}
          />
        </LabeledField>
        <LabeledField label="Max length">
          <IntField
            value={typeof node.maxLength === 'number' ? node.maxLength : undefined}
            onCommit={(next) => onNode(setSchemaKeyword(node, 'maxLength', next))}
          />
        </LabeledField>
        <LabeledField label="Pattern" hint="Regular expression the text must match">
          <TextField
            value={typeof node.pattern === 'string' ? node.pattern : ''}
            placeholder="e.g. ^[a-z-]+$"
            className="w-44 font-mono text-xs"
            onCommit={(text) => onNode(setSchemaKeyword(node, 'pattern', text || undefined))}
          />
        </LabeledField>
        <LabeledField label="Default">
          <TextField
            value={typeof node.default === 'string' ? node.default : ''}
            placeholder="none"
            onCommit={(text) => onNode(setSchemaKeyword(node, 'default', text || undefined))}
          />
        </LabeledField>
      </div>
    </div>
  )
}

/** Tag-style editor for a string enum ("Options"). */
function EnumChips({node, onNode}: {node: BlobSchema; onNode: (node: BlobSchema) => void}) {
  const [draft, setDraft] = useState('')
  const options = Array.isArray(node.enum)
    ? node.enum.filter((option): option is string => typeof option === 'string')
    : []
  const commit = () => {
    const text = draft.trim()
    if (!text || options.includes(text)) return
    onNode(setSchemaKeyword(node, 'enum', [...options, text]))
    setDraft('')
  }
  return (
    <LabeledField label="Options" hint="Leave empty for free text; instances pick from these in a dropdown">
      <div className="flex flex-wrap items-center gap-1">
        {options.map((option) => (
          <span
            key={option}
            className="bg-accent text-accent-foreground flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 font-mono text-xs"
          >
            {option}
            <button
              aria-label={`Remove option ${option}`}
              className="hover:text-destructive"
              onClick={() => {
                const remaining = options.filter((existing) => existing !== option)
                onNode(setSchemaKeyword(node, 'enum', remaining.length > 0 ? remaining : undefined))
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <Input
          value={draft}
          placeholder="Add option…"
          className="h-7 w-32 text-xs"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setDraft('')
          }}
        />
      </div>
    </LabeledField>
  )
}

function NumberOptions({node, onNode}: {node: BlobSchema; onNode: (node: BlobSchema) => void}) {
  const isInteger = node.type === 'integer'
  return (
    <div className="flex flex-wrap items-end gap-3">
      <LabeledField label="Minimum">
        <NumField
          integer={isInteger}
          value={typeof node.minimum === 'number' ? node.minimum : undefined}
          onCommit={(next) => onNode(setSchemaKeyword(node, 'minimum', next))}
        />
      </LabeledField>
      <LabeledField label="Maximum">
        <NumField
          integer={isInteger}
          value={typeof node.maximum === 'number' ? node.maximum : undefined}
          onCommit={(next) => onNode(setSchemaKeyword(node, 'maximum', next))}
        />
      </LabeledField>
      <LabeledField label="Default">
        <NumField
          integer={isInteger}
          value={typeof node.default === 'number' ? node.default : undefined}
          onCommit={(next) => onNode(setSchemaKeyword(node, 'default', next))}
        />
      </LabeledField>
    </div>
  )
}

function ToggleOptions({node, onNode}: {node: BlobSchema; onNode: (node: BlobSchema) => void}) {
  return (
    <LabeledField label="Default">
      <div className="flex items-center gap-2 text-xs">
        <Switch
          checked={node.default === true}
          onCheckedChange={(next) => onNode(setSchemaKeyword(node, 'default', next))}
        />
        {node.default === undefined && <span className="text-muted-foreground">no default</span>}
        {node.default !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground h-6 px-1 text-xs"
            onClick={() => onNode(setSchemaKeyword(node, 'default', undefined))}
          >
            Clear default
          </Button>
        )}
      </div>
    </LabeledField>
  )
}

function ListOptions({node, onNode, depth}: {node: BlobSchema; onNode: (node: BlobSchema) => void; depth: number}) {
  const items = node.items ?? {}
  return (
    <div className="flex flex-col gap-2">
      <div className="border-border ml-1 flex flex-col gap-2 border-l-2 pl-3">
        <span className="text-muted-foreground text-xs font-medium">Each item</span>
        <SchemaNodeEditor
          node={items}
          onNode={(next) => onNode(setSchemaKeyword(node, 'items', next))}
          depth={depth + 1}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <LabeledField label="Min items">
          <IntField
            value={typeof node.minItems === 'number' ? node.minItems : undefined}
            onCommit={(next) => onNode(setSchemaKeyword(node, 'minItems', next))}
          />
        </LabeledField>
        <LabeledField label="Max items">
          <IntField
            value={typeof node.maxItems === 'number' ? node.maxItems : undefined}
            onCommit={(next) => onNode(setSchemaKeyword(node, 'maxItems', next))}
          />
        </LabeledField>
      </div>
    </div>
  )
}

function LinkOptions({node, onNode}: {node: BlobSchema; onNode: (node: BlobSchema) => void}) {
  const target = isDagJsonLink(node.targetSchema) ? node.targetSchema['/'] : ''
  return (
    <LabeledField label="Target schema" hint="Optionally, the schema the linked blob should conform to">
      <CidField
        value={target}
        placeholder="Schema CID (optional)"
        onCommit={(cid) => onNode(setSchemaKeyword(node, 'targetSchema', cid ? {'/': cid} : undefined))}
      />
    </LabeledField>
  )
}

function BytesOptions({node, onNode}: {node: BlobSchema; onNode: (node: BlobSchema) => void}) {
  return (
    <LabeledField label="Max size (bytes)">
      <IntField
        value={typeof node.maxBytes === 'number' ? node.maxBytes : undefined}
        onCommit={(next) => onNode(setSchemaKeyword(node, 'maxBytes', next))}
      />
    </LabeledField>
  )
}

function RefOptions({node, onNode}: {node: BlobSchema; onNode: (node: BlobSchema) => void}) {
  const ref = node.$ref
  const isExternal = isDagJsonLink(ref)
  const pointer = typeof ref === 'string' ? ref : ''
  return (
    <div className="flex flex-wrap items-end gap-3">
      <LabeledField label="Reference" hint="A definition below (#/$defs/Name) or another schema blob's CID">
        <TextField
          value={isExternal ? (ref as {'/': string})['/'] : pointer}
          placeholder="#/$defs/Name or schema CID"
          className="w-72 font-mono text-xs"
          onCommit={(text) => {
            const trimmed = text.trim().replace(/^ipfs:\/\//, '')
            if (!trimmed) return onNode(setSchemaKeyword(node, '$ref', ''))
            if (trimmed.startsWith('#')) return onNode(setSchemaKeyword(node, '$ref', trimmed))
            const parsed = parseCidString(trimmed)
            onNode(setSchemaKeyword(node, '$ref', parsed ? {'/': trimmed} : trimmed))
          }}
        />
      </LabeledField>
    </div>
  )
}

// ---------------------------------------------------------------------------
// $defs section (root only)
// ---------------------------------------------------------------------------

function DefsSection({node, onNode}: {node: BlobSchema; onNode: (node: BlobSchema) => void}) {
  const defs = node.$defs ?? {}
  const names = Object.keys(defs)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  if (names.length === 0 && !adding) {
    return (
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground h-6 px-1 text-xs"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-3" />
          Add reusable definition
        </Button>
      </div>
    )
  }
  const setDefs = (next: Record<string, BlobSchema>) =>
    onNode(setSchemaKeyword(node, '$defs', Object.keys(next).length > 0 ? next : undefined))
  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-xs font-medium">
        Definitions <span className="font-normal">(reference as #/$defs/Name)</span>
      </span>
      <div className="border-border ml-1 flex flex-col gap-2 border-l-2 pl-3">
        {names.map((name) => (
          <div key={name} className="group/def flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{name}</span>
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="iconSm"
                aria-label={`Remove definition ${name}`}
                className="text-muted-foreground hover:text-destructive opacity-0 group-focus-within/def:opacity-100 group-hover/def:opacity-100"
                onClick={() => {
                  const next = {...defs}
                  delete next[name]
                  setDefs(next)
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="border-border ml-1 border-l-2 pl-3">
              <SchemaNodeEditor node={defs[name] ?? {}} onNode={(next) => setDefs({...defs, [name]: next})} depth={1} />
            </div>
          </div>
        ))}
        {adding ? (
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              placeholder="Definition name"
              className="w-40"
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const name = draft.trim()
                  if (name && !Object.prototype.hasOwnProperty.call(defs, name)) {
                    setDefs({...defs, [name]: {type: 'object'}})
                    setDraft('')
                    setAdding(false)
                  }
                }
                if (e.key === 'Escape') {
                  setDraft('')
                  setAdding(false)
                }
              }}
            />
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-6 px-1 text-xs"
              onClick={() => setAdding(true)}
            >
              <Plus className="size-3" />
              Add definition
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small labeled/committing inputs
// ---------------------------------------------------------------------------

function LabeledField({label, hint, children}: {label: string; hint?: string; children: React.ReactNode}) {
  const labelEl = <span className="text-muted-foreground text-xs font-medium">{label}</span>
  return (
    <div className="flex flex-col gap-1">
      {hint ? <Tooltip content={hint}>{labelEl}</Tooltip> : labelEl}
      {children}
    </div>
  )
}

function TextField({
  value,
  placeholder,
  className,
  onCommit,
}: {
  value: string
  placeholder?: string
  className?: string
  onCommit: (text: string) => void
}) {
  return (
    <Input
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      className={cn('h-8', className)}
      onBlur={(e) => {
        const next = e.target.value
        if (next !== value) onCommit(next)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') (e.target as HTMLInputElement).value = value
      }}
    />
  )
}

/** Optional whole-number input: empty clears the keyword. */
function IntField({value, onCommit}: {value: number | undefined; onCommit: (value: number | undefined) => void}) {
  return <NumField integer value={value} onCommit={onCommit} />
}

function NumField({
  integer = false,
  value,
  onCommit,
}: {
  integer?: boolean
  value: number | undefined
  onCommit: (value: number | undefined) => void
}) {
  const initial = value === undefined ? '' : String(value)
  return (
    <Input
      key={initial}
      defaultValue={initial}
      placeholder="none"
      inputMode="numeric"
      className="h-8 w-24"
      onBlur={(e) => {
        const text = e.target.value.trim()
        if (text === initial) return
        if (text === '') return onCommit(undefined)
        const parsed = Number(text)
        const valid = integer ? Number.isInteger(parsed) : Number.isFinite(parsed)
        if (valid) onCommit(parsed)
        else e.target.value = initial
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') (e.target as HTMLInputElement).value = initial
      }}
    />
  )
}

/** CID input that only commits valid DAG-CBOR CIDs (or empty to clear). */
function CidField({
  value,
  placeholder,
  onCommit,
}: {
  value: string
  placeholder?: string
  onCommit: (cid: string) => void
}) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col gap-1">
      <Input
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        className="h-8 w-72 font-mono text-xs"
        onChange={() => setError(null)}
        onBlur={(e) => {
          const text = e.target.value.trim().replace(/^ipfs:\/\//, '')
          if (text === value) return
          if (text === '') return onCommit('')
          if (!parseCidString(text)) {
            setError('Not a valid CID')
            return
          }
          onCommit(text)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') (e.target as HTMLInputElement).value = value
        }}
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

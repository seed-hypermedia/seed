// A purpose-built GUI for authoring a Hypermedia schema — presented as a struct (a
// list of fields), NOT as raw schema JSON. A schema carries no name of its own;
// the defining document names and describes the type. Each field has a
// name, a kind, and a `required` checkbox (the schema's `required` array is
// derived from the checkboxes). A generic schema lists its type parameters,
// and a field can take a parameter as its kind. A "JSON" mode is the escape
// hatch for shapes the struct form doesn't cover (unions, open maps, lists,
// instantiations): it is the default there, and the form is unavailable so it
// cannot mangle them. Kept visually minimal and consistent with the value
// editor that renders the forms this schema defines.
import {ArrowRight, Braces, Lock, LockOpen, Plus, Rows3, Variable, X} from 'lucide-react'
import {forwardRef, useEffect, useMemo, useRef, useState} from 'react'
import {Textarea} from '../components/textarea'
import {Tooltip} from '../tooltip'
import {cn} from '../utils'
import {
  KINDS,
  MAP_URL,
  HM_SCHEMAS,
  type HypermediaSchema,
  STRUCT_URL,
  isLiteralSchema,
  literalSchema,
  literalValue,
  type StructField,
  fieldSchema,
  fieldsToProperties,
  kindOf,
  kindUrl,
  namedSchemaUrl,
  nameToUrl,
  refToName,
  structFields,
  validate,
} from './engine'
import {kindColor, refChipColor} from './schema-colors'
import {HM_SCHEMA_PAGES} from './schema-registry.generated'
import {SchemaTypeInput, type TypeOption} from './schema-type-input'

/** The field kinds a struct property can take (friendly labels). */
const FIELD_KINDS: {kind: string; label: string}[] = [
  {kind: 'string', label: 'Text'},
  {kind: 'hm-url', label: 'HM link'},
  {kind: 'ipfs', label: 'IPFS file / object'},
  {kind: 'date', label: 'Date'},
  {kind: 'date-time', label: 'Date & time'},
  {kind: 'integer', label: 'Whole number'},
  {kind: 'float', label: 'Number'},
  {kind: 'boolean', label: 'Toggle'},
  {kind: 'link', label: 'IPLD link'},
  {kind: 'bytes', label: 'Bytes'},
  {kind: 'list', label: 'List'},
  {kind: 'struct', label: 'Struct'},
  {kind: 'map', label: 'Map'},
  {kind: 'any', label: 'Anything'},
]

/** A type parameter as a field kind: `var:T`. */
const varKind = (name: string) => `var:${name}`
/** A field whose schema the form cannot express: shown by name, never rewritten unless a kind is picked. */
const CUSTOM_KIND = 'custom'

/** The kind a property schema declares (best-effort; defaults to text). */
function propKind(ps: any): string {
  if (typeof ps?.var === 'string') return varKind(ps.var)
  const named = namedSchemaUrl(ps)
  const refName = named ? refToName(named) : null
  if (ps?.format === 'hm-url' || refName === 'hm-url') return 'hm-url'
  if (ps?.format === 'ipfs-url' || ps?.format === 'ipfs' || refName === 'ipfs-url') return 'ipfs'
  if (ps?.format === 'date' || refName === 'date') return 'date'
  if (ps?.format === 'date-time' || refName === 'date-time') return 'date-time'
  if (refName === 'any') return 'any'
  if (isLiteralSchema(ps) || ps?.anyOf || ps?.args) return CUSTOM_KIND
  if (ps?.type && !named) return kindOf(ps.type)
  if (refName && KINDS.includes(refName.replace(/^hypermedia-/, ''))) return refName.replace(/^hypermedia-/, '')
  if (refName) return CUSTOM_KIND
  return 'string'
}

/** What to call a custom field's type: its ref's name, or its shape. */
function customLabel(ps: any): string {
  if (isLiteralSchema(ps)) return JSON.stringify(literalValue(ps))
  const named = namedSchemaUrl(ps)
  if (named) return refToName(named)
  if (ps?.anyOf) return `one of ${ps.anyOf.length}`
  return 'custom'
}

/** Whether the struct form can show (and safely rewrite) this schema. */
export function structFormFits(schema: HypermediaSchema): boolean {
  if (isLiteralSchema(schema) || schema.args) return false
  if (Array.isArray(schema.anyOf)) return true
  // A base not chosen yet (the Extend flow starts blank) is still a struct to fill in.
  if (schema.type === '') return true
  if (namedSchemaUrl(schema)) return true
  if (schema.type) return ['struct', 'map', 'list'].includes(kindOf(schema.type))
  return false
}

/** A union, offered to fields and to the root alike; the picked entry starts with one open option. */
const unionOption = (): TypeOption => ({
  label: 'Union',
  hint: 'one of several types',
  schema: {anyOf: [{type: ANY_URL}]},
})

/** The schema a picked type URL stands for: `type` names it, whether it is a kind or another schema. */
const typeSchemaFor = (url: string): HypermediaSchema => ({type: url})
/** The type URL a schema node names, '' for a union, a format or a parameter. */
const nodeUrl = (ps: any): string =>
  typeof ps?.type === 'string' ? ps.type : typeof ps?.ref === 'string' ? ps.ref : ''
/** A label for the shapes a URL does not name: a union, a parameter, a string format… */
function nodeLabel(ps: any): string | undefined {
  if (Array.isArray(ps?.anyOf)) return 'Union'
  const k = propKind(ps)
  if (k.startsWith('var:')) return `⟨${k.slice(4)}⟩`
  if (k === 'hm-url') return 'HM link'
  if (k === 'ipfs') return 'IPFS file / object'
  if (k === CUSTOM_KIND && !nodeUrl(ps)) return customLabel(ps)
  return undefined
}

/** Every `{var: from}` in a schema renamed to `to` (or replaced by `to` when it is an object). */
function replaceVar(node: any, from: string, to: string | HypermediaSchema): any {
  if (Array.isArray(node)) return node.map((n) => replaceVar(n, from, to))
  if (!node || typeof node !== 'object') return node
  if (node.var === from && Object.keys(node).length === 1) return typeof to === 'string' ? {var: to} : to
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(node)) out[k] = replaceVar(v, from, to)
  return out
}

/** The property schema for a chosen kind. */
function kindSchema(kind: string): HypermediaSchema {
  if (kind.startsWith('var:')) return {var: kind.slice(4)}
  if (kind === 'any') return {type: ANY_URL}
  if (kind === 'hm-url') return {type: kindUrl('string'), format: 'hm-url'}
  if (kind === 'ipfs') return {type: kindUrl('string'), format: 'ipfs-url'}
  // The built-in date types are includes of the library schemas, which carry
  // the format (→ a date picker) and the pattern (→ validation).
  if (kind === 'date') return {type: nameToUrl('date')!}
  if (kind === 'date-time') return {type: nameToUrl('date-time')!}
  if (kind === 'list') return {type: kindUrl('list'), items: {type: ANY_URL}}
  if (kind === 'struct') return {type: STRUCT_URL, properties: {}}
  if (kind === 'map') return {type: MAP_URL, values: {type: ANY_URL}}
  return {type: kindUrl(kind)}
}

/** The `any` schema: what a type parameter defaults to when nothing narrower is given. */
const ANY_URL = nameToUrl('any')!
/** The signed-blob envelope every Hypermedia blob extends. */
const SIGNED_BLOB_URL = nameToUrl('blob')!
/** True when the schema extends the signed-blob envelope. */
export const isSignedBlobType = (schema: HypermediaSchema) => namedSchemaUrl(schema) === SIGNED_BLOB_URL
/** The pinned `type` tag of a signed-blob schema ('' when none). */
const signedTypeTag = (schema: HypermediaSchema): string => {
  const t = fieldSchema(schema, 'type')
  const tag = t !== undefined && isLiteralSchema(t) ? literalValue(t) : undefined
  return typeof tag === 'string' ? tag : ''
}

/** Kinds whose value references something else, and so may carry a `target` type. */
const isReferenceKind = (kind: string) => kind === 'hm-url' || kind === 'ipfs'

/** An empty starter struct schema. */
export const emptyStructSchema = (): HypermediaSchema => ({type: STRUCT_URL, properties: {}})

/** What a schema's root can be: a plain struct, the signed-blob envelope, or an extension of any base type. */
export type SchemaRootKind = 'struct' | 'signed' | 'extends'

/**
 * The schema rewritten with a new root kind, fields preserved. Signed pins a `type` tag (kept if
 * already set, else "Custom"); leaving signed drops the pinned tag; `extends` keeps an existing
 * non-envelope base ref (or starts blank, for the user to paste any base).
 */
export function withRootKind(schema: HypermediaSchema, kind: SchemaRootKind): HypermediaSchema {
  const fields = structFields(schema).filter((f) => !(isSignedBlobType(schema) && f.name === 'type'))
  const {type: _t, ref: _r, ...rest} = schema
  if (kind === 'signed') {
    const tag = signedTypeTag(schema) || 'Custom'
    const withTag = [{name: 'type', schema: literalSchema(tag), required: true}, ...fields]
    return {...rest, type: SIGNED_BLOB_URL, properties: fieldsToProperties(withTag)}
  }
  if (kind === 'struct') return {...rest, type: STRUCT_URL, properties: fieldsToProperties(fields)}
  const base = namedSchemaUrl(schema)
  return {...rest, type: base && base !== SIGNED_BLOB_URL ? base : '', properties: fieldsToProperties(fields)}
}

/** The raw schema as JSON, for shapes the form does not cover. Syntax errors block the commit;
 * meta-schema violations are advisory, like everywhere else in the editors. */
function RawSchemaEditor({schema, onSchema}: {schema: HypermediaSchema; onSchema: (s: HypermediaSchema) => void}) {
  const [text, setText] = useState(() => JSON.stringify(schema, null, 2))
  const [syntaxError, setSyntaxError] = useState<string | null>(null)
  // Follow outside changes (the form, a draft reload) while the text still parses to something else.
  useEffect(() => {
    try {
      if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(schema)) setText(JSON.stringify(schema, null, 2))
    } catch {
      // the user is mid-edit; keep their text
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema])
  const warnings = useMemo(() => {
    const meta = HM_SCHEMAS['schema']
    return meta ? validate(meta, schema).slice(0, 5) : []
  }, [schema])
  return (
    <div className="flex flex-col gap-1.5" data-testid="schema-json-editor">
      <Textarea
        value={text}
        spellCheck={false}
        aria-label="Schema JSON"
        className="min-h-48 font-mono text-xs"
        onChange={(e) => {
          setText(e.target.value)
          try {
            const parsed = JSON.parse(e.target.value)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('a schema is an object')
            setSyntaxError(null)
            onSchema(parsed)
          } catch (err) {
            setSyntaxError((err as Error).message)
          }
        }}
      />
      {syntaxError ? (
        <p className="text-destructive text-xs">{syntaxError}</p>
      ) : (
        warnings.map((w) => (
          <p key={w} className="text-xs text-amber-600">
            {w}
          </p>
        ))
      )}
    </div>
  )
}

/**
 * Undo/redo for a controlled schema. Every edit goes straight into the document draft and the
 * inputs are controlled, so the browser's own undo has nothing to work with; this keeps the
 * history instead. Edits within a short burst (typing) coalesce into one step.
 */
function useSchemaHistory(schema: HypermediaSchema, onSchema: (s: HypermediaSchema) => void) {
  const past = useRef<HypermediaSchema[]>([])
  const future = useRef<HypermediaSchema[]>([])
  const lastEditAt = useRef(0)
  const change = (next: HypermediaSchema) => {
    const now = Date.now()
    if (now - lastEditAt.current > 800) past.current.push(schema)
    lastEditAt.current = now
    future.current = []
    onSchema(next)
  }
  const undo = () => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(schema)
    lastEditAt.current = 0
    onSchema(prev)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(schema)
    lastEditAt.current = 0
    onSchema(next)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return
    const key = e.key.toLowerCase()
    if (key === 'z') {
      e.preventDefault()
      e.stopPropagation()
      if (e.shiftKey) redo()
      else undo()
    } else if (key === 'y' && e.ctrlKey) {
      e.preventDefault()
      e.stopPropagation()
      redo()
    }
  }
  return {change, onKeyDown}
}

export function SchemaEditor({
  schema,
  onSchema: onSchemaProp,
  hideModeToggle,
}: {
  schema: HypermediaSchema
  onSchema: (s: HypermediaSchema) => void
  /** The host offers its own raw/JSON switch (the blob inspector): no Fields/JSON tabs here. */
  hideModeToggle?: boolean
}) {
  const {change: onSchema, onKeyDown} = useSchemaHistory(schema, onSchemaProp)
  const fits = structFormFits(schema)
  const [mode, setMode] = useState<'form' | 'json'>(fits ? 'form' : 'json')
  const showForm = mode === 'form' && fits
  const modeToggle = (
    <div className="bg-muted/60 flex items-center rounded-md p-0.5" role="tablist" aria-label="Schema editor mode">
      {(['form', 'json'] as const).map((m) => {
        const selected = showForm ? m === 'form' : m === 'json'
        const Icon = m === 'form' ? Rows3 : Braces
        return (
          <Tooltip
            key={m}
            content={
              m === 'form'
                ? fits
                  ? 'Edit as fields'
                  : 'This shape (union, list, open map, instantiation) is edited as JSON'
                : 'Edit the raw schema JSON'
            }
          >
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={m === 'form' && !fits}
              onClick={() => setMode(m)}
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs',
                selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                m === 'form' && !fits ? 'cursor-not-allowed opacity-50' : 'hover:text-foreground cursor-pointer',
              )}
            >
              <Icon className="size-3" />
              {m === 'form' ? 'Form' : 'JSON'}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
  return (
    <div className="flex flex-col gap-2" onKeyDown={onKeyDown} data-testid="schema-editor-root">
      {showForm ? (
        <StructSchemaForm schema={schema} onSchema={onSchema} toolbar={hideModeToggle ? null : modeToggle} />
      ) : (
        <>
          {!hideModeToggle && <div className="flex justify-end">{modeToggle}</div>}
          <RawSchemaEditor schema={schema} onSchema={onSchema} />
        </>
      )}
    </div>
  )
}

// --- presentation ----------------------------------------------------------------------------
// The editor mirrors the reading view (explorer.tsx): a sentence for the root, a field / type
// table, colored type chips. Controls look like the text they edit and reveal their frame, and the
// secondary actions (optional, target type, remove), only on hover or focus.

/** The chip colors for a type node: its kind's color, or the reference chip for a named schema. */
function chipColor(ps: any): string {
  if (Array.isArray(ps?.anyOf)) return kindColor.union!
  const k = propKind(ps)
  if (k.startsWith('var:')) return kindColor.var!
  if (k === 'hm-url' || k === 'ipfs' || k === 'date' || k === 'date-time') return kindColor.string!
  if (k === CUSTOM_KIND) return isLiteralSchema(ps) ? kindColor.string! : refChipColor
  return kindColor[k] ?? refChipColor
}

/** Text that reads as text and edits in place: the frame appears on hover and focus. */
const InlineInput = forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(function InlineInput(
  {className, ...props},
  ref,
) {
  return (
    <input
      ref={ref}
      spellCheck={false}
      className={cn(
        'placeholder:text-muted-foreground/60 hover:bg-muted/70 focus:bg-background focus:ring-ring/40 -mx-1 [field-sizing:content] min-w-0 rounded bg-transparent px-1 outline-none focus:ring-2',
        className,
      )}
      {...props}
    />
  )
})

/** A quiet icon action with a tooltip; `reveal` keeps it hidden until its row is hovered or focused. */
function IconAction({
  label,
  tooltip,
  onClick,
  children,
  reveal,
  className,
}: {
  label: string
  tooltip: string
  onClick: () => void
  children: React.ReactNode
  reveal?: boolean
  className?: string
}) {
  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          'text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/40 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded outline-none focus-visible:ring-2',
          reveal &&
            'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100',
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

/** A quiet text-link action (+ Add field, + variant). */
function AddAction({label, onClick, children}: {label?: string; onClick: () => void; children: React.ReactNode}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground hover:bg-muted/70 inline-flex w-fit cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs"
    >
      <Plus className="size-3" />
      {children}
    </button>
  )
}

/** The type chip of a node: a picker styled like the reading view's type chip. */
function TypeChip({
  node,
  options,
  onNode,
  ariaLabel,
}: {
  node: any
  options: TypeOption[]
  onNode: (next: HypermediaSchema) => void
  ariaLabel: string
}) {
  const args = node && typeof node.args === 'object' ? Object.entries(node.args as Record<string, any>) : []
  const chip = (
    <SchemaTypeInput
      chip
      value={nodeUrl(node)}
      label={nodeLabel(node)}
      options={options}
      onChange={(url) => onNode(typeSchemaFor(url))}
      onPick={onNode}
      literals
      ariaLabel={ariaLabel}
      className={chipColor(node)}
    />
  )
  if (!args.length) return chip
  // An instantiation of a generic type names its bindings, as the reading view does (edited as JSON).
  return (
    <span className="inline-flex items-center gap-0.5">
      {chip}
      <span className="text-muted-foreground font-mono text-xs">
        ⟨
        {args
          .map(
            ([param, v]) =>
              `${param} = ${typeof v?.var === 'string' ? `⟨${v.var}⟩` : nodeLabel(v) ?? refToName(nodeUrl(v))}`,
          )
          .join(', ')}
        ⟩
      </span>
    </span>
  )
}

/** The alternatives of a union, as chips in a row: "one of [a] | [b] | [+]". */
function UnionOptionsEditor({
  schema,
  onSchema,
  options,
  ariaPrefix,
}: {
  schema: HypermediaSchema
  onSchema: (s: HypermediaSchema) => void
  options: TypeOption[]
  ariaPrefix: string
}) {
  const arms: HypermediaSchema[] = Array.isArray(schema.anyOf) ? schema.anyOf : []
  const set = (next: HypermediaSchema[]) => onSchema({...schema, anyOf: next})
  return (
    <span className="contents" data-testid="schema-union-options">
      <span className="text-muted-foreground text-xs">one of</span>
      {arms.map((arm, i) => (
        <span key={i} className="group/arm inline-flex items-center">
          {i > 0 && <span className="text-muted-foreground/60 mr-1 text-xs">|</span>}
          <TypeChip
            node={arm}
            options={options}
            onNode={(next) => set(arms.map((a, j) => (j === i ? next : a)))}
            ariaLabel={`${ariaPrefix} option ${i + 1}`}
          />
          <InlineShape
            node={arm}
            onNode={(next) => set(arms.map((a, j) => (j === i ? next : a)))}
            options={options}
            ariaPrefix={`${ariaPrefix} option ${i + 1}`}
          />
          <Tooltip content="Remove this option">
            <button
              type="button"
              aria-label={`Remove ${ariaPrefix} option ${i + 1}`}
              onClick={() => set(arms.filter((_, j) => j !== i))}
              className="text-muted-foreground hover:text-foreground w-0 cursor-pointer overflow-hidden opacity-0 transition-[width] group-focus-within/arm:w-4 group-focus-within/arm:opacity-100 group-hover/arm:w-4 group-hover/arm:opacity-100"
            >
              <X className="size-3" />
            </button>
          </Tooltip>
        </span>
      ))}
      <IconAction label="Add option" tooltip="Add an option" onClick={() => set([...arms, {type: ANY_URL}])}>
        <Plus className="size-3.5" />
      </IconAction>
    </span>
  )
}

/** What a list holds: "of [item]". */
function ListItemsEditor({
  schema,
  onSchema,
  options,
  ariaPrefix,
}: {
  schema: HypermediaSchema
  onSchema: (s: HypermediaSchema) => void
  options: TypeOption[]
  ariaPrefix: string
}) {
  const items: HypermediaSchema = schema.items ?? {type: ANY_URL}
  const setItems = (next: HypermediaSchema) => onSchema({...schema, items: next})
  return (
    <span className="contents" data-testid="schema-list-items">
      <span className="text-muted-foreground text-xs">of</span>
      <TypeChip node={items} options={options} onNode={setItems} ariaLabel={`${ariaPrefix} item type`} />
      <InlineShape node={items} onNode={setItems} options={options} ariaPrefix={`${ariaPrefix} item`} />
    </span>
  )
}

/** An inline struct or map (not a named type): its fields are edited in place. */
const isInlineStruct = (ps: any) =>
  !!ps && typeof ps === 'object' && !ps.anyOf && ['struct', 'map'].includes(kindOf(ps.type))

/** What follows a type chip on its own line: a union's options or a list's item type (recursively). */
function InlineShape({
  node,
  onNode,
  options,
  ariaPrefix,
}: {
  node: any
  onNode: (s: HypermediaSchema) => void
  options: TypeOption[]
  ariaPrefix: string
}) {
  if (Array.isArray(node?.anyOf))
    return <UnionOptionsEditor schema={node} onSchema={onNode} options={options} ariaPrefix={ariaPrefix} />
  if (kindOf(node?.type) === 'list')
    return <ListItemsEditor schema={node} onSchema={onNode} options={options} ariaPrefix={ariaPrefix} />
  return null
}

/**
 * The inline structs a type node spells out, as indented field tables beneath its row: the node
 * itself, a list's items, a union's options — each recursing, so a struct inside a struct (inside a
 * list…) is editable. Rendered outside the row's hover group, so a nested row reveals only its own
 * controls.
 */
function NestedSchemaEditor({
  node,
  onNode,
  options,
  ariaPrefix,
}: {
  node: any
  onNode: (s: HypermediaSchema) => void
  options: TypeOption[]
  ariaPrefix: string
}) {
  if (Array.isArray(node?.anyOf)) {
    const arms: HypermediaSchema[] = node.anyOf
    return (
      <>
        {arms.map((arm, i) => (
          <NestedSchemaEditor
            key={i}
            node={arm}
            onNode={(next) => onNode({...node, anyOf: arms.map((a, j) => (j === i ? next : a))})}
            options={options}
            ariaPrefix={`${ariaPrefix} option ${i + 1}`}
          />
        ))}
      </>
    )
  }
  if (kindOf(node?.type) === 'list')
    return (
      <NestedSchemaEditor
        node={node.items ?? {type: ANY_URL}}
        onNode={(next) => onNode({...node, items: next})}
        options={options}
        ariaPrefix={`${ariaPrefix} item`}
      />
    )
  if (isInlineStruct(node))
    return (
      <div className="border-border mt-1 mb-1 ml-1 border-l pl-3" data-testid="schema-nested-struct">
        <StructFieldsEditor schema={node} onSchema={onNode} options={options} path={ariaPrefix} />
      </div>
    )
  return null
}

function StructSchemaForm({
  schema,
  onSchema,
  toolbar,
}: {
  schema: HypermediaSchema
  onSchema: (s: HypermediaSchema) => void
  /** The Form/JSON switch, placed on the root sentence's line. */
  toolbar?: React.ReactNode
}) {
  const fields = structFields(schema)
  const signed = isSignedBlobType(schema)

  const setTypeTag = (tag: string) => {
    const typeField: StructField = {
      ...fields.find((f) => f.name === 'type'),
      name: 'type',
      schema: literalSchema(tag.trim() || 'Custom'),
      required: true,
    }
    const next = fields.some((f) => f.name === 'type')
      ? fields.map((f) => (f.name === 'type' ? typeField : f))
      : [...fields, typeField]
    onSchema(withFields(schema, next))
  }

  // Type parameters (`params`): a generic schema names them here and fields
  // use them as kinds (`{var: T}`). Each has a default — the schema used when an
  // instantiation binds nothing — a ref, `any` when left blank.
  const params: Record<string, any> = schema.params ?? {}
  const paramEntries = Object.entries(params)
  const setParams = (next: Record<string, any>, body: HypermediaSchema = schema) => {
    const {params: _p, ...rest} = body
    onSchema(Object.keys(next).length ? {...rest, params: next} : rest)
  }
  const addParam = () => {
    let name = 'T'
    let n = 1
    while (name in params) name = `T${++n}`
    setParams({...params, [name]: {type: ANY_URL}})
  }
  const renameParam = (from: string, to: string) => {
    const name = to.trim()
    if (!name || name === from || name in params) return
    const next: Record<string, any> = {}
    for (const [k, v] of paramEntries) next[k === from ? name : k] = v
    setParams(next, replaceVar(schema, from, name))
  }
  const setParamDefault = (name: string, ref: string) => {
    setParams({...params, [name]: {type: ref.trim() || ANY_URL}})
  }
  const removeParam = (name: string) => {
    const next = {...params}
    delete next[name]
    // Fields typed by the parameter fall back to its default.
    setParams(next, replaceVar(schema, name, params[name] ?? {type: ANY_URL}))
  }
  // What a field can be typed as, offered before the search over every schema
  // document: the type parameters, the two string formats (a kind of string
  // with a picker), and the core types. Anything else is found by searching.
  const fieldTypeOptions: TypeOption[] = [
    ...paramEntries.map(([name]) => ({label: `⟨${name}⟩`, hint: 'type parameter', schema: {var: name}})),
    unionOption(),
    {label: 'HM link', hint: 'string · hm-url', schema: kindSchema('hm-url')},
    {label: 'IPFS file / object', hint: 'string · ipfs', schema: kindSchema('ipfs')},
    // A core kind applies its canonical property schema (a list gets `items`, a
    // struct `properties`, a date its library ref) — not a bare type URL.
    ...FIELD_KINDS.filter(({kind}) => !isReferenceKind(kind)).map(({kind, label}) => ({
      label: HM_SCHEMA_PAGES[kind]?.name ?? label,
      hint: 'core type',
      schema: kindSchema(kind),
    })),
  ]

  // The root type is a type reference like any other: a primitive kind URL (map,
  // list, string…) is the schema's `type`; any other schema document is its `ref`
  // (the schema extends it). Picking the Hypermedia Blob envelope pins a type tag.
  const rootIsUnion = Array.isArray(schema.anyOf)
  const rootIsList = !rootIsUnion && kindOf(schema.type) === 'list'
  const rootUrl: string = rootIsUnion ? '' : nodeUrl(schema)
  const rootTypeOptions: TypeOption[] = [
    unionOption(),
    ...FIELD_KINDS.filter(({kind}) => !isReferenceKind(kind)).map(({kind, label}) => ({
      label: HM_SCHEMA_PAGES[kind]?.name ?? label,
      hint: 'core type',
      url: kindUrl(kind),
    })),
  ]
  const setRootType = (url: string) => {
    if (url === SIGNED_BLOB_URL) return onSchema(withRootKind(schema, 'signed'))
    const {type: _t, ref: _r, anyOf: _a, ...rest} = schema
    const kind = kindOf(url)
    if (kind !== url && kind !== 'struct' && kind !== 'map') {
      // A leaf or list root has no fields.
      const {properties: _p, values: _v, ...leaf} = rest
      return onSchema(
        kind === 'list' ? {...leaf, type: url, items: schema.items ?? {type: ANY_URL}} : {...leaf, type: url},
      )
    }
    const kept = structFields(schema).filter((f) => !(signed && f.name === 'type'))
    const base = {...rest, properties: fieldsToProperties(kept)}
    onSchema({...base, type: url})
  }
  /** A picked option carrying a schema (Union): the root becomes that shape, keeping generics and description. */
  const setRootSchema = (next: HypermediaSchema) => {
    const keep: HypermediaSchema = {}
    if (schema.params) keep.params = schema.params
    if (schema.description) keep.description = schema.description
    onSchema({...keep, ...(next.anyOf && schema.anyOf ? {...next, anyOf: schema.anyOf} : next)})
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The root, as the reading view says it: "Extends [Struct]". */}
      <div className="flex flex-wrap items-start justify-between gap-2" data-testid="schema-root-type">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            {!rootIsUnion && <span className="text-muted-foreground">Extends</span>}
            <SchemaTypeInput
              chip
              value={rootUrl}
              label={rootIsUnion ? 'Union' : undefined}
              options={rootTypeOptions}
              onChange={setRootType}
              onPick={setRootSchema}
              ariaLabel="Root type"
              placeholder="any type"
              className={rootIsUnion ? kindColor.union : chipColor(schema)}
            />
            {rootIsList && (
              <ListItemsEditor schema={schema} onSchema={onSchema} options={fieldTypeOptions} ariaPrefix="list" />
            )}
            {rootIsUnion && (
              <UnionOptionsEditor schema={schema} onSchema={onSchema} options={fieldTypeOptions} ariaPrefix="union" />
            )}
            {signed && (
              <>
                <span className="text-muted-foreground">· type tag</span>
                <Tooltip content="The tag every blob of this type carries in its `type` field">
                  <InlineInput
                    value={signedTypeTag(schema)}
                    aria-label="Type tag"
                    placeholder="e.g. Vote"
                    className="font-mono text-sm font-medium"
                    onChange={(e) => setTypeTag(e.target.value)}
                  />
                </Tooltip>
              </>
            )}
          </p>
          {/* What the schema is for — carried on the object itself, so an attributes schema a
              document owns (no page of its own) still explains itself wherever it is shown. */}
          <Textarea
            value={schema.description ?? ''}
            aria-label="Schema description"
            placeholder="Describe what this schema is for"
            rows={1}
            className="min-h-8 resize-none text-sm"
            data-testid="schema-description"
            onChange={(e) => {
              const {description: _d, ...rest} = schema
              onSchema(e.target.value.trim() ? {...rest, description: e.target.value} : rest)
            }}
          />
          {(rootIsUnion || rootIsList) && (
            <NestedSchemaEditor
              node={schema}
              onNode={onSchema}
              options={fieldTypeOptions}
              ariaPrefix={rootIsList ? 'list' : 'union'}
            />
          )}
          <div className="flex flex-wrap items-center gap-1.5 text-sm" data-testid="schema-params">
            {paramEntries.length > 0 && <span className="text-muted-foreground">Generic over</span>}
            {paramEntries.map(([name, def], index) => (
              <span
                key={index}
                className="group/row bg-muted/40 inline-flex items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2"
              >
                <span className={cn('inline-flex items-center rounded px-1 font-mono text-xs', kindColor.var)}>
                  ⟨
                  <InlineInput
                    value={name}
                    aria-label="Type parameter name"
                    className="mx-0 px-0.5 font-mono text-xs"
                    onChange={(e) => renameParam(name, e.target.value)}
                  />
                  ⟩
                </span>
                <span className="text-muted-foreground text-xs">default</span>
                <SchemaTypeInput
                  chip
                  value={namedSchemaUrl(def ?? {}) ?? ANY_URL}
                  options={FIELD_KINDS.filter(({kind}) => !isReferenceKind(kind)).map(({kind, label}) => ({
                    label: HM_SCHEMA_PAGES[kind]?.name ?? label,
                    hint: 'core type',
                    url: kindUrl(kind),
                  }))}
                  onChange={(url) => setParamDefault(name, url)}
                  ariaLabel={`Default type for ${name}`}
                  className={chipColor(def ?? {type: ANY_URL})}
                />
                <IconAction
                  label={`Remove type parameter ${name}`}
                  tooltip="Remove this type parameter"
                  onClick={() => removeParam(name)}
                  reveal
                >
                  <X className="size-3" />
                </IconAction>
              </span>
            ))}
            {paramEntries.length > 0 && (
              <IconAction label="Add type parameter" tooltip="Add a type parameter" onClick={addParam}>
                <Plus className="size-3.5" />
              </IconAction>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {paramEntries.length === 0 && (
            <IconAction
              label="Make generic (add a type parameter)"
              tooltip="Make generic — add a type parameter fields can use as their type"
              onClick={addParam}
            >
              <Variable className="size-3.5" />
            </IconAction>
          )}
          {toolbar}
        </div>
      </div>

      {!rootIsUnion && !rootIsList && (
        <StructFieldsEditor schema={schema} onSchema={onSchema} options={fieldTypeOptions} />
      )}
    </div>
  )
}

/** A schema with its fields replaced, keeping its root: a ref-rooted schema (the signed-blob envelope
 * or any base) keeps extending it; a map that gains named fields becomes a struct. */
function withFields(schema: HypermediaSchema, next: StructField[]): HypermediaSchema {
  const base = namedSchemaUrl(schema)
  const root = base ? {type: base} : {type: kindOf(schema.type) === 'map' && next.length === 0 ? MAP_URL : STRUCT_URL}
  const {type: _t, ref: _r, ...rest} = schema
  return {...rest, ...root, properties: fieldsToProperties(next)}
}

/** The shared column layout of a field row: name + description | type | accessory. */
const FIELD_ROW_GRID = 'grid grid-cols-[minmax(7rem,1fr)_minmax(0,1fr)_auto] items-start gap-x-3'

/** A reference field's target type: a "→ type" chip once set (click to edit); until then a hover action. */
function TargetTypeInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (next: string) => void
  ariaLabel: string
}) {
  const [editing, setEditing] = useState(false)
  const tooltip =
    'Target type — the schema the referenced document or object should conform to (an hm:// type document or ipfs:// schema)'
  if (!value && !editing)
    return (
      <IconAction label={`Set ${ariaLabel.toLowerCase()}`} tooltip={tooltip} onClick={() => setEditing(true)} reveal>
        <ArrowRight className="size-3.5" />
      </IconAction>
    )
  if (!editing)
    return (
      <Tooltip content={`${tooltip}. Click to change.`}>
        <button
          type="button"
          aria-label={ariaLabel}
          onClick={() => setEditing(true)}
          className="border-border text-muted-foreground hover:bg-muted inline-flex h-6 max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-md border px-1.5 font-mono text-xs"
        >
          <ArrowRight className="size-3 shrink-0" />
          <span className="truncate">{refToName(value)}</span>
        </button>
      </Tooltip>
    )
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <ArrowRight className="text-muted-foreground size-3 shrink-0" />
      <InlineInput
        value={value}
        autoFocus
        placeholder="hm:// or ipfs:// type"
        aria-label={ariaLabel}
        className="text-muted-foreground min-w-40 font-mono text-xs"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') setEditing(false)
        }}
      />
    </span>
  )
}

/**
 * The field rows of a struct — name, description, type, target, optional/required, and whatever the
 * type spells out beneath (see {@link NestedSchemaEditor}) — plus Add field and the open/closed
 * toggle. Used for the root and, recursively, for every inline struct a field declares. `path`
 * names a nested struct (e.g. `sourceBlob`) so its controls stay distinguishable; absent at the root.
 */
function StructFieldsEditor({
  schema,
  onSchema,
  options,
  path,
}: {
  schema: HypermediaSchema
  onSchema: (s: HypermediaSchema) => void
  options: TypeOption[]
  path?: string
}) {
  const fields = structFields(schema)
  const signed = !path && isSignedBlobType(schema)
  const commitFields = (next: StructField[]) => onSchema(withFields(schema, next))
  const field = (name: string) => fields.find((f) => f.name === name)
  /** The fields with one replaced (or, when `next` is null, removed). */
  const withField = (name: string, next: StructField | null): StructField[] =>
    next === null ? fields.filter((f) => f.name !== name) : fields.map((f) => (f.name === name ? next : f))
  const update = (name: string, patch: Partial<StructField>) => {
    const f = field(name)
    if (f) commitFields(withField(name, {...f, ...patch}))
  }
  const renameField = (oldName: string, newName: string) => {
    if (newName === oldName || field(newName)) return
    update(oldName, {name: newName})
  }
  // A reference field (HM link / IPFS) may name the type its target should
  // conform to — this is how one type points at another (character.home → place).
  const setFieldTarget = (name: string, target: string) => {
    const {target: _old, ...rest} = field(name)?.schema ?? {}
    update(name, {schema: target.trim() ? {...rest, target: target.trim()} : rest})
  }
  const addField = () => {
    let n = 1
    let name = 'field'
    while (field(name)) name = `field${++n}`
    // A new field is required until unchecked: most fields a type names are ones every value has.
    commitFields([...fields, {name, schema: kindSchema('string'), required: true}])
  }

  // `values`: the schema every field NOT listed above must satisfy. Present, the
  // struct is open (extra fields allowed, typed); absent, it is closed.
  const values: any = schema.values
  const setValues = (next: HypermediaSchema | null) => {
    const {values: _v, ...rest} = schema
    onSchema(next ? {...rest, values: next} : rest)
  }
  /** How a control is named: bare at the root, qualified by the struct's path when nested. */
  const q = (name: string) => (path ? `${path}.${name}` : name)
  const visible = fields.filter((f) => !(signed && f.name === 'type'))

  return (
    <div className="flex flex-col">
      {visible.length === 0 && <p className="text-muted-foreground py-2 text-sm">No fields yet.</p>}
      {visible.map(({name, schema: ps, required, description}, index) => (
        // Stable index key: renaming changes the property name but not the
        // row's identity, so the (controlled) name input never remounts and
        // keeps focus while typing.
        <div key={index} className="border-border/50 border-b py-1.5 last:border-0">
          <div className={cn(FIELD_ROW_GRID, 'group/row')}>
            <div className="flex min-w-0 flex-col">
              <InlineInput
                value={name}
                className="font-mono text-sm"
                aria-label={path ? `Field name in ${path}` : 'Field name'}
                onChange={(e) => renameField(name, e.target.value)}
              />
              <textarea
                rows={1}
                spellCheck={false}
                value={description ?? ''}
                placeholder="Add a description"
                aria-label={`Description of ${q(name)}`}
                className={cn(
                  'placeholder:text-muted-foreground/60 hover:bg-muted/70 focus:bg-background focus:ring-ring/40 text-muted-foreground -mx-1 [field-sizing:content] resize-none rounded bg-transparent px-1 text-xs outline-none focus:ring-2',
                )}
                // Not trimmed while typing: a controlled input would swallow every trailing space.
                onChange={(e) => update(name, {description: e.target.value.trim() ? e.target.value : undefined})}
              />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <TypeChip
                node={ps}
                options={options}
                onNode={(next) => update(name, {schema: next})}
                ariaLabel={`Type of ${q(name)}`}
              />
              {isReferenceKind(propKind(ps)) && (
                <TargetTypeInput
                  value={typeof ps?.target === 'string' ? ps.target : ''}
                  onChange={(t) => setFieldTarget(name, t)}
                  ariaLabel={`Target type for ${q(name)}`}
                />
              )}
              <InlineShape
                node={ps}
                onNode={(next) => update(name, {schema: next})}
                options={options}
                ariaPrefix={q(name)}
              />
            </div>
            <div className="flex items-center gap-0.5">
              <Tooltip
                content={
                  required
                    ? 'Required — every value includes this field. Click to make it optional.'
                    : 'Optional — a value may leave this field out. Click to require it.'
                }
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={required}
                  aria-label={`Required ${q(name)}`}
                  onClick={() => update(name, {required: !required})}
                  className={cn(
                    'hover:bg-muted focus-visible:ring-ring/40 cursor-pointer rounded px-1 py-0.5 text-xs outline-none focus-visible:ring-2',
                    required
                      ? 'text-muted-foreground/70 opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100'
                      : 'text-muted-foreground',
                  )}
                >
                  {required ? 'required' : 'optional'}
                </button>
              </Tooltip>
              <IconAction
                label={`Remove ${q(name)}`}
                tooltip="Remove this field"
                onClick={() => commitFields(withField(name, null))}
                reveal
              >
                <X className="size-3.5" />
              </IconAction>
            </div>
          </div>
          <NestedSchemaEditor
            node={ps}
            onNode={(next) => update(name, {schema: next})}
            options={options}
            ariaPrefix={q(name)}
          />
        </div>
      ))}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1.5"
        data-testid={path ? `schema-values-${path}` : 'schema-values'}
      >
        <AddAction label={path ? `Add field to ${path}` : undefined} onClick={addField}>
          Add field
        </AddAction>
        <span className="text-muted-foreground/50 text-xs">·</span>
        <Tooltip
          content={
            values !== undefined
              ? 'Open — fields other than these are allowed, with the type given. Click to close.'
              : 'Closed — only these fields are allowed. Click to allow other fields.'
          }
        >
          <button
            type="button"
            aria-pressed={values !== undefined}
            aria-label={path ? `Other fields allowed in ${path}` : 'Other fields allowed'}
            onClick={() => setValues(values !== undefined ? null : {type: ANY_URL})}
            className="text-muted-foreground hover:text-foreground hover:bg-muted/70 inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs"
          >
            {values !== undefined ? <LockOpen className="size-3" /> : <Lock className="size-3" />}
            {values !== undefined ? 'open' : 'closed'}
          </button>
        </Tooltip>
        {values !== undefined && (
          <span className="inline-flex items-center gap-1">
            <span className="text-muted-foreground text-xs">other fields are</span>
            <TypeChip
              node={values}
              options={options}
              onNode={setValues}
              ariaLabel={path ? `Type of other fields in ${path}` : 'Type of other fields'}
            />
          </span>
        )}
      </div>
    </div>
  )
}

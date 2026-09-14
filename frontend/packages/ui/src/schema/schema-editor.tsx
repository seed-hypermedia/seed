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
import {Plus, X} from 'lucide-react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {Button} from '../button'
import {Checkbox} from '../components/checkbox'
import {Input} from '../components/input'
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
  nameToUrl,
  refToName,
  structFields,
  validate,
} from './engine'
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
  const refName = typeof ps?.ref === 'string' ? refToName(ps.ref) : null
  if (ps?.format === 'hm-url' || refName === 'hm-url') return 'hm-url'
  if (ps?.format === 'ipfs-url' || ps?.format === 'ipfs' || refName === 'ipfs-url') return 'ipfs'
  if (ps?.format === 'date' || refName === 'date') return 'date'
  if (ps?.format === 'date-time' || refName === 'date-time') return 'date-time'
  if (refName === 'any') return 'any'
  if (isLiteralSchema(ps) || ps?.anyOf || ps?.args) return CUSTOM_KIND
  if (ps?.type) return kindOf(ps.type)
  if (refName && KINDS.includes(refName.replace(/^hypermedia-/, ''))) return refName.replace(/^hypermedia-/, '')
  if (refName) return CUSTOM_KIND
  return 'string'
}

/** What to call a custom field's type: its ref's name, or its shape. */
function customLabel(ps: any): string {
  if (isLiteralSchema(ps)) return JSON.stringify(literalValue(ps))
  if (typeof ps?.ref === 'string') return refToName(ps.ref)
  if (ps?.anyOf) return `one of ${ps.anyOf.length}`
  return 'custom'
}

/** Whether the struct form can show (and safely rewrite) this schema. */
export function structFormFits(schema: HypermediaSchema): boolean {
  if (isLiteralSchema(schema) || schema.args) return false
  if (Array.isArray(schema.anyOf)) return true
  if (schema.type) return ['struct', 'map', 'list'].includes(kindOf(schema.type))
  return typeof schema.ref === 'string'
}

/** A union, offered to fields and to the root alike; the picked entry starts with one open option. */
const unionOption = (): TypeOption => ({
  label: 'Union',
  hint: 'one of several types',
  schema: {anyOf: [{ref: ANY_URL}]},
})

/** The schema a picked type URL stands for: a core type is `type`, any other schema document `ref`. */
const typeSchemaFor = (url: string): HypermediaSchema => (kindOf(url) !== url ? {type: url} : {ref: url})
/** The type URL a schema node names (its ref or type), '' for a union, a format or a parameter. */
const nodeUrl = (ps: any): string =>
  typeof ps?.ref === 'string' ? ps.ref : typeof ps?.type === 'string' ? ps.type : ''
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
  if (kind === 'any') return {ref: ANY_URL}
  if (kind === 'hm-url') return {type: kindUrl('string'), format: 'hm-url'}
  if (kind === 'ipfs') return {type: kindUrl('string'), format: 'ipfs-url'}
  // The built-in date types are includes of the library schemas, which carry
  // the format (→ a date picker) and the pattern (→ validation).
  if (kind === 'date') return {ref: nameToUrl('date')!}
  if (kind === 'date-time') return {ref: nameToUrl('date-time')!}
  if (kind === 'list') return {type: kindUrl('list'), items: {ref: ANY_URL}}
  if (kind === 'struct') return {type: STRUCT_URL, properties: {}}
  if (kind === 'map') return {type: MAP_URL, values: {ref: ANY_URL}}
  return {type: kindUrl(kind)}
}

/** The `any` schema: what a type parameter defaults to when nothing narrower is given. */
const ANY_URL = nameToUrl('any')!
/** The signed-blob envelope every Hypermedia blob extends. */
const SIGNED_BLOB_URL = nameToUrl('blob')!
/** True when the schema extends the signed-blob envelope. */
export const isSignedBlobType = (schema: HypermediaSchema) => !schema.type && schema.ref === SIGNED_BLOB_URL
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
    return {...rest, ref: SIGNED_BLOB_URL, properties: fieldsToProperties(withTag)}
  }
  if (kind === 'struct') return {...rest, type: STRUCT_URL, properties: fieldsToProperties(fields)}
  const baseRef = !schema.type && typeof schema.ref === 'string' && schema.ref !== SIGNED_BLOB_URL ? schema.ref : ''
  return {...rest, ref: baseRef, properties: fieldsToProperties(fields)}
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
    <div className="flex items-center gap-1 self-end" role="tablist" aria-label="Schema editor mode">
      {(['form', 'json'] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={showForm ? m === 'form' : m === 'json'}
          disabled={m === 'form' && !fits}
          title={
            m === 'form' && !fits ? 'This shape (union, list, open map, instantiation) is edited as JSON' : undefined
          }
          onClick={() => setMode(m)}
          className={cn(
            'rounded px-2 py-0.5 text-xs',
            (showForm ? m === 'form' : m === 'json') ? 'bg-muted text-foreground' : 'text-muted-foreground',
            m === 'form' && !fits ? 'cursor-not-allowed opacity-50' : 'hover:text-foreground cursor-pointer',
          )}
        >
          {m === 'form' ? 'Form' : 'JSON'}
        </button>
      ))}
    </div>
  )
  return (
    <div className="flex flex-col gap-2" onKeyDown={onKeyDown} data-testid="schema-editor-root">
      {!hideModeToggle && modeToggle}
      {showForm ? (
        <StructSchemaForm schema={schema} onSchema={onSchema} />
      ) : (
        <RawSchemaEditor schema={schema} onSchema={onSchema} />
      )}
    </div>
  )
}

/** The alternatives of a union, each a type of its own. */
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
    <div className="flex basis-full flex-col gap-1.5 pl-4" data-testid="schema-union-options">
      <label className="text-muted-foreground text-xs font-medium">One of</label>
      {arms.map((arm, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <SchemaTypeInput
            value={nodeUrl(arm)}
            label={nodeLabel(arm)}
            options={options}
            onChange={(url) => set(arms.map((a, j) => (j === i ? typeSchemaFor(url) : a)))}
            onPick={(next) => set(arms.map((a, j) => (j === i ? next : a)))}
            ariaLabel={`${ariaPrefix} option ${i + 1}`}
            className="w-56"
          />
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={`Remove ${ariaPrefix} option ${i + 1}`}
            onClick={() => set(arms.filter((_, j) => j !== i))}
          >
            <X className="size-4" />
          </Button>
          <NestedSchemaEditor
            node={arm}
            onNode={(next) => set(arms.map((a, j) => (j === i ? next : a)))}
            options={options}
            ariaPrefix={`${ariaPrefix} option ${i + 1}`}
          />
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground w-fit gap-1 text-xs"
        onClick={() => set([...arms, {ref: ANY_URL}])}
      >
        <Plus className="size-3.5" /> Add option
      </Button>
    </div>
  )
}

/** What a list holds. */
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
  const items: HypermediaSchema = schema.items ?? {ref: ANY_URL}
  return (
    <div className="flex basis-full flex-wrap items-center gap-2 pl-4" data-testid="schema-list-items">
      <span className="text-muted-foreground text-xs">of</span>
      <SchemaTypeInput
        value={nodeUrl(items)}
        label={nodeLabel(items)}
        options={options}
        onChange={(url) => onSchema({...schema, items: typeSchemaFor(url)})}
        onPick={(next) => onSchema({...schema, items: next})}
        ariaLabel={`${ariaPrefix} item type`}
        className="w-56"
      />
      <NestedSchemaEditor
        node={items}
        onNode={(next) => onSchema({...schema, items: next})}
        options={options}
        ariaPrefix={`${ariaPrefix} item`}
      />
    </div>
  )
}

/** An inline struct or map (not a named type): its fields are edited in place. */
const isInlineStruct = (ps: any) =>
  !!ps && typeof ps === 'object' && !ps.anyOf && ['struct', 'map'].includes(kindOf(ps.type))

/**
 * What a type node spells out beneath its type picker: a union's options, a list's item type, or an
 * inline struct's fields — each recursing, so a struct inside a struct (inside a list…) is editable.
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
  if (Array.isArray(node?.anyOf))
    return <UnionOptionsEditor schema={node} onSchema={onNode} options={options} ariaPrefix={ariaPrefix} />
  if (kindOf(node?.type) === 'list')
    return <ListItemsEditor schema={node} onSchema={onNode} options={options} ariaPrefix={ariaPrefix} />
  if (isInlineStruct(node))
    return (
      <div className="border-border flex basis-full flex-col gap-1 border-l pl-3" data-testid="schema-nested-struct">
        <StructFieldsEditor schema={node} onSchema={onNode} options={options} path={ariaPrefix} />
      </div>
    )
  return null
}

function StructSchemaForm({schema, onSchema}: {schema: HypermediaSchema; onSchema: (s: HypermediaSchema) => void}) {
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
    setParams({...params, [name]: {ref: ANY_URL}})
  }
  const renameParam = (from: string, to: string) => {
    const name = to.trim()
    if (!name || name === from || name in params) return
    const next: Record<string, any> = {}
    for (const [k, v] of paramEntries) next[k === from ? name : k] = v
    setParams(next, replaceVar(schema, from, name))
  }
  const setParamDefault = (name: string, ref: string) => {
    setParams({...params, [name]: {ref: ref.trim() || ANY_URL}})
  }
  const removeParam = (name: string) => {
    const next = {...params}
    delete next[name]
    // Fields typed by the parameter fall back to its default.
    setParams(next, replaceVar(schema, name, params[name] ?? {ref: ANY_URL}))
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
        kind === 'list' ? {...leaf, type: url, items: schema.items ?? {ref: ANY_URL}} : {...leaf, type: url},
      )
    }
    const kept = structFields(schema).filter((f) => !(signed && f.name === 'type'))
    const base = {...rest, properties: fieldsToProperties(kept)}
    onSchema(kind !== url ? {...base, type: url} : {...base, ref: url})
  }
  /** A picked option carrying a schema (Union): the root becomes that shape, keeping generics and description. */
  const setRootSchema = (next: HypermediaSchema) => {
    const keep: HypermediaSchema = {}
    if (schema.params) keep.params = schema.params
    if (schema.description) keep.description = schema.description
    onSchema({...keep, ...(next.anyOf && schema.anyOf ? {...next, anyOf: schema.anyOf} : next)})
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1" data-testid="schema-root-type">
        <label className="text-muted-foreground text-xs font-medium">Type</label>
        <div className="flex flex-wrap items-center gap-2">
          <SchemaTypeInput
            value={rootUrl}
            label={rootIsUnion ? 'Union' : undefined}
            options={rootTypeOptions}
            onChange={setRootType}
            onPick={setRootSchema}
            ariaLabel="Root type"
            className="w-56"
          />
          {rootIsList && (
            <ListItemsEditor schema={schema} onSchema={onSchema} options={fieldTypeOptions} ariaPrefix="list" />
          )}
          {signed && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">type tag</span>
              <Input
                value={signedTypeTag(schema)}
                aria-label="Type tag"
                placeholder="e.g. Vote"
                className="w-48 font-mono text-sm"
                onChange={(e) => setTypeTag(e.target.value)}
              />
            </div>
          )}
        </div>
        {rootIsUnion && (
          <UnionOptionsEditor schema={schema} onSchema={onSchema} options={fieldTypeOptions} ariaPrefix="union" />
        )}
      </div>

      {
        <div className="flex flex-col gap-1" data-testid="schema-params">
          {paramEntries.length > 0 && (
            <>
              <label className="text-muted-foreground text-xs font-medium">Type parameters</label>
              <div className="flex flex-col gap-1.5">
                {paramEntries.map(([name, def], index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">⟨</span>
                    <Input
                      value={name}
                      aria-label="Type parameter name"
                      className="w-32 font-mono text-sm"
                      onChange={(e) => renameParam(name, e.target.value)}
                    />
                    <span className="text-muted-foreground text-xs">⟩ default</span>
                    <Input
                      value={typeof def?.ref === 'string' && def.ref !== ANY_URL ? def.ref : ''}
                      aria-label={`Default type for ${name}`}
                      placeholder="any (or an hm:// / ipfs:// type)"
                      className="min-w-64 flex-1 font-mono text-xs"
                      onChange={(e) => setParamDefault(name, e.target.value)}
                    />
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`Remove type parameter ${name}`}
                      onClick={() => removeParam(name)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
          <Button variant="ghost" size="sm" className="text-muted-foreground w-fit gap-1 text-xs" onClick={addParam}>
            <Plus className="size-3.5" />{' '}
            {paramEntries.length ? 'Add type parameter' : 'Make generic (add a type parameter)'}
          </Button>
        </div>
      }

      {!rootIsUnion && !rootIsList && (
        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground text-xs font-medium">Fields</label>
          <StructFieldsEditor schema={schema} onSchema={onSchema} options={fieldTypeOptions} />
        </div>
      )}
    </div>
  )
}

/** A schema with its fields replaced, keeping its root: a ref-rooted schema (the signed-blob envelope
 * or any base) keeps extending it; a map that gains named fields becomes a struct. */
function withFields(schema: HypermediaSchema, next: StructField[]): HypermediaSchema {
  const root =
    !schema.type && typeof schema.ref === 'string'
      ? {ref: schema.ref}
      : {type: kindOf(schema.type) === 'map' && next.length === 0 ? MAP_URL : STRUCT_URL}
  const {type: _t, ref: _r, ...rest} = schema
  return {...rest, ...root, properties: fieldsToProperties(next)}
}

/**
 * The field rows of a struct — name, type, target, required, description, and whatever the type
 * spells out beneath (see {@link NestedSchemaEditor}) — plus Add field and the open-struct toggle.
 * Used for the root and, recursively, for every inline struct a field declares. `path` names a
 * nested struct (e.g. `sourceBlob`) so its controls stay distinguishable; absent at the root.
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
    commitFields([...fields, {name, schema: kindSchema('string'), required: false}])
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
    <>
      <div className="flex flex-col gap-1.5">
        {visible.length === 0 && <p className="text-muted-foreground text-sm">No fields yet.</p>}
        {visible.map(({name, schema: ps, required, description}, index) => (
          // Stable index key: renaming changes the property name but not the
          // row's identity, so the (controlled) name input never remounts and
          // keeps focus while typing.
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Input
              value={name}
              className="flex-1 font-mono text-sm"
              aria-label={path ? `Field name in ${path}` : 'Field name'}
              onChange={(e) => renameField(name, e.target.value)}
            />
            <SchemaTypeInput
              value={nodeUrl(ps)}
              label={nodeLabel(ps)}
              options={options}
              onChange={(url) => update(name, {schema: typeSchemaFor(url)})}
              onPick={(next) => update(name, {schema: next})}
              ariaLabel={`Type of ${q(name)}`}
              className="w-44 shrink-0"
            />
            {isReferenceKind(propKind(ps)) && (
              <Tooltip content="Target type — the schema the referenced document or object should conform to (an hm:// type document or ipfs:// schema). Optional.">
                <Input
                  value={typeof ps?.target === 'string' ? ps.target : ''}
                  placeholder="target type (hm:// or ipfs://)"
                  aria-label={`Target type for ${q(name)}`}
                  className="w-52 shrink-0 font-mono text-xs"
                  onChange={(e) => setFieldTarget(name, e.target.value)}
                />
              </Tooltip>
            )}
            <Tooltip content="Required — a value of this type must include this field">
              <label className="text-muted-foreground flex shrink-0 cursor-pointer items-center gap-1 text-xs">
                <Checkbox
                  checked={required}
                  aria-label={path ? `Required ${q(name)}` : undefined}
                  onCheckedChange={(on) => update(name, {required: on === true})}
                />
                required
              </label>
            </Tooltip>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={`Remove ${q(name)}`}
              onClick={() => commitFields(withField(name, null))}
            >
              <X className="size-4" />
            </Button>
            <Input
              value={description ?? ''}
              placeholder="description"
              aria-label={`Description of ${q(name)}`}
              className="text-muted-foreground basis-full text-xs"
              onChange={(e) => update(name, {description: e.target.value.trim() || undefined})}
            />
            <NestedSchemaEditor
              node={ps}
              onNode={(next) => update(name, {schema: next})}
              options={options}
              ariaPrefix={q(name)}
            />
          </div>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-1 w-fit gap-1"
        aria-label={path ? `Add field to ${path}` : undefined}
        onClick={addField}
      >
        <Plus className="size-4" /> Add field
      </Button>
      <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="schema-values">
        <Tooltip content="Open struct — fields other than the ones above are allowed, and must have this kind">
          <label className="text-muted-foreground flex cursor-pointer items-center gap-1 text-xs">
            <Checkbox
              checked={values !== undefined}
              aria-label={path ? `Other fields allowed in ${path}` : undefined}
              onCheckedChange={(on) => setValues(on === true ? {ref: ANY_URL} : null)}
            />
            other fields allowed
          </label>
        </Tooltip>
        {values !== undefined && (
          <SchemaTypeInput
            value={nodeUrl(values)}
            label={nodeLabel(values)}
            options={options}
            onChange={(url) => setValues(typeSchemaFor(url))}
            onPick={(next) => setValues(next)}
            ariaLabel={path ? `Type of other fields in ${path}` : 'Type of other fields'}
            className="w-44 shrink-0"
          />
        )}
      </div>
    </>
  )
}

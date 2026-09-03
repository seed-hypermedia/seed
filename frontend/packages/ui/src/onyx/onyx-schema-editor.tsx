// A purpose-built GUI for authoring an Onyx schema — presented as a struct (a
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
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '../select-dropdown'
import {Tooltip} from '../tooltip'
import {cn} from '../utils'
import {kindOf, kindUrl, MAP_URL, nameToUrl, ONYX_SCHEMAS, refToName, validate, type OnyxSchema} from './onyx-engine'
import {SchemaTypeInput} from './schema-type-input'

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
  {kind: 'map', label: 'Object'},
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
  if (ps?.format === 'hm-url' || refName === 'hypermedia-hm-url') return 'hm-url'
  if (ps?.format === 'ipfs' || refName === 'hypermedia-ipfs') return 'ipfs'
  if (ps?.format === 'date' || refName === 'onyx-date') return 'date'
  if (ps?.format === 'date-time' || refName === 'onyx-date-time') return 'date-time'
  if (refName === 'onyx-any') return 'any'
  if (ps?.anyOf || ps?.args || ps?.enum) return CUSTOM_KIND
  if (ps?.type) return kindOf(ps.type)
  if (refName?.startsWith('onyx-')) return refName.slice(5)
  if (refName) return CUSTOM_KIND
  return 'string'
}

/** What to call a custom field's type: its ref's name, or its shape. */
function customLabel(ps: any): string {
  if (typeof ps?.ref === 'string') return refToName(ps.ref)
  if (ps?.anyOf) return `one of ${ps.anyOf.length}`
  if (ps?.enum) return 'enum'
  return 'custom'
}

/** Whether the struct form can show (and safely rewrite) this schema. */
export function structFormFits(schema: OnyxSchema): boolean {
  if (schema.anyOf || schema.items || schema.enum || schema.args) return false
  if (schema.type) return kindOf(schema.type) === 'map'
  return typeof schema.ref === 'string'
}

/** Every `{var: from}` in a schema renamed to `to` (or replaced by `to` when it is an object). */
function replaceVar(node: any, from: string, to: string | OnyxSchema): any {
  if (Array.isArray(node)) return node.map((n) => replaceVar(n, from, to))
  if (!node || typeof node !== 'object') return node
  if (node.var === from && Object.keys(node).length === 1) return typeof to === 'string' ? {var: to} : to
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(node)) out[k] = replaceVar(v, from, to)
  return out
}

/** The property schema for a chosen kind. */
function kindSchema(kind: string): OnyxSchema {
  if (kind.startsWith('var:')) return {var: kind.slice(4)}
  if (kind === 'any') return {ref: ANY_URL}
  if (kind === 'hm-url') return {type: kindUrl('string'), format: 'hm-url'}
  if (kind === 'ipfs') return {type: kindUrl('string'), format: 'ipfs'}
  // The built-in date types are includes of the library schemas, which carry
  // the format (→ a date picker) and the pattern (→ validation).
  if (kind === 'date') return {ref: nameToUrl('onyx-date')!}
  if (kind === 'date-time') return {ref: nameToUrl('onyx-date-time')!}
  if (kind === 'list') return {type: kindUrl('list'), items: {}}
  if (kind === 'map') return {type: MAP_URL, values: {}}
  return {type: kindUrl(kind)}
}

/** The `any` schema: what a type parameter defaults to when nothing narrower is given. */
const ANY_URL = nameToUrl('onyx-any')!
/** The signed-blob envelope every Hypermedia blob extends. */
const SIGNED_BLOB_URL = nameToUrl('hypermedia-blob')!
/** True when the schema extends the signed-blob envelope. */
export const isSignedBlobType = (schema: OnyxSchema) => !schema.type && schema.ref === SIGNED_BLOB_URL
/** The pinned `type` tag of a signed-blob schema ('' when none). */
const signedTypeTag = (schema: OnyxSchema): string => {
  const t = schema.properties?.type
  return t && Array.isArray(t.enum) && typeof t.enum[0] === 'string' ? t.enum[0] : ''
}

/** Kinds whose value references something else, and so may carry a `target` type. */
const isReferenceKind = (kind: string) => kind === 'hm-url' || kind === 'ipfs'

/** An empty starter struct schema. */
export const emptyStructSchema = (): OnyxSchema => ({type: MAP_URL, properties: {}, required: []})

/** What a schema's root can be: a plain struct, the signed-blob envelope, or an extension of any base type. */
export type SchemaRootKind = 'struct' | 'signed' | 'extends'

/**
 * The schema rewritten with a new root kind, fields preserved. Signed pins a `type` tag (kept if
 * already set, else "Custom"); leaving signed drops the pinned tag; `extends` keeps an existing
 * non-envelope base ref (or starts blank, for the user to paste any base).
 */
export function withRootKind(schema: OnyxSchema, kind: SchemaRootKind): OnyxSchema {
  const properties: Record<string, any> = {...(schema.properties ?? {})}
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
  const {type: _t, ref: _r, ...rest} = schema
  if (kind === 'signed') {
    const tag = signedTypeTag(schema) || 'Custom'
    properties.type = {type: kindUrl('string'), enum: [tag]}
    required.add('type')
    return {...rest, ref: SIGNED_BLOB_URL, properties, required: Array.from(required)}
  }
  if (isSignedBlobType(schema)) {
    delete properties.type
    required.delete('type')
  }
  if (kind === 'struct') return {...rest, type: MAP_URL, properties, required: Array.from(required)}
  const baseRef = !schema.type && typeof schema.ref === 'string' && schema.ref !== SIGNED_BLOB_URL ? schema.ref : ''
  return {...rest, ref: baseRef, properties, required: Array.from(required)}
}

/** The raw schema as JSON, for shapes the form does not cover. Syntax errors block the commit;
 * meta-schema violations are advisory, like everywhere else in the editors. */
function RawSchemaEditor({schema, onSchema}: {schema: OnyxSchema; onSchema: (s: OnyxSchema) => void}) {
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
    const meta = ONYX_SCHEMAS['onyx-schema']
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
function useSchemaHistory(schema: OnyxSchema, onSchema: (s: OnyxSchema) => void) {
  const past = useRef<OnyxSchema[]>([])
  const future = useRef<OnyxSchema[]>([])
  const lastEditAt = useRef(0)
  const change = (next: OnyxSchema) => {
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

export function OnyxSchemaEditor({
  schema,
  onSchema: onSchemaProp,
  hideModeToggle,
}: {
  schema: OnyxSchema
  onSchema: (s: OnyxSchema) => void
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
          {m === 'form' ? 'Fields' : 'JSON'}
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

function StructSchemaForm({schema, onSchema}: {schema: OnyxSchema; onSchema: (s: OnyxSchema) => void}) {
  const properties: Record<string, any> = schema.properties ?? {}
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
  const entries = Object.entries(properties)
  const signed = isSignedBlobType(schema)

  const commit = (nextProps: Record<string, any>, nextRequired: Set<string>) => {
    // Drop required entries whose field no longer exists.
    const req = Array.from(nextRequired).filter((k) => k in nextProps)
    // A ref-rooted schema EXTENDS something — the signed-blob envelope or any base schema (the
    // "Extend Schema" flow). Editing fields must never silently drop that root.
    const root = !schema.type && typeof schema.ref === 'string' ? {ref: schema.ref} : {type: MAP_URL}
    const {type: _t, ref: _r, ...rest} = schema
    onSchema({...rest, ...root, properties: nextProps, ...(req.length ? {required: req} : {required: []})})
  }
  const setTypeTag = (tag: string) => {
    commit(
      {...properties, type: {type: kindUrl('string'), enum: [tag.trim() || 'Custom']}},
      new Set(Array.from(required).concat('type')),
    )
  }
  const renameField = (oldName: string, newName: string) => {
    if (newName === oldName || newName in properties) return
    // Preserve order while renaming the key.
    const nextProps: Record<string, any> = {}
    for (const [k, v] of entries) nextProps[k === oldName ? newName : k] = v
    const nextRequired = new Set(required)
    if (nextRequired.delete(oldName)) nextRequired.add(newName)
    commit(nextProps, nextRequired)
  }
  const setFieldKind = (name: string, kind: string) => commit({...properties, [name]: kindSchema(kind)}, required)
  // A reference field (HM link / IPFS) may name the type its target should
  // conform to — this is how one type points at another (character.home → place).
  const setFieldTarget = (name: string, target: string) => {
    const {target: _old, ...rest} = properties[name] ?? {}
    commit({...properties, [name]: target.trim() ? {...rest, target: target.trim()} : rest}, required)
  }
  const setRequired = (name: string, on: boolean) => {
    const next = new Set(required)
    if (on) next.add(name)
    else next.delete(name)
    commit(properties, next)
  }
  const removeField = (name: string) => {
    const nextProps = {...properties}
    delete nextProps[name]
    const next = new Set(required)
    next.delete(name)
    commit(nextProps, next)
  }
  const addField = () => {
    let n = 1
    let name = 'field'
    while (name in properties) name = `field${++n}`
    commit({...properties, [name]: kindSchema('string')}, required)
  }

  // Type parameters (`params`): a generic schema names them here and fields
  // use them as kinds (`{var: T}`). Each has a default — the schema used when an
  // instantiation binds nothing — a ref, `any` when left blank.
  const params: Record<string, any> = schema.params ?? {}
  const paramEntries = Object.entries(params)
  const setParams = (next: Record<string, any>, body: OnyxSchema = schema) => {
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
  const fieldKinds = [...FIELD_KINDS, ...paramEntries.map(([name]) => ({kind: varKind(name), label: `⟨${name}⟩`}))]

  // `values`: the schema every field NOT listed above must satisfy. Present, the
  // struct is open (extra fields allowed, typed); absent, it is closed.
  const values: any = schema.values
  const setValues = (next: OnyxSchema | null) => {
    const {values: _v, ...rest} = schema
    onSchema(next ? {...rest, values: next} : rest)
  }

  // The root type is a type reference like any other: a primitive kind URL (map,
  // list, string…) is the schema's `type`; any other schema document is its `ref`
  // (the schema extends it). Picking the Hypermedia Blob envelope pins a type tag.
  const rootUrl: string =
    typeof schema.type === 'string' ? schema.type : typeof schema.ref === 'string' ? schema.ref : ''
  const setRootType = (url: string) => {
    if (url === SIGNED_BLOB_URL) return onSchema(withRootKind(schema, 'signed'))
    const {type: _t, ref: _r, ...rest} = schema
    const props: Record<string, any> = {...(rest.properties ?? {})}
    const req = new Set<string>(Array.isArray(rest.required) ? rest.required : [])
    if (signed) {
      delete props.type
      req.delete('type')
    }
    const base = {...rest, properties: props, required: Array.from(req)}
    onSchema(kindOf(url) !== url ? {...base, type: url} : {...base, ref: url})
  }
  // A field whose type is being picked from the search (no kind chosen yet).
  const [pickingField, setPickingField] = useState<string | null>(null)
  const setFieldType = (name: string, url: string) => {
    setPickingField(null)
    commit({...properties, [name]: kindOf(url) !== url ? {type: url} : {ref: url}}, required)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1" data-testid="schema-root-type">
        <label className="text-muted-foreground text-xs font-medium">Type</label>
        <div className="flex flex-wrap items-center gap-2">
          <SchemaTypeInput value={rootUrl} onChange={setRootType} ariaLabel="Root type" className="w-56" />
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

      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">Fields</label>
        <div className="flex flex-col gap-1.5">
          {entries.length === 0 && <p className="text-muted-foreground text-sm">No fields yet.</p>}
          {entries
            .filter(([name]) => !(signed && name === 'type'))
            .map(([name, ps], index) => (
              // Stable index key: renaming changes the property name but not the
              // row's identity, so the (controlled) name input never remounts and
              // keeps focus while typing.
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={name}
                  className="flex-1 font-mono text-sm"
                  aria-label="Field name"
                  onChange={(e) => renameField(name, e.target.value)}
                />
                {propKind(ps) === CUSTOM_KIND || pickingField === name ? (
                  <SchemaTypeInput
                    value={
                      pickingField === name
                        ? ''
                        : typeof ps?.ref === 'string'
                          ? ps.ref
                          : typeof ps?.type === 'string'
                            ? ps.type
                            : ''
                    }
                    onChange={(url) => setFieldType(name, url)}
                    ariaLabel={`Type of ${name}`}
                    placeholder={pickingField === name ? 'search types…' : customLabel(ps)}
                    className="w-44 shrink-0"
                  />
                ) : null}
                <Select
                  value={propKind(ps) === CUSTOM_KIND ? CUSTOM_KIND : pickingField === name ? 'pick' : propKind(ps)}
                  onValueChange={(kind) => {
                    if (kind === 'pick') return setPickingField(name)
                    setPickingField(null)
                    setFieldKind(name, kind)
                  }}
                >
                  <SelectTrigger className="w-36 shrink-0" aria-label={`Kind of ${name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {propKind(ps) === CUSTOM_KIND && (
                      <SelectItem value={CUSTOM_KIND} disabled>
                        {customLabel(ps)}
                      </SelectItem>
                    )}
                    {fieldKinds.map(({kind, label}) => (
                      <SelectItem key={kind} value={kind}>
                        {label}
                      </SelectItem>
                    ))}
                    <SelectItem value="pick">Other type…</SelectItem>
                  </SelectContent>
                </Select>
                {isReferenceKind(propKind(ps)) && (
                  <Tooltip content="Target type — the schema the referenced document or object should conform to (an hm:// type document or ipfs:// schema). Optional.">
                    <Input
                      value={typeof ps?.target === 'string' ? ps.target : ''}
                      placeholder="target type (hm:// or ipfs://)"
                      aria-label={`Target type for ${name}`}
                      className="w-52 shrink-0 font-mono text-xs"
                      onChange={(e) => setFieldTarget(name, e.target.value)}
                    />
                  </Tooltip>
                )}
                <Tooltip content="Required — a value of this type must include this field">
                  <label className="text-muted-foreground flex shrink-0 cursor-pointer items-center gap-1 text-xs">
                    <Checkbox checked={required.has(name)} onCheckedChange={(on) => setRequired(name, on === true)} />
                    required
                  </label>
                </Tooltip>
                <Button variant="ghost" size="iconSm" aria-label={`Remove ${name}`} onClick={() => removeField(name)}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
        </div>
        <Button variant="outline" size="sm" className="mt-1 w-fit gap-1" onClick={addField}>
          <Plus className="size-4" /> Add field
        </Button>
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="schema-values">
          <Tooltip content="Open struct — fields other than the ones above are allowed, and must have this kind">
            <label className="text-muted-foreground flex cursor-pointer items-center gap-1 text-xs">
              <Checkbox
                checked={values !== undefined}
                onCheckedChange={(on) => setValues(on === true ? {ref: ANY_URL} : null)}
              />
              other fields allowed
            </label>
          </Tooltip>
          {values !== undefined && (
            <Select value={propKind(values)} onValueChange={(kind) => setValues(kindSchema(kind))}>
              <SelectTrigger className="w-36 shrink-0" aria-label="Kind of other fields">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {propKind(values) === CUSTOM_KIND && (
                  <SelectItem value={CUSTOM_KIND} disabled>
                    {customLabel(values)}
                  </SelectItem>
                )}
                {fieldKinds.map(({kind, label}) => (
                  <SelectItem key={kind} value={kind}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </div>
  )
}

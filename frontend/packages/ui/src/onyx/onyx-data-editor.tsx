// Onyx data editor — a React port of schemas/editor-client.js. Given a schema
// it renders a recursive, schema-driven form and (in the Panel variant) live-
// validates the value against the SAME engine as the reference validator, so the
// in-app tour editor and schemas/validate.mjs can never disagree.
//
// The imperative reference builds/tears down DOM nodes; here the tree is a set
// of recursive controlled components. Values flow down as props and edits flow
// back up through onChange, except for two places that need local UI state the
// value alone can't express: a union's currently-selected arm, and an open
// map's in-progress (possibly empty / duplicate) extra-key rows.
//
// Validation, resolution, and kind detection are reused verbatim from
// onyx-engine.ts — this file only draws the form and synthesizes defaults.
import {useRef, useState} from 'react'
import {Button} from '../button'
import {Input} from '../components/input'
import {Switch} from '../components/switch'
import {cn} from '../utils'
import {kindOf, loadFrom, type OnyxRegistry, type OnyxSchema, refToName, resolveSchema, validate} from './onyx-engine'

// Recursive schemas (the meta-schema, onyx-any) are infinitely deep, so the form
// expands lazily — optional fields build only when included — and this cap falls
// back to a raw dag-json box rather than trying to draw an infinite tree.
const MAX_DEPTH = 14

type Env = Record<string, any>

const selectCls =
  'border-border bg-input text-foreground dark:bg-input/30 h-9 rounded-md border px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

// --- default-value synthesis (a valid-ish starting point) ------------------

/** Synthesize a valid-ish default value for a schema (port of the reference seed()). */
export function seedValue(schema: OnyxSchema, registry: OnyxRegistry = {}): unknown {
  return seed(schema, {}, registry)
}

function seed(schema0: OnyxSchema, env: Env, reg: OnyxRegistry): unknown {
  const {schema, env: e} = resolveSchema(schema0, env, reg)
  if (schema.anyOf) return seed(schema.anyOf[0], e, reg)
  if (schema.enum) return schema.enum[0]
  const kind = schema.type ? kindOf(schema.type) : null
  switch (kind) {
    case 'map': {
      const o: Record<string, unknown> = {}
      for (const k of schema.required ?? []) o[k] = seed(schema.properties?.[k] ?? {}, e, reg)
      return o
    }
    case 'list':
      return []
    case 'string':
      return ''
    case 'integer':
    case 'float':
      return 0
    case 'boolean':
      return false
    case 'null':
      return null
    case 'link':
      return {'/': ''}
    case 'bytes':
      return {'/': {bytes: ''}}
    default:
      return null
  }
}

// --- helpers ----------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const omit = (obj: Record<string, unknown>, key: string): Record<string, unknown> => {
  const o = {...obj}
  delete o[key]
  return o
}

/** A short human label for a union arm (port of the reference variantLabel). */
function variantLabel(v: OnyxSchema, reg: OnyxRegistry): string {
  if (v.var !== undefined) return '⟨' + v.var + '⟩'
  if (v.anyOf) return 'one of ' + v.anyOf.length
  if (v.ref && v.type === undefined) {
    const t = loadFrom(reg, v.ref)
    const kinds = t?.properties?.type?.enum
    if (kinds) return kinds.map((u: string) => kindOf(u)).join(' · ')
    const b = refToName(v.ref)
    const structural = t ? Object.keys(t).filter((k) => k !== 'name' && k !== 'description') : []
    if (t && structural.length === 1 && structural[0] === 'type') return kindOf(t.type)
    return b + (v.args ? '⟨…⟩' : '')
  }
  const k = v.type ? kindOf(v.type) : null
  if (v.enum) return (k ? k + ' ' : '') + 'enum'
  return k || 'any'
}

/** Pick the union arm that currently fits `value` (else the first arm). */
function matchVariant(anyOf: OnyxSchema[], value: unknown, env: Env, reg: OnyxRegistry): number {
  for (let i = 0; i < anyOf.length; i++) if (validate(anyOf[i]!, value, '$', env, reg).length === 0) return i
  return 0
}

// --- the recursive form node ------------------------------------------------

type NodeProps = {
  schema: OnyxSchema
  value: unknown
  onChange: (v: unknown) => void
  env: Env
  reg: OnyxRegistry
  depth: number
}

function Node({schema: schema0, value, onChange, env, reg, depth}: NodeProps) {
  const {schema, env: e} = resolveSchema(schema0, env, reg)

  if (schema.__unbound || schema.__missing)
    return (
      <JsonFallback value={value} onChange={onChange} note={schema.__missing ? 'unresolved ref' : 'unbound type var'} />
    )
  if (depth > MAX_DEPTH) return <JsonFallback value={value} onChange={onChange} note="deeply nested" />

  if (schema.anyOf)
    return <UnionNode schema={schema} value={value} onChange={onChange} env={e} reg={reg} depth={depth} />
  if (schema.enum) return <EnumNode schema={schema} value={value} onChange={onChange} />

  const kind = schema.type ? kindOf(schema.type) : null
  if (kind === 'map')
    return <MapNode schema={schema} value={value} onChange={onChange} env={e} reg={reg} depth={depth} />
  if (kind === 'list')
    return <ListNode schema={schema} value={value} onChange={onChange} env={e} reg={reg} depth={depth} />
  if (kind === 'boolean') return <BoolNode value={value} onChange={onChange} />
  if (kind === 'null') return <span className="text-muted-foreground text-sm">null</span>
  if (kind === 'link') return <WrappedNode kind="link" value={value} onChange={onChange} />
  if (kind === 'bytes') return <WrappedNode kind="bytes" value={value} onChange={onChange} />
  if (kind === 'string' || kind === 'integer' || kind === 'float')
    return <ScalarNode kind={kind} value={value} onChange={onChange} />

  // no kind / onyx-any leaf → raw dag-json
  return <JsonFallback value={value} onChange={onChange} note="any" />
}

function UnionNode({schema, value, onChange, env, reg, depth}: NodeProps) {
  const anyOf = schema.anyOf as OnyxSchema[]
  const [idx, setIdx] = useState(() => matchVariant(anyOf, value, env, reg))
  const arm = anyOf[Math.min(idx, anyOf.length - 1)]!
  return (
    <div className="flex flex-col gap-2">
      <select
        className={selectCls}
        value={String(idx)}
        onChange={(ev) => {
          const i = Number(ev.target.value)
          setIdx(i)
          onChange(seed(anyOf[i]!, env, reg))
        }}
      >
        {anyOf.map((v, i) => (
          <option key={i} value={String(i)}>
            {variantLabel(v, reg)}
          </option>
        ))}
      </select>
      <div className="border-border border-l pl-3">
        <Node schema={arm} value={value} onChange={onChange} env={env} reg={reg} depth={depth + 1} />
      </div>
    </div>
  )
}

function EnumNode({schema, value, onChange}: Pick<NodeProps, 'schema' | 'value' | 'onChange'>) {
  const options = schema.enum as unknown[]
  const cur = JSON.stringify(value)
  const selected = options.some((o) => JSON.stringify(o) === cur) ? cur : JSON.stringify(options[0])
  return (
    <select className={selectCls} value={selected} onChange={(ev) => onChange(JSON.parse(ev.target.value))}>
      {options.map((v, i) => (
        <option key={i} value={JSON.stringify(v)}>
          {JSON.stringify(v)}
        </option>
      ))}
    </select>
  )
}

function BoolNode({value, onChange}: Pick<NodeProps, 'value' | 'onChange'>) {
  return (
    <div className="flex items-center gap-2">
      <Switch checked={value === true} onCheckedChange={(c) => onChange(c)} />
      <span className="text-muted-foreground text-sm">{value === true ? 'true' : 'false'}</span>
    </div>
  )
}

// link / bytes: a single text input wrapped into its dag-json envelope.
function WrappedNode({
  kind,
  value,
  onChange,
}: {
  kind: 'link' | 'bytes'
  value: unknown
  onChange: (v: unknown) => void
}) {
  const inner = isRecord(value) ? value['/'] : undefined
  const cur = kind === 'link' ? inner : isRecord(inner) ? inner.bytes : undefined
  const text = typeof cur === 'string' ? cur : ''
  return (
    <div className="flex items-center gap-2">
      <Input
        type="text"
        placeholder={kind === 'link' ? 'CID' : 'base64'}
        value={text}
        onChangeText={(t) => onChange(kind === 'link' ? {'/': t} : {'/': {bytes: t}})}
      />
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {kind === 'link' ? '→ {"/": cid}' : '→ {"/": {bytes}}'}
      </span>
    </div>
  )
}

function ScalarNode({
  kind,
  value,
  onChange,
}: {
  kind: 'string' | 'integer' | 'float'
  value: unknown
  onChange: (v: unknown) => void
}) {
  const text = value === undefined || value === null ? '' : String(value)
  return (
    <Input
      type={kind === 'string' ? 'text' : 'number'}
      step={kind === 'integer' ? '1' : kind === 'float' ? 'any' : undefined}
      value={text}
      onChangeText={(t) => {
        if (kind === 'string') {
          onChange(t)
          return
        }
        if (t.trim() === '') {
          onChange(0)
          return
        }
        const n = Number(t)
        onChange(Number.isNaN(n) ? t : n)
      }}
    />
  )
}

function JsonFallback({value, onChange, note}: {value: unknown; onChange: (v: unknown) => void; note: string}) {
  const [text, setText] = useState(() => (value === undefined ? 'null' : JSON.stringify(value, null, 2)))
  const [bad, setBad] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground text-xs">free-form {note} · raw dag-json</div>
      <textarea
        className={cn(
          'border-border bg-input text-foreground dark:bg-input/30 w-full rounded-md border px-3 py-2 font-mono text-xs outline-none',
          bad && 'border-destructive',
        )}
        rows={Math.min(10, text.split('\n').length + 1)}
        value={text}
        onChange={(ev) => {
          const t = ev.target.value
          setText(t)
          try {
            const parsed = JSON.parse(t)
            setBad(false)
            onChange(parsed)
          } catch {
            setBad(true)
          }
        }}
      />
    </div>
  )
}

function ListNode({schema, value, onChange, env, reg, depth}: NodeProps) {
  const items: unknown[] = Array.isArray(value) ? value : []
  const sub = schema.items as OnyxSchema | undefined
  const replace = (i: number, nv: unknown) => {
    const next = items.slice()
    next[i] = nv
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="text-muted-foreground pt-2 text-xs">[{i}]</span>
            <div className="flex-1">
              {sub ? (
                <Node
                  schema={sub}
                  value={item}
                  onChange={(nv) => replace(i, nv)}
                  env={env}
                  reg={reg}
                  depth={depth + 1}
                />
              ) : (
                <JsonFallback value={item} onChange={(nv) => replace(i, nv)} note="any" />
              )}
            </div>
            <Button
              size="iconSm"
              variant="ghost"
              onClick={() => {
                const next = items.slice()
                next.splice(i, 1)
                onChange(next)
              }}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>
      <div>
        <Button size="sm" variant="outline" onClick={() => onChange([...items, sub ? seed(sub, env, reg) : null])}>
          + item
        </Button>
      </div>
    </div>
  )
}

type Extra = {id: number; key: string; value: unknown}

function MapNode({schema, value, onChange, env, reg, depth}: NodeProps) {
  const v: Record<string, unknown> = isRecord(value) ? value : {}
  const props = (schema.properties || {}) as Record<string, OnyxSchema>
  const required = new Set<string>(schema.required || [])
  const openValues = schema.values as OnyxSchema | undefined
  const known = new Set(Object.keys(props))

  // Open-map extras need local state: keys are edited in-place and may be empty
  // or duplicated mid-edit, which a value-derived object can't hold. Seeded once
  // from the value's non-declared keys; thereafter this node owns the extras.
  const [extras, setExtras] = useState<Extra[]>(() =>
    Object.entries(v)
      .filter(([k]) => !known.has(k))
      .map(([k, val], i) => ({id: i, key: k, value: val})),
  )
  const nextId = useRef(extras.length)

  const declaredObj = (base: Record<string, unknown>): Record<string, unknown> => {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(props)) if (k in base) o[k] = base[k]
    return o
  }
  const extrasObj = (list: Extra[]): Record<string, unknown> => {
    const o: Record<string, unknown> = {}
    for (const r of list) {
      const k = r.key.trim()
      if (k) o[k] = r.value
    }
    return o
  }
  const emitDeclared = (nextBase: Record<string, unknown>) => onChange({...declaredObj(nextBase), ...extrasObj(extras)})
  const emitExtras = (list: Extra[]) => {
    setExtras(list)
    onChange({...declaredObj(v), ...extrasObj(list)})
  }

  return (
    <div className="flex flex-col gap-3">
      {Object.entries(props).map(([k, sub]) => {
        const isReq = required.has(k)
        const included = isReq || k in v
        return (
          <div key={k} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              {!isReq && (
                <Switch
                  checked={k in v}
                  onCheckedChange={(c) =>
                    c ? emitDeclared({...v, [k]: seed(sub, env, reg)}) : emitDeclared(omit(v, k))
                  }
                />
              )}
              <span className="text-foreground text-sm font-medium">{k}</span>
              <span className={cn('text-xs', isReq ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
                {isReq ? 'required' : 'optional'}
              </span>
            </div>
            {included && (
              <div className="pl-3">
                <Node
                  schema={sub}
                  value={k in v ? v[k] : seed(sub, env, reg)}
                  onChange={(nv) => emitDeclared({...v, [k]: nv})}
                  env={env}
                  reg={reg}
                  depth={depth + 1}
                />
              </div>
            )}
          </div>
        )
      })}

      {openValues && (
        <div className="flex flex-col gap-2">
          <div className="text-muted-foreground text-xs">open map — extra keys allowed</div>
          {extras.map((r) => (
            <div key={r.id} className="flex items-start gap-2">
              <Input
                className="w-32"
                placeholder="key"
                value={r.key}
                onChangeText={(t) => emitExtras(extras.map((x) => (x.id === r.id ? {...x, key: t} : x)))}
              />
              <div className="flex-1">
                <Node
                  schema={openValues}
                  value={r.value}
                  onChange={(nv) => emitExtras(extras.map((x) => (x.id === r.id ? {...x, value: nv} : x)))}
                  env={env}
                  reg={reg}
                  depth={depth + 1}
                />
              </div>
              <Button size="iconSm" variant="ghost" onClick={() => emitExtras(extras.filter((x) => x.id !== r.id))}>
                ✕
              </Button>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const id = nextId.current++
                emitExtras([...extras, {id, key: '', value: seed(openValues, env, reg)}])
              }}
            >
              + entry
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// --- public API -------------------------------------------------------------

/** Recursive, schema-driven form. Controlled: renders `value`, emits edits via `onValue`. */
export function OnyxDataEditor({
  schema,
  value,
  onValue,
  registry,
}: {
  schema: OnyxSchema
  value: unknown
  onValue: (v: unknown) => void
  registry?: OnyxRegistry
}) {
  return <Node schema={schema} value={value} onChange={onValue} env={{}} reg={registry ?? {}} depth={0} />
}

/**
 * Convenience two-column panel: the form on the left, the live dag-json plus
 * validation status on the right (mirrors editor-client.js mount()). Manages its
 * own value state, seeded from `initialValue` or seedValue(schema).
 */
export function OnyxDataEditorPanel({
  schema,
  initialValue,
  registry,
  label,
}: {
  schema: OnyxSchema
  initialValue?: unknown
  registry?: OnyxRegistry
  label?: string
}) {
  const reg = registry ?? {}
  const [value, setValue] = useState<unknown>(() =>
    initialValue !== undefined ? initialValue : seedValue(schema, reg),
  )
  const errors = validate(schema, value, '$', {}, reg)
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <div className="text-foreground text-sm font-semibold">{label ?? 'Build data'}</div>
        <OnyxDataEditor schema={schema} value={value} onValue={setValue} registry={reg} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-foreground text-sm font-semibold">dag-json</div>
        <div className={cn('text-sm', errors.length ? 'text-destructive' : 'text-green-600')}>
          {errors.length ? `${errors.length} issue${errors.length > 1 ? 's' : ''}` : 'valid'}
        </div>
        {errors.length > 0 && (
          <ul className="text-destructive list-disc pl-4 text-xs">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        <pre className="bg-muted overflow-auto rounded p-2 font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>
      </div>
    </div>
  )
}

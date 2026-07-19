// The in-app Onyx Schema Explorer — a React port of the standalone tour's
// schema page (schemas/tour.mjs). Given a schema name (slug), it renders the
// schema as a browsable page: title/description, kind/union/extension/generic
// lead, a fields table (or variant cards / extension inherited-added table),
// dependencies + dependents as clickable chips, the published hm:// URL + CID,
// and the source dag-json with clickable `ref`/`type` links. Types are
// documents: clicking a reference navigates to that schema.

import {useMemo, useState} from 'react'
import {cn} from '../utils'
import {
  dependencies,
  dependents,
  isInstance,
  kindOf,
  nameToUrl,
  ONYX_SCHEMAS,
  refToName,
  resolveSchema,
  schemaCid,
  validate,
  type OnyxSchema,
} from './onyx-engine'

// --- classification --------------------------------------------------------

const KINDS = ['null', 'boolean', 'integer', 'float', 'string', 'bytes', 'list', 'map', 'link', 'any'] as const
const isPrimitive = (name: string) => KINDS.includes(name.replace(/^onyx-/, '') as any) && name.startsWith('onyx-')
const primitiveKind = (name: string) => name.replace(/^onyx-/, '')
const isMetaVariant = (name: string) => name.startsWith('onyx-') && name.endsWith('-schema') && name !== 'onyx-schema'
const kindPrimitive = (kind: string) => (ONYX_SCHEMAS[`onyx-${kind}`] ? `onyx-${kind}` : null)

type Section = {title: string; hint: string; names: string[]}

function catalogSections(): Section[] {
  const names = Object.keys(ONYX_SCHEMAS).sort()
  const meta = names.filter((n) => n === 'onyx-schema' || isMetaVariant(n))
  const prims = names.filter(isPrimitive)
  const hyper = names.filter((n) => n.startsWith('hypermedia-'))
  const examples = names.filter((n) => n.startsWith('example-') && !isInstance(ONYX_SCHEMAS[n]))
  const instances = names.filter((n) => isInstance(ONYX_SCHEMAS[n]))
  const known = new Set([...meta, ...prims, ...hyper, ...examples, ...instances])
  const other = names.filter((n) => !known.has(n))
  return [
    {
      title: 'Meta-schema',
      hint: 'the type of types — a discriminated union',
      names: ['onyx-schema', ...meta.filter((n) => n !== 'onyx-schema')],
    },
    {title: 'Primitives', hint: 'the standard library — one schema per kind', names: prims},
    {title: 'Examples', hint: 'feature demos', names: examples},
    ...(other.length ? [{title: 'Library', hint: 'other schemas', names: other}] : []),
    {title: 'Hypermedia blobs', hint: "the network's real DAG-CBOR blob schemas", names: hyper},
    {title: 'Instances', hint: 'data typed by a schema', names: instances},
  ].filter((s) => s.names.length)
}

// --- small pieces ----------------------------------------------------------

const kindColor: Record<string, string> = {
  map: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  list: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  string: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  integer: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  float: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  boolean: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  link: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  bytes: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  null: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  union: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  var: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  instance: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  any: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
}

function Tag({kind, children}: {kind: string; children?: React.ReactNode}) {
  return (
    <span className={cn('inline-block rounded px-1.5 py-0.5 text-xs font-medium', kindColor[kind] ?? kindColor.any)}>
      {children ?? kind}
    </span>
  )
}

function KindBadge({kind, nav}: {kind: string; nav: (slug: string) => void}) {
  const prim = kindPrimitive(kind)
  if (!prim) return <Tag kind={kind} />
  return (
    <button type="button" onClick={() => nav(prim)} title={`defined by ${prim}`} className="cursor-pointer">
      <Tag kind={kind} />
    </button>
  )
}

function Chip({label, onClick, variant = 'ref'}: {label: string; onClick?: () => void; variant?: 'ref' | 'dep'}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-xs',
        onClick && 'hover:bg-muted cursor-pointer',
        variant === 'dep' ? 'border-border text-muted-foreground' : 'border-primary/30 text-primary',
      )}
    >
      {label}
    </button>
  )
}

/** Compact, clickable rendering of a schema reference node (the tour's `summarize`). */
function SchemaRef({node, nav}: {node: any; nav: (slug: string) => void}): React.ReactElement {
  if (!node) return <span className="text-muted-foreground">any</span>
  if (node.var !== undefined) return <Tag kind="var">{`⟨${node.var}⟩`}</Tag>
  if (node.anyOf)
    return (
      <span>
        <span className="text-muted-foreground">one of </span>
        {node.anyOf.map((v: any, i: number) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> | </span>}
            <SchemaRef node={v} nav={nav} />
          </span>
        ))}
      </span>
    )
  if (node.ref && !node.type) {
    const b = refToName(node.ref)
    if (node.args) {
      return (
        <span>
          <Chip label={b} onClick={() => nav(b)} />
          <span className="text-muted-foreground">
            ⟨
            {Object.entries(node.args).map(([p, v], i) => (
              <span key={p}>
                {i > 0 && ', '}
                {p} = <SchemaRef node={v} nav={nav} />
              </span>
            ))}
            ⟩
          </span>
        </span>
      )
    }
    if (isPrimitive(b)) return <KindBadge kind={primitiveKind(b)} nav={nav} />
    return <Chip label={`↳ ${b}`} onClick={() => nav(b)} />
  }
  const k = kindOf(node.type)
  if (k === 'link')
    return (
      <span>
        <KindBadge kind="link" nav={nav} />
        {node.ref && (
          <>
            {' '}
            <Chip label={`→ ${refToName(node.ref)}`} onClick={() => nav(refToName(node.ref))} variant="dep" />
          </>
        )}
      </span>
    )
  if (k === 'list')
    return (
      <span>
        <KindBadge kind="list" nav={nav} /> <span className="text-muted-foreground">of</span>{' '}
        <SchemaRef node={node.items} nav={nav} />
      </span>
    )
  if (k === 'map') {
    if (node.properties)
      return (
        <span>
          <KindBadge kind="map" nav={nav} />{' '}
          <span className="text-muted-foreground">{`{ ${Object.keys(node.properties).length} fields }`}</span>
        </span>
      )
    if (node.values)
      return (
        <span>
          <KindBadge kind="map" nav={nav} /> <span className="text-muted-foreground">⟨ * :</span>{' '}
          <SchemaRef node={node.values} nav={nav} /> <span className="text-muted-foreground">⟩</span>
        </span>
      )
    return <KindBadge kind="map" nav={nav} />
  }
  if (node.enum) {
    return (
      <span>
        {k && (
          <>
            <KindBadge kind={k} nav={nav} />{' '}
          </>
        )}
        <span className="text-muted-foreground">enum: </span>
        {node.enum.map((v: any, i: number) => (
          <code key={i} className="bg-muted mr-1 rounded px-1 text-xs">
            {kindOf(String(v))}
          </code>
        ))}
      </span>
    )
  }
  if (k) return <KindBadge kind={k} nav={nav} />
  return <span className="text-muted-foreground">any</span>
}

// --- source JSON with clickable hm:// refs ---------------------------------

function SourceJson({schema, nav}: {schema: any; nav: (slug: string) => void}) {
  const text = JSON.stringify(schema, null, 2)
  // Split on hm:// URLs so each becomes a clickable link to its schema page.
  const parts = text.split(/("hm:\/\/[^"]+")/g)
  return (
    <pre className="bg-muted/50 overflow-x-auto rounded-md border p-3 font-mono text-xs">
      {parts.map((p, i) => {
        const m = /^"(hm:\/\/[^"]+)"$/.exec(p)
        if (m) {
          const name = refToName(m[1]!)
          const known = !!ONYX_SCHEMAS[name]
          return (
            <span
              key={i}
              className={known ? 'text-primary cursor-pointer underline decoration-dotted' : 'text-primary'}
              onClick={known ? () => nav(name) : undefined}
            >
              "{m[1]}"
            </span>
          )
        }
        return <span key={i}>{p}</span>
      })}
    </pre>
  )
}

// --- the schema page -------------------------------------------------------

function DepLists({name, nav}: {name: string; nav: (slug: string) => void}) {
  const deps = dependencies(name)
  const rdeps = dependents(name)
  if (!deps.length && !rdeps.length) return null
  return (
    <div className="my-4 flex flex-col gap-2">
      {deps.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs font-medium">Depends on:</span>
          {deps.map((d) => (
            <Chip key={d} label={d} onClick={() => nav(d)} variant="dep" />
          ))}
        </div>
      )}
      {rdeps.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs font-medium">Referenced by:</span>
          {rdeps.map((d) => (
            <Chip key={d} label={d} onClick={() => nav(d)} variant="dep" />
          ))}
        </div>
      )}
    </div>
  )
}

function FieldsTable({
  properties,
  required,
  origins,
  nav,
}: {
  properties: Record<string, any>
  required: Set<string>
  origins?: Record<string, 'added' | 'inherited'>
  nav: (slug: string) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            <th className="py-1 pr-4 font-medium">field</th>
            <th className="py-1 pr-4 font-medium">type</th>
            <th className="py-1 font-medium">{origins ? 'origin' : ''}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(properties).map(([k, v]) => (
            <tr key={k} className="border-border/50 border-b last:border-0">
              <td className="py-1.5 pr-4 font-mono">{k}</td>
              <td className="py-1.5 pr-4">
                <SchemaRef node={v} nav={nav} />
              </td>
              <td className="py-1.5 text-xs">
                {origins ? (
                  <span className={origins[k] === 'added' ? 'text-primary font-medium' : 'text-muted-foreground'}>
                    {origins[k]}
                    {required.has(k) ? ' ·req' : ''}
                  </span>
                ) : required.has(k) ? (
                  <span className="text-primary font-medium">required</span>
                ) : (
                  <span className="text-muted-foreground">optional</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Callout({tone = 'note', children}: {tone?: 'note' | 'meta'; children: React.ReactNode}) {
  return (
    <div
      className={cn(
        'my-3 rounded-md border-l-4 p-3 text-sm',
        tone === 'meta' ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40' : 'border-border bg-muted/40',
      )}
    >
      {children}
    </div>
  )
}

export function OnyxSchemaPage({slug, nav}: {slug: string; nav: (slug: string) => void}) {
  const schema: OnyxSchema | undefined = ONYX_SCHEMAS[slug]
  if (!schema) return <div className="text-muted-foreground p-4">Unknown schema: {slug}</div>

  const url = nameToUrl(slug)
  const cid = schemaCid(slug)
  const isMeta = slug === 'onyx-schema'
  const instance = isInstance(schema)

  // Instance page: validate the value against its declared $type.
  if (instance) {
    const typeName = refToName(schema.$type)
    const typeSchema = ONYX_SCHEMAS[typeName]
    const errs = typeSchema ? validate(typeSchema, schema.value) : ['unknown $type']
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-mono text-xl font-bold">{slug}</h1>
        <p className="text-sm">
          <Tag kind="instance">instance</Tag> <span className="text-muted-foreground">· of</span>{' '}
          <Chip label={typeName} onClick={() => nav(typeName)} />
        </p>
        <Callout>
          {errs.length === 0 ? (
            <span className="font-medium text-emerald-600">✓ a valid instance of {typeName}</span>
          ) : (
            <span className="font-medium text-amber-600">
              ⚠ does not match {typeName}: {errs[0]}
            </span>
          )}
        </Callout>
        <h2 className="mt-2 text-sm font-semibold">Value</h2>
        <SourceJson schema={schema.value} nav={nav} />
      </div>
    )
  }

  const isUnion = Array.isArray(schema.anyOf)
  const isPrim = isPrimitive(slug)
  const hasRef = schema.ref && !schema.type
  const hasExt = hasRef && ['properties', 'required', 'values', 'items'].some((k) => schema[k] !== undefined)

  let lead: React.ReactNode = null
  let main: React.ReactNode = null

  if (isPrim) {
    const k = primitiveKind(slug)
    lead = (
      <p className="text-sm">
        <KindBadge kind={k} nav={nav} />{' '}
        <span className="text-muted-foreground">· a primitive — the standard-library schema for the {k} kind</span>
      </p>
    )
    main = (
      <p className="text-sm">
        Its <code className="bg-muted rounded px-1">type</code> is <code className="bg-muted rounded px-1">{url}</code>{' '}
        — it names itself, the self-grounding axiom for the {k} kind. Reference it as{' '}
        <code className="bg-muted rounded px-1">{`{ "ref": "${url}" }`}</code> to type any value as {k}.
      </p>
    )
  } else if (isUnion) {
    lead = (
      <p className="text-sm">
        <Tag kind="union">{isMeta ? 'discriminated union' : 'union'}</Tag>{' '}
        <span className="text-muted-foreground">
          · {isMeta ? `${schema.anyOf.length} variants, tagged on type` : `one of ${schema.anyOf.length} alternatives`}
        </span>
      </p>
    )
    main = (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {schema.anyOf.map((v: any, i: number) => {
          const b = v.ref && !v.type ? refToName(v.ref) : null
          return (
            <button
              key={i}
              type="button"
              onClick={b ? () => nav(b) : undefined}
              className={cn(
                'border-border rounded-md border p-2 text-left',
                b && 'hover:border-primary/50 hover:bg-muted/50 cursor-pointer',
              )}
            >
              <div className="font-mono text-xs">{b ?? 'inline'}</div>
              <div className="mt-1">
                <SchemaRef node={v} nav={nav} />
              </div>
            </button>
          )
        })}
      </div>
    )
  } else if (hasExt) {
    const parent = refToName(schema.ref)
    const eff = resolveSchema(schema).schema
    const added = new Set(Object.keys(schema.properties || {}))
    const req = new Set<string>(eff.required || [])
    const origins: Record<string, 'added' | 'inherited'> = {}
    for (const k of Object.keys(eff.properties || {})) origins[k] = added.has(k) ? 'added' : 'inherited'
    lead = (
      <p className="text-sm">
        <KindBadge kind={kindOf(eff.type)} nav={nav} /> <span className="text-muted-foreground">· extends</span>{' '}
        <Chip label={parent} onClick={() => nav(parent)} />{' '}
        <span className="text-muted-foreground">· +{added.size} field(s)</span>
      </p>
    )
    main = <FieldsTable properties={eff.properties || {}} required={req} origins={origins} nav={nav} />
  } else if (hasRef && schema.args) {
    const parent = refToName(schema.ref)
    lead = (
      <p className="text-sm">
        <Tag kind="var">instantiation</Tag> <span className="text-muted-foreground">of</span>{' '}
        <Chip label={parent} onClick={() => nav(parent)} />
        <span className="text-muted-foreground">⟨</span>
        {Object.entries(schema.args).map(([p, v], i) => (
          <span key={p}>
            {i > 0 && ', '}
            {p} = <SchemaRef node={v} nav={nav} />
          </span>
        ))}
        <span className="text-muted-foreground">⟩</span>
      </p>
    )
  } else if (hasRef) {
    const parent = refToName(schema.ref)
    lead = (
      <p className="text-sm">
        <span className="text-muted-foreground">alias of</span> <Chip label={parent} onClick={() => nav(parent)} />
      </p>
    )
  } else if (kindOf(schema.type) === 'map' && schema.properties) {
    lead = (
      <p className="text-sm">
        Root kind: <KindBadge kind="map" nav={nav} />{' '}
        <span className="text-muted-foreground">
          · {schema.values ? 'map' : 'closed struct'}, {Object.keys(schema.properties).length} fields
        </span>
      </p>
    )
    main = <FieldsTable properties={schema.properties} required={new Set(schema.required || [])} nav={nav} />
  } else {
    lead = (
      <p className="text-sm">
        Root kind: <KindBadge kind={kindOf(schema.type) || 'any'} nav={nav} />
      </p>
    )
    if (kindOf(schema.type) === 'map' && schema.values)
      main = (
        <p className="text-sm">
          Open map — every value: <SchemaRef node={schema.values} nav={nav} />
        </p>
      )
  }

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-bold">{schema.name || slug}</h1>
      <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <code className="bg-muted rounded px-1 py-0.5">{slug}</code>
        {url && <span>· {url}</span>}
        {cid && (
          <>
            <span>· CID</span> <code className="bg-muted rounded px-1 py-0.5">{cid.slice(0, 12)}…</code>
          </>
        )}
      </p>
      {schema.description && <p className="text-sm">{schema.description}</p>}
      {lead}
      {isMeta && (
        <Callout tone="meta">
          This is the <strong>meta-schema</strong> — the discriminated union describing what every Onyx schema is,{' '}
          <em>including itself</em>. It validates against its own <code>union</code> variant, whose <code>anyOf</code>{' '}
          items validate against its <code>include</code> variant. The loop closes.
        </Callout>
      )}
      {isMetaVariant(slug) && (
        <Callout>
          A <strong>variant</strong> of the{' '}
          <button className="text-primary cursor-pointer underline" onClick={() => nav('onyx-schema')}>
            meta-schema union
          </button>{' '}
          — one of the shapes a schema is allowed to take.
        </Callout>
      )}
      {schema.params && (
        <Callout>
          <strong>Generic</strong> over{' '}
          {Object.entries(schema.params).map(([p, def], i) => (
            <span key={p}>
              {i > 0 && ', '}
              <Tag kind="var">{`⟨${p}⟩`}</Tag>{' '}
              <span className="text-muted-foreground">
                (default <SchemaRef node={def} nav={nav} />)
              </span>
            </span>
          ))}
          . A type parameter that threads through the schema; bind it with{' '}
          <code className="bg-muted rounded px-1">args</code>.
        </Callout>
      )}
      {main}
      <DepLists name={slug} nav={nav} />
      <h2 className="mt-2 text-sm font-semibold">
        Source <span className="text-muted-foreground font-normal">(dag-json — ref/type values are links)</span>
      </h2>
      <SourceJson schema={schema} nav={nav} />
    </div>
  )
}

// --- catalog + top-level explorer ------------------------------------------

export function OnyxCatalog({current, nav}: {current: string; nav: (slug: string) => void}) {
  const sections = useMemo(catalogSections, [])
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  return (
    <div className="flex flex-col gap-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter schemas…"
        className="border-border bg-background rounded-md border px-2 py-1 text-sm"
      />
      {sections.map((sec) => {
        const items = query ? sec.names.filter((n) => n.toLowerCase().includes(query)) : sec.names
        if (!items.length) return null
        return (
          <div key={sec.title}>
            <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{sec.title}</div>
            <div className="text-muted-foreground/70 mb-1 text-xs">{sec.hint}</div>
            <div className="flex flex-col">
              {items.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => nav(n)}
                  className={cn(
                    'rounded px-2 py-0.5 text-left font-mono text-xs',
                    n === current ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The full Onyx Schema Explorer. Self-contained: it owns the selected-schema
 * state, so it can be dropped into any route. `initialSlug` picks the first
 * schema; `onSlugChange` lets a host sync the URL. `belowPage` renders extra
 * content (e.g. the live data editor) under the schema page for the current slug.
 */
export function OnyxExplorer({
  initialSlug = 'onyx-schema',
  onSlugChange,
  belowPage,
}: {
  initialSlug?: string
  onSlugChange?: (slug: string) => void
  belowPage?: (slug: string) => React.ReactNode
}) {
  const [slug, setSlug] = useState(initialSlug)
  const nav = (s: string) => {
    setSlug(s)
    onSlugChange?.(s)
  }
  return (
    <div className="flex gap-6">
      <aside className="w-56 shrink-0 overflow-y-auto">
        <OnyxCatalog current={slug} nav={nav} />
      </aside>
      <main className="min-w-0 flex-1">
        <OnyxSchemaPage slug={slug} nav={nav} />
        {belowPage?.(slug)}
      </main>
    </div>
  )
}

// The in-app Schema Explorer. Given a schema name (slug), it renders the
// schema as a browsable page: title/description, kind/union/extension/generic
// lead, a fields table (or variant cards / extension inherited-added table),
// dependencies + dependents as clickable chips, the published hm:// URL + CID,
// and the source dag-json with clickable `ref`/`type` links. Types are
// documents: clicking a reference navigates to that schema.

import {ChevronRight} from 'lucide-react'
import {createContext, Fragment, useContext, useState} from 'react'
import {cn} from '../utils'
import {
  dependencies,
  dependents,
  HM_SCHEMAS,
  isLiteralSchema,
  kindOf,
  literalValue,
  nameForCid,
  namedSchemaUrl,
  nameToUrl,
  refToName,
  resolveSchema,
  schemaCid,
  structFields,
  type HypermediaSchema,
  type StructField,
} from './engine'
import {useSchemaRegistry} from './schema-registry-cid'
import {kindColor} from './schema-colors'
import {HM_SCHEMA_PAGES} from './schema-registry.generated'
import {isSignedBlobSchema} from './signed-blob'

// --- classification --------------------------------------------------------

const KINDS = [
  'null',
  'boolean',
  'integer',
  'float',
  'string',
  'bytes',
  'list',
  'map',
  'struct',
  'link',
  'any',
] as const
const isPrimitive = (name: string) => KINDS.includes(name as any)
const primitiveKind = (name: string) => name
const META_VARIANTS = ['schema/anyof', 'schema/allof', 'schema/property']
const isMetaVariant = (name: string) =>
  META_VARIANTS.includes(name) || (name.startsWith('schema/') && name.endsWith('-schema') && name !== 'schema')
const kindPrimitive = (kind: string) => (HM_SCHEMAS[kind] ? kind : null)

// --- small pieces ----------------------------------------------------------

/** The struct an intersection's arms merge into, as a field table; the reason when they cannot merge. */
function MergedFields({schema, nav}: {schema: HypermediaSchema; nav: (slug: string) => void}) {
  const merged = resolveSchema(schema).schema
  if (merged.__invalid) return <p className="text-destructive text-sm">{merged.__invalid}</p>
  if (merged.__missing || merged.__unbound || !merged.properties) return null
  return <FieldsTable fields={structFields(merged)} nav={nav} />
}

/** The display name of a library schema: its page's name, else its slug. */
const pageName = (slug: string) => HM_SCHEMA_PAGES[slug]?.name ?? slug

/** A short label for any schema reference: a library page's name, or the path of a document in some
 * other space (never a whole hm:// URL, which would not fit a chip). */
const refLabel = (ref: string) => {
  const name = refToName(ref)
  if (HM_SCHEMAS[name]) return pageName(name)
  return name.startsWith('hm://') ? name.replace(/^hm:\/\/[^/]+\/?/, '') || name : name
}

/** "Extends <base>": the type a schema is built on, named by its page and linking to it. */
function ExtendsLine({slug, onClick, children}: {slug: string; onClick?: () => void; children?: React.ReactNode}) {
  return (
    <p className="text-sm" data-testid="schema-extends">
      <span className="text-muted-foreground">Extends</span>{' '}
      <Chip label={refLabel(slug)} title={slug} onClick={onClick} />
      {children}
    </p>
  )
}

function Tag({kind, children}: {kind: string; children?: React.ReactNode}) {
  return (
    <span className={cn('inline-block rounded px-1.5 py-0.5 text-xs font-medium', kindColor[kind] ?? kindColor.any)}>
      {children ?? kind}
    </span>
  )
}

/**
 * How the explorer opens a reference that is NOT a bundled library schema —
 * an `hm://` type document or an `ipfs://` schema blob. Supplied by the page
 * hosting the explorer (route navigation).
 */
/** A short label for a schema target: its library name, or the path of a document in some other space. */
function targetLabel(target: string): string {
  const name = refToName(target)
  return name.startsWith('hm://') ? name.replace(/^hm:\/\/[^/]+\/?/, '') || name : name
}

export const SchemaNavContext = createContext<{openRef?: (ref: string) => void}>({})
export const useSchemaOpenRef = () => useContext(SchemaNavContext).openRef

/** Click handler for a ref: a bundled name navigates by slug; anything else opens the ref. */
function useRefClick(nav: (slug: string) => void) {
  const openRef = useSchemaOpenRef()
  return (ref: string) => {
    const b = refToName(ref)
    if (HM_SCHEMAS[b]) nav(b)
    else if (openRef && /^(hm|ipfs):\/\//.test(ref)) openRef(ref)
  }
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

function Chip({
  label,
  title,
  onClick,
  variant = 'ref',
}: {
  label: string
  /** The full reference, on hover. */
  title?: string
  onClick?: () => void
  variant?: 'ref' | 'dep'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex max-w-full min-w-0 items-center rounded border px-1.5 py-0.5 align-middle font-mono text-xs',
        onClick && 'hover:bg-muted cursor-pointer',
        variant === 'dep' ? 'border-border text-muted-foreground' : 'border-primary/30 text-primary',
      )}
    >
      <span className="truncate">{label}</span>
    </button>
  )
}

/** Compact, clickable rendering of a schema reference node. */
function SchemaRef({node, nav}: {node: any; nav: (slug: string) => void}): React.ReactElement {
  const open = useRefClick(nav)
  if (node === undefined) return <span className="text-muted-foreground">any</span>
  if (isLiteralSchema(node)) {
    const v = literalValue(node)
    return (
      <span>
        <code className="bg-muted rounded px-1 text-xs">{typeof v === 'string' ? kindOf(v) : JSON.stringify(v)}</code>
        {typeof node?.description === 'string' && <span className="text-muted-foreground"> — {node.description}</span>}
      </span>
    )
  }
  const target =
    typeof node.target === 'string' ? (
      <>
        {' '}
        <Chip
          label={`→ ${targetLabel(node.target)}`}
          title={node.target}
          onClick={() => open(node.target)}
          variant="dep"
        />
      </>
    ) : null
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
  if (node.allOf)
    return (
      <span>
        <span className="text-muted-foreground">all of </span>
        {node.allOf.map((v: any, i: number) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> & </span>}
            <SchemaRef node={v} nav={nav} />
          </span>
        ))}
      </span>
    )
  const named = namedSchemaUrl(node)
  if (named) {
    const b = refToName(named)
    if (node.args) {
      return (
        <span>
          <Chip label={refLabel(named)} title={named} onClick={() => nav(b)} />
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
    if (isPrimitive(b))
      return (
        <span>
          <KindBadge kind={primitiveKind(b)} nav={nav} />
          {target}
        </span>
      )
    return (
      <span>
        <Chip label={`↳ ${refLabel(named)}`} title={named} onClick={() => open(named)} />
        {target}
      </span>
    )
  }
  const k = kindOf(node.type)
  if (k === 'link')
    return (
      <span>
        <KindBadge kind="link" nav={nav} />
        {typeof node.target === 'string' && (
          <>
            {' '}
            <Chip
              label={`→ ${targetLabel(node.target)}`}
              title={node.target}
              onClick={() => open(node.target)}
              variant="dep"
            />
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
  if (k === 'map' || k === 'struct') {
    if (node.properties) return <KindBadge kind={k} nav={nav} />
    if (node.values)
      return (
        <span>
          <KindBadge kind="map" nav={nav} /> <span className="text-muted-foreground">⟨ * :</span>{' '}
          <SchemaRef node={node.values} nav={nav} /> <span className="text-muted-foreground">⟩</span>
        </span>
      )
    return <KindBadge kind={k} nav={nav} />
  }
  if (k)
    return (
      <span>
        <KindBadge kind={k} nav={nav} />
        {node.format && <span className="text-muted-foreground"> · {node.format}</span>}
        {target}
      </span>
    )
  return <span className="text-muted-foreground">any</span>
}

// --- the schema page -------------------------------------------------------

/**
 * What a schema depends on and what references it. Secondary information, so it
 * starts collapsed behind one quiet line with the counts; opening it shows the chips.
 */
export function DepLists({name, nav}: {name: string; nav: (slug: string) => void}) {
  const deps = dependencies(name)
  const rdeps = dependents(name)
  const [open, setOpen] = useState(false)
  if (!deps.length && !rdeps.length) return null
  const summary = [
    deps.length ? `depends on ${deps.length}` : null,
    rdeps.length ? `referenced by ${rdeps.length}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="schema-dep-lists">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-muted-foreground hover:text-foreground inline-flex w-fit cursor-pointer items-center gap-1 text-xs"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {summary}
      </button>
      {open && (
        <div className="flex flex-col gap-2 pl-4">
          {deps.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground text-xs">Depends on</span>
              {deps.map((d) => (
                <Chip key={d} label={d} onClick={() => nav(d)} variant="dep" />
              ))}
            </div>
          )}
          {rdeps.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground text-xs">Referenced by</span>
              {rdeps.map((d) => (
                <Chip key={d} label={d} onClick={() => nav(d)} variant="dep" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The inline struct a field's schema spells out — its own `properties`, directly or as the items
 * of a list — so the fields table can expand it in place. A named type (a `ref`) is a link instead.
 */
function inlineStruct(node: any): HypermediaSchema | null {
  if (!node || typeof node !== 'object' || node.anyOf) return null
  if (node.type && kindOf(node.type) === 'list') return inlineStruct(node.items)
  const k = node.type ? kindOf(node.type) : null
  if ((k === 'struct' || k === 'map') && node.properties && typeof node.properties === 'object') return node
  return null
}

function FieldsTable({
  fields,
  origins,
  nav,
  nested,
}: {
  fields: StructField[]
  origins?: Record<string, 'added' | 'inherited'>
  nav: (slug: string) => void
  /** Rendered beneath a parent field: no scroll container of its own. */
  nested?: boolean
}) {
  const table = (
    // Fixed columns: names get room for their descriptions, the flag column is narrow, and the type
    // column takes the rest — long reference chips truncate inside it rather than widening the table.
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-2/5" />
        <col />
        <col className="w-20" />
      </colgroup>
      <tbody>
        {fields.map((f) => {
          const sub = inlineStruct(f.schema)
          return (
            <Fragment key={f.name}>
              <tr className={cn('border-border/50', !sub && 'border-b last:border-0')}>
                <td className="py-1.5 pr-4 align-top font-mono break-words">
                  {f.name}
                  {f.description && (
                    <div className="text-muted-foreground font-sans text-xs font-normal">{f.description}</div>
                  )}
                </td>
                <td className="py-1.5 pr-4 align-top">
                  <SchemaRef node={f.schema} nav={nav} />
                </td>
                <td className="py-1.5 text-right align-top text-xs whitespace-nowrap">
                  {/* Required is the default, so only optional is spelled out. */}
                  {!f.required && <span className="text-muted-foreground">optional</span>}
                  {origins?.[f.name] === 'inherited' && (
                    <span className="text-muted-foreground">{f.required ? 'inherited' : ' · inherited'}</span>
                  )}
                </td>
              </tr>
              {sub && (
                <tr className="border-border/50 border-b last:border-0" data-testid={`schema-nested-fields-${f.name}`}>
                  <td colSpan={3} className="pb-2 pl-4">
                    <div className="border-border border-l pl-3">
                      <FieldsTable fields={structFields(sub)} nav={nav} nested />
                      {sub.values !== undefined && (
                        <p className="text-muted-foreground py-1 text-xs">
                          other fields: <SchemaRef node={sub.values} nav={nav} />
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
  return nested ? table : <div className="overflow-x-auto">{table}</div>
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

export function SchemaDocPage({
  slug,
  nav,
  hideIdentity,
}: {
  slug: string
  nav: (slug: string) => void
  /** Embedded in a defining document: the doc's own header carries name and description, so the
   * schema's identity block (name, slug/URL/CID line, description) is suppressed. */
  hideIdentity?: boolean
}) {
  const schema: HypermediaSchema | undefined = HM_SCHEMAS[slug]
  if (!schema) return <div className="text-muted-foreground p-4">Unknown schema: {slug}</div>

  const url = nameToUrl(slug)
  const cid = schemaCid(slug)
  const isUnion = Array.isArray(schema.anyOf)
  const isIntersection = Array.isArray(schema.allOf)
  const isPrim = isPrimitive(slug)
  // A schema that NAMES another (rather than a kind) includes it; with any refinement it is a subtype.
  const base = namedSchemaUrl(schema)
  const hasExt =
    !!base &&
    ['properties', 'required', 'values', 'items', 'format', 'pattern', 'minimum', 'maximum', 'target'].some(
      (k) => schema[k] !== undefined,
    )

  let lead: React.ReactNode = null
  let main: React.ReactNode = null

  if (isPrim) {
    const k = primitiveKind(slug)
    lead = (
      <p className="text-sm">
        <KindBadge kind={k} nav={nav} /> <span className="text-muted-foreground">· Core Type</span>
      </p>
    )
  } else if (isUnion) {
    lead = (
      <p className="text-sm" data-testid="schema-union-lead">
        <Chip label="Union" onClick={() => nav('schema/anyof')} />{' '}
        <span className="text-muted-foreground">
          · one of {schema.anyOf.length} variant{schema.anyOf.length === 1 ? '' : 's'}:
        </span>
      </p>
    )
    main = (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {schema.anyOf.map((v: any, i: number) => {
          const b = namedSchemaUrl(v) ? refToName(namedSchemaUrl(v)!) : null
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
  } else if (isIntersection) {
    // The arms, then the merged struct they make — every field of every arm, once.
    const eff = resolveSchema(schema).schema
    lead = (
      <p className="text-sm" data-testid="schema-intersection-lead">
        <Chip label="Intersection" onClick={() => nav('schema/allof')} />{' '}
        <span className="text-muted-foreground">· all of {schema.allOf.length}:</span>{' '}
        {schema.allOf.map((v: any, i: number) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> & </span>}
            <SchemaRef node={v} nav={nav} />
          </span>
        ))}
      </p>
    )
    main = eff.__invalid ? (
      <p className="text-destructive text-sm">{eff.__invalid}</p>
    ) : eff.properties ? (
      <FieldsTable fields={structFields(eff)} nav={nav} />
    ) : null
  } else if (hasExt) {
    const parent = refToName(base!)
    const eff = resolveSchema(schema).schema
    const added = new Set(structFields(schema).map((f) => f.name))
    const effFields = structFields(eff)
    const origins: Record<string, 'added' | 'inherited'> = {}
    for (const f of effFields) origins[f.name] = added.has(f.name) ? 'added' : 'inherited'
    lead = <ExtendsLine slug={parent} onClick={() => nav(parent)} />
    main = <FieldsTable fields={effFields} origins={origins} nav={nav} />
  } else if (base && schema.args) {
    const parent = refToName(base)
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
  } else if (base) {
    const parent = refToName(base)
    lead = (
      <p className="text-sm">
        <span className="text-muted-foreground">alias of</span> <Chip label={parent} onClick={() => nav(parent)} />
      </p>
    )
  } else if ((kindOf(schema.type) === 'struct' || kindOf(schema.type) === 'map') && schema.properties) {
    const base = kindOf(schema.type) === 'struct' ? 'struct' : 'map'
    lead = (
      <ExtendsLine slug={base} onClick={() => nav(base)}>
        <span className="text-muted-foreground"> · {schema.values ? 'open' : 'closed'}</span>
      </ExtendsLine>
    )
    main = <FieldsTable fields={structFields(schema)} nav={nav} />
  } else {
    {
      const k = kindOf(schema.type) || 'any'
      lead = <ExtendsLine slug={k} onClick={() => nav(k)} />
    }
    if ((kindOf(schema.type) === 'map' || kindOf(schema.type) === 'struct') && schema.values)
      main = (
        <p className="text-sm">
          Open map — every value: <SchemaRef node={schema.values} nav={nav} />
        </p>
      )
  }

  return (
    <div className="flex flex-col gap-2">
      {!hideIdentity && (
        <>
          <h1 className="text-xl font-bold">{slug}</h1>
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
        </>
      )}
      {lead}
      {isMetaVariant(slug) && (
        <Callout>
          A <strong>variant</strong> of the{' '}
          <button className="text-primary cursor-pointer underline" onClick={() => nav('schema')}>
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
    </div>
  )
}

/**
 * The full-page schema browser for a schema blob by CID. A bundled library
 * schema renders its regular page; a user-published schema (resolved through
 * the registry) renders its shape from the blob itself. Every reference is
 * clickable: bundled names via `nav`, everything else via SchemaNavContext.
 */
/** A readable label for a schema's base ref: bundled name, else a shortened ipfs CID, else the hm name. */
function baseRefLabel(ref: string): string {
  const ipfs = /^ipfs:\/\/([^/]+)/.exec(ref)
  if (ipfs) {
    const bundled = nameForCid(ipfs[1]!)
    if (bundled) return bundled
    const cid = ipfs[1]!
    return cid.length > 18 ? `ipfs://${cid.slice(0, 8)}…${cid.slice(-6)}` : ref
  }
  return refToName(ref)
}

export function SchemaByCid({
  cid,
  nav,
  hideIdentity,
}: {
  cid: string
  nav: (slug: string) => void
  /** See {@link SchemaDocPage}: suppress the schema's own name/CID/description block. */
  hideIdentity?: boolean
}) {
  const bundled = nameForCid(cid)
  const {byCid, isLoading} = useSchemaRegistry(bundled ? [] : [cid])
  if (bundled) return <SchemaDocPage slug={bundled} nav={nav} hideIdentity={hideIdentity} />
  const schema = byCid[cid]
  if (!schema)
    return (
      <div className="text-muted-foreground p-4 text-sm" data-testid="schema-by-cid-loading">
        {isLoading ? 'Fetching schema…' : `Searching the network for ipfs://${cid}…`}
      </div>
    )
  return <SchemaView schema={schema} nav={nav} hideIdentity={hideIdentity} cid={cid} />
}

/** A schema object rendered read-only: its base, parameters, variants or fields. */
export function SchemaView({
  schema,
  nav,
  hideIdentity,
  cid,
}: {
  schema: HypermediaSchema
  nav: (slug: string) => void
  hideIdentity?: boolean
  /** Shown in the identity block when known. */
  cid?: string
}) {
  const open = useRefClick(nav)
  const base = namedSchemaUrl(schema)
  const parentName = base ? baseRefLabel(base) : null
  const kind = schema.type ? kindOf(schema.type) : null
  const isSigned = isSignedBlobSchema(schema)
  return (
    <div className="flex flex-col gap-2" data-testid="schema-by-cid">
      {!hideIdentity && (
        <>
          {cid && (
            <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              <span>ipfs://</span>
              <code className="bg-muted rounded px-1 py-0.5">{cid}</code>
            </p>
          )}
          {schema.description && <p className="text-sm">{schema.description}</p>}
        </>
      )}
      {base && parentName ? (
        <ExtendsLine slug={parentName} onClick={() => open(base)}>
          {isSigned && (
            <span className="text-muted-foreground"> — a signed blob: the envelope (signer, sig, ts) is inherited</span>
          )}
        </ExtendsLine>
      ) : kind ? (
        <ExtendsLine slug={kind} onClick={() => nav(kind)} />
      ) : null}
      {schema.params && (
        <p className="text-sm" data-testid="schema-params">
          <span className="text-muted-foreground">Generic over</span>{' '}
          {Object.entries(schema.params).map(([p, def], i) => (
            <span key={p}>
              {i > 0 && ', '}
              <Tag kind="var">{`⟨${p}⟩`}</Tag>{' '}
              <span className="text-muted-foreground">
                (default <SchemaRef node={def as any} nav={nav} />)
              </span>
            </span>
          ))}
        </p>
      )}
      {schema.anyOf ? (
        // A root union as a LIST — one variant per row. Inlining them (with the "one of …"
        // phrasing SchemaRef uses for nested unions) wraps into an unreadable clutter here.
        <div className="flex flex-col gap-1.5" data-testid="schema-union-variants">
          <p className="text-sm">
            <Chip label="Union" onClick={() => nav('schema/anyof')} />{' '}
            <span className="text-muted-foreground">
              · one of {schema.anyOf.length} variant{schema.anyOf.length === 1 ? '' : 's'}:
            </span>
          </p>
          <ul className="flex flex-col gap-0.5 pl-1">
            {schema.anyOf.map((v: any, i: number) => (
              <li key={i} className="flex items-baseline gap-1.5 text-sm">
                <span className="text-muted-foreground select-none">·</span>
                <SchemaRef node={v} nav={nav} />
              </li>
            ))}
          </ul>
        </div>
      ) : schema.allOf ? (
        <div className="flex flex-col gap-1.5" data-testid="schema-intersection-arms">
          <p className="text-sm">
            <Chip label="Intersection" onClick={() => nav('schema/allof')} />{' '}
            <span className="text-muted-foreground">· all of {schema.allOf.length}:</span>
          </p>
          <ul className="flex flex-col gap-0.5 pl-1">
            {schema.allOf.map((v: any, i: number) => (
              <li key={i} className="flex items-baseline gap-1.5 text-sm">
                <span className="text-muted-foreground select-none">&</span>
                <SchemaRef node={v} nav={nav} />
              </li>
            ))}
          </ul>
          <MergedFields schema={schema} nav={nav} />
        </div>
      ) : schema.properties ? (
        <FieldsTable fields={structFields(schema)} nav={nav} />
      ) : null}
    </div>
  )
}

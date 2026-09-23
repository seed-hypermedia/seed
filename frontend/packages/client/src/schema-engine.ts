// The Hypermedia schema validation engine — a TypeScript port of the reference validator
// (scripts/hypermedia/validate.mjs), resolving schema references from the bundled
// HM_SCHEMAS instead of the filesystem. Kept behaviorally identical so the
// in-app schema explorer/editor can never disagree with the reference oracle.
//
// Hypermedia data model (9 kinds): null, boolean, integer, float, string, bytes,
// list, map, link. In dag-json form a link is {"/":"<cid>"} and bytes is
// {"/":{"bytes":"<base64>"}} — both distinct kinds, NOT maps.

import {HM_SCHEMA_MANIFEST, HM_SCHEMA_PAGES, HM_SCHEMAS} from './schema-registry.generated'

export type HypermediaSchema = Record<string, any>
/** schema name (its path in hypermedia/) -> schema, e.g. "string", "schema/map-schema", "block/image". A caller may pass a
 * custom registry to resolve refs that aren't in the bundled standard library. */
export type SchemaRegistry = Record<string, HypermediaSchema>

// Schema references name the library by domain: hm://hyper.media/<name>, where the name is the bundled key,
// its path in hypermedia/ (string, schema, the meta-schema, example/person, …). The domain is a name, not a
// key, so a schema's bytes and CID are the same wherever the library is published; the docs sync resolves it
// to the publishing space's key for page links and frontmatter bindings. Legacy forms, the old dev
// authorities (seed.hyper.media, example.com) and the prefixed names from before the folder reorganization
/** The authority of the bundled schema library in hm:// URLs. */
export const LIBRARY_AUTHORITY = 'hyper.media'
export const KINDS = ['null', 'boolean', 'integer', 'float', 'string', 'bytes', 'list', 'map', 'struct', 'link']
/** The type language's own schemas: the kind primitives, the meta-schema and its
 * variants, and the built-in refinements — as opposed to the network's blob
 * schemas at the root and elsewhere under schema/, the API read models (rpc/) and the examples (example/). */
export const LIBRARY_CORE: ReadonlySet<string> = new Set(
  [
    ...KINDS,
    'any',
    'none',
    'date',
    'date-time',
    'property',
    'schema',
    'anyof',
    'literal-schema',
    'struct-schema',
    'map-schema',
    'list-schema',
    'scalar-schema',
    'link-schema',
    'include-schema',
    'var-schema',
  ].map((k) => (KINDS.includes(k) || k === 'schema' || k === 'none' ? k : `schema/${k}`)), // kinds and the meta-schema live at the root,
)
export const isLibraryCore = (name: string): boolean => LIBRARY_CORE.has(name)
const KIND_URL = /^hm:\/\/hyper\.media\/([a-z]+)$/

/** hm:// URL (or bare name) -> bundled-schema key (basename, no .json). */
export function refToName(ref: string): string {
  const m = /^hm:\/\/([^/]+)\/(.+)$/.exec(ref)
  if (!m) return ref.replace(/\.schema\.json$|\.json$/, '')
  const [, auth = '', name = ''] = m
  // A library URL's path is the bundled key. Any other authority is an ordinary space: its
  // documents are fetched, never matched to the bundle by path.
  return auth === LIBRARY_AUTHORITY ? name : ref
}

/** bundled-schema key (basename) -> its canonical library URL, hm://hyper.media/<name>. */
export function nameToUrl(name: string): string | null {
  return `hm://${LIBRARY_AUTHORITY}/${name}`
}

/** The canonical kind URL for a primitive kind (map, list, string, …). Schemas
 * authored in-app must use this so they validate against the meta-schema. */
export function kindUrl(kind: string): string {
  return `hm://${LIBRARY_AUTHORITY}/${kind}`
}

/** The map kind URL (the shape every struct/metadata schema declares). */
export const MAP_URL = kindUrl('map')
/** The struct kind: a map with known, named fields (`properties`). Same bytes as a map. */
export const STRUCT_URL = kindUrl('struct')

/** Published DAG-CBOR CID for a schema, by basename or ANY hm:// URL form
 * — normalized through the bundle. */
export function schemaCid(nameOrUrl: string): string | undefined {
  const name = refToName(nameOrUrl)
  const url = nameToUrl(name)
  return url ? HM_SCHEMA_MANIFEST[url] : undefined
}

// Reverse of the manifest: a published DAG-CBOR CID -> the bundled schema's
// basename. Lets a document's `schemaDefinition` (ipfs://<cid>) resolve to a
// bundled Hypermedia schema without a network fetch — the bundled schemas encode to
// the same CIDs as the published ones (see scripts/hypermedia/publish.mjs).
const CID_TO_NAME: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const [url, cid] of Object.entries(HM_SCHEMA_MANIFEST)) {
    const name = refToName(url)
    if (name) out[cid] = name
  }
  return out
})()

/** A bundled schema's basename for a published CID (accepts a bare CID or an ipfs://<cid> URL). */
export function nameForCid(cidOrUrl: string): string | undefined {
  const cid = cidOrUrl.replace(/^ipfs:\/\//i, '').split('/')[0] ?? ''
  return CID_TO_NAME[cid]
}

/** The bundled Hypermedia schema for a published CID (or ipfs://<cid> URL), if known. */
export function schemaForCid(cidOrUrl: string): HypermediaSchema | undefined {
  const name = nameForCid(cidOrUrl)
  return name ? HM_SCHEMAS[name] : undefined
}

export function loadFrom(registry: SchemaRegistry, ref: string): HypermediaSchema | undefined {
  const name = refToName(ref)
  return registry[name] ?? HM_SCHEMAS[name]
}

/** Resolve a ref against the bundled standard library. */
export const load = (ref: string): HypermediaSchema | undefined => loadFrom(HM_SCHEMAS, ref)

// --- kind detection (dag-json envelopes are their own kinds) ---------------

export const isLink = (d: any): boolean =>
  d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === 1 && typeof d['/'] === 'string'

export const isBytes = (d: any): boolean =>
  d &&
  typeof d === 'object' &&
  !Array.isArray(d) &&
  Object.keys(d).length === 1 &&
  d['/'] &&
  typeof d['/'] === 'object' &&
  Object.keys(d['/']).length === 1 &&
  typeof d['/'].bytes === 'string'

export function typeOf(d: any): string {
  if (d === null) return 'null'
  if (Array.isArray(d)) return 'list'
  if (typeof d === 'object') return isLink(d) ? 'link' : isBytes(d) ? 'bytes' : 'map'
  if (typeof d === 'number') return Number.isInteger(d) ? 'integer' : 'float'
  return typeof d // string, boolean
}

// A `type` value is a kind URL (hm://hyper.media/<kind>); read the kind locally.
export const kindOf = (t: string): string => {
  const k = KIND_URL.exec(t)?.[1]
  return k && KINDS.includes(k) ? k : t
}

function typeMatches(type: string, d: any): boolean {
  switch (type) {
    case 'null':
      return d === null
    case 'boolean':
      return typeof d === 'boolean'
    case 'integer':
      return typeof d === 'number' && Number.isInteger(d)
    case 'float':
      return typeof d === 'number' // JSON can't distinguish 3.0 from 3
    case 'string':
      return typeof d === 'string'
    case 'bytes':
      return isBytes(d)
    case 'list':
      return Array.isArray(d)
    case 'map':
    case 'struct':
      return typeOf(d) === 'map'
    case 'link':
      return isLink(d)
    default:
      return false
  }
}

/**
 * A node refines the schema it names when it carries any of these. Structural keys and leaf
 * refinements alike, so `{type: <url>, format: 'ipfs-url'}` narrows a leaf exactly as
 * `{type: <url>, properties: {…}}` extends a struct.
 */
const REFINE = [
  'properties',
  'required',
  'values',
  'items',
  'format',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'target',
]

// --- literals ---------------------------------------------------------------
//
// A literal schema accepts exactly one value. It is written as the bare value —
// `"draft"`, `1`, `true`, `null` — or, when it needs a description, as
// `{value, description}`. A union of literals (`{anyOf: ["draft", "published"]}`)
// is how a schema restricts a field to a fixed set of values.

/** True for a literal schema: a bare scalar, or `{value, description?}` with no other schema keys. */
export function isLiteralSchema(s: any): boolean {
  if (s === undefined) return false
  if (s === null || typeof s !== 'object') return true
  if (Array.isArray(s)) return false
  return 'value' in s && !('type' in s || 'ref' in s || 'anyOf' in s || 'var' in s || 'params' in s)
}
/** The scalars a literal can be. */
export type HMLiteral = string | number | boolean | null
/** A bare literal, typed as the schema it is. (`HypermediaSchema` is the map shape
 * for static typing; at runtime a bare scalar is a schema too.) */
export const literalSchema = (v: HMLiteral): HypermediaSchema => v as unknown as HypermediaSchema
/** The one value a literal schema accepts (either spelling). */
export const literalValue = (s: any): unknown => (s !== null && typeof s === 'object' ? s.value : s)
/** The long form of a literal node, so every resolved schema is an object. */
const literalNode = (s: any): HypermediaSchema => (s !== null && typeof s === 'object' ? s : {value: s})

export type LiteralMember = {value: unknown; description?: string}
/**
 * The members of a literal schema (one) or a union whose every arm is a literal
 * (each arm), in order — the options a form offers for the field. Null when the
 * schema is anything else.
 */
export function literalMembers(schema: HypermediaSchema, reg: SchemaRegistry = {}): LiteralMember[] | null {
  const {schema: r} = resolveSchema(schema, {}, reg)
  if (!r || r.__missing || r.__unbound) return null
  const member = (node: HypermediaSchema): LiteralMember => ({
    value: node.value,
    description: typeof node.description === 'string' ? node.description : undefined,
  })
  if (isLiteralSchema(r)) return [member(r)]
  if (!Array.isArray(r.anyOf) || r.anyOf.length === 0) return null
  const out: LiteralMember[] = []
  for (const arm of r.anyOf) {
    const {schema: a} = resolveSchema(arm, {}, reg)
    if (!a || !isLiteralSchema(a)) return null
    out.push(member(a))
  }
  return out
}

// --- struct fields ----------------------------------------------------------
//
// A struct writes its fields as `properties[name] = {value, required?, description?}`.
// Schemas published before that wrote `properties[name] = <schema>` with a
// separate `required` list; those blobs are immutable, so every reader goes
// through these helpers and accepts both.

/** A struct field entry: the field's schema, whether a value must include it, what it is for. */
export type PropertyEntry = {value: HypermediaSchema; required?: boolean; description?: string}
/** A struct field. */
export type StructField = {name: string; schema: HypermediaSchema; required: boolean; description?: string}

/** A struct's fields, in declaration order. A `properties` entry always wraps its
 * field's schema in `value` (a field whose schema is the literal `"x"` is `{value: "x"}`). */
export function structFields(schema: HypermediaSchema | undefined): StructField[] {
  if (!schema || !schema.properties || typeof schema.properties !== 'object') return []
  return Object.entries(schema.properties as Record<string, any>).map(([name, entry]) => ({
    name,
    schema: entry?.value === undefined ? {} : entry.value,
    required: entry?.required === true,
    description: typeof entry?.description === 'string' ? entry.description : undefined,
  }))
}

/** The schema of one field, or undefined when the struct has no such field. */
export function fieldSchema(schema: HypermediaSchema | undefined, name: string): HypermediaSchema | undefined {
  const entry = schema?.properties?.[name]
  if (entry === undefined) return undefined
  return entry?.value === undefined ? {} : entry.value
}

/** The names of the fields a value must include. */
export function requiredFieldNames(schema: HypermediaSchema | undefined): string[] {
  return structFields(schema)
    .filter((f) => f.required)
    .map((f) => f.name)
}

/** `properties` in the current shape. */
export function fieldsToProperties(fields: StructField[]): Record<string, PropertyEntry> {
  const out: Record<string, PropertyEntry> = {}
  for (const f of fields) {
    const e: PropertyEntry = {value: f.schema}
    if (f.required) e.required = true
    if (f.description) e.description = f.description
    out[f.name] = e
  }
  return out
}

/** Merge an extension node's refinements over its (resolved) parent — a subtype. */
export function mergeExtend(parent: HypermediaSchema, ext: HypermediaSchema): HypermediaSchema {
  const merged: HypermediaSchema = {type: parent.type}
  // The parent's fields, then the extension's (an extension may override a field).
  const byName = new Map<string, StructField>()
  for (const f of structFields(parent)) byName.set(f.name, f)
  for (const f of structFields(ext)) byName.set(f.name, f)
  if (byName.size) merged.properties = fieldsToProperties(Array.from(byName.values()))
  const values = ext.values ?? parent.values
  if (values) merged.values = values
  const items = ext.items ?? parent.items
  if (items) merged.items = items
  // Leaf refinements are inherited by a subtype (a `{ref: date, …}` stays a
  // date; `{ref: ipfs, target}` keeps its format and gains a target).
  for (const k of LEAF_KEYS) {
    const v = ext[k] ?? parent[k]
    if (v !== undefined) merged[k] = v
  }
  return merged
}

/** Refinements that describe a leaf value or a reference; inherited through extension. */
const LEAF_KEYS = [
  'format',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  'target',
]

export type Resolved = {schema: HypermediaSchema; env: Record<string, any>}

/**
 * Resolve a node to a concrete schema, following var / params / ref+args
 * (application) / ref+refinements (extension) / bare ref (include). `env` binds
 * type variables. `reg` supplies additional (non-bundled) schemas.
 */
/**
 * The schema a node NAMES, when it names one rather than grounding in a kind: `type` holding any
 * schema URL that is not one of the nine kinds. `ref` is the older spelling of the same thing and
 * still resolves, so schemas published before the two keys merged keep working.
 */
export function namedSchemaUrl(schema: HypermediaSchema): string | null {
  if (typeof schema.type === 'string') return kindOf(schema.type) === schema.type ? schema.type : null
  return typeof schema.ref === 'string' ? schema.ref : null
}

export function resolveSchema(
  schema: HypermediaSchema,
  env: Record<string, any> = {},
  reg: SchemaRegistry = {},
): Resolved {
  if (isLiteralSchema(schema)) return {schema: literalNode(schema), env}
  if (schema.params) {
    const penv = {...env}
    for (const [p, def] of Object.entries(schema.params)) if (penv[p] === undefined) penv[p] = def
    const {params, ...body} = schema
    return resolveSchema(body, penv, reg)
  }
  if (schema.var !== undefined) {
    const bound = env[schema.var]
    if (bound === undefined) return {schema: {__unbound: schema.var}, env: {}}
    return resolveSchema(bound, {}, reg)
  }
  const named = namedSchemaUrl(schema)
  if (named && schema.anyOf === undefined) {
    const target = loadFrom(reg, named)
    if (!target) return {schema: {__missing: named}, env: {}}
    if (schema.args) {
      const argsEnv: Record<string, any> = {}
      for (const [k, v] of Object.entries<any>(schema.args)) argsEnv[k] = v && v.var !== undefined ? env[v.var] : v
      return resolveSchema(target, argsEnv, reg) // application: fresh env from args
    }
    const parent = resolveSchema(target, env, reg)
    if (REFINE.some((k) => schema[k] !== undefined)) {
      if (parent.schema.anyOf || parent.schema.__unbound) return parent // can't extend a union/var
      return {schema: mergeExtend(parent.schema, schema), env: parent.env}
    }
    return parent
  }
  return {schema, env}
}

const deepEqual = (a: any, b: any): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Returns a list of error strings. Empty == valid. `env` binds type variables. */
export function validate(
  schema0: HypermediaSchema,
  data: any,
  path = '$',
  env0: Record<string, any> = {},
  reg: SchemaRegistry = {},
): string[] {
  const {schema, env} = resolveSchema(schema0, env0, reg)

  if (schema.__unbound) return [`${path}: unbound type variable "${schema.__unbound}"`]
  if (schema.__missing) return [`${path}: unresolved reference "${schema.__missing}"`]

  if (isLiteralSchema(schema))
    return deepEqual(schema.value, data)
      ? []
      : [`${path}: expected ${JSON.stringify(schema.value)}, got ${JSON.stringify(data)}`]

  if (schema.anyOf) {
    if (schema.anyOf.length === 0) return [`${path}: no value matches an empty union (none)`]
    const attempts = schema.anyOf.map((v: HypermediaSchema) => validate(v, data, path, env, reg))
    if (attempts.some((e: string[]) => e.length === 0)) return []
    const topLevel = (errs: string[]) => errs.some((e) => e.startsWith(`${path}: expected`))
    const best = attempts
      .slice()
      .sort((a: string[], b: string[]) => Number(topLevel(a)) - Number(topLevel(b)) || a.length - b.length)[0]
    return [`${path}: matches none of the ${schema.anyOf.length} variants`, ...best]
  }

  const errors: string[] = []
  const kind = schema.type ? kindOf(schema.type) : null
  if (kind && !typeMatches(kind, data)) {
    errors.push(`${path}: expected ${kind}, got ${typeOf(data)}`)
    return errors
  }
  if (kind === 'map' || kind === 'struct') {
    // An undefined value is an absent field: DAG-CBOR has no undefined, so it never reaches the wire.
    for (const key of requiredFieldNames(schema))
      if (!(key in data) || data[key] === undefined) errors.push(`${path}: missing required "${key}"`)
    const closed = schema.properties && !schema.values
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue
      const child = fieldSchema(schema, key) ?? schema.values
      if (child) errors.push(...validate(child, value, `${path}.${key}`, env, reg))
      else if (closed) errors.push(`${path}: unexpected key "${key}"`)
    }
  }
  if (kind === 'list') {
    if (schema.items)
      (data as any[]).forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`, env, reg)))
    if (typeof schema.minItems === 'number' && data.length < schema.minItems)
      errors.push(`${path}: expected at least ${schema.minItems} items`)
    if (typeof schema.maxItems === 'number' && data.length > schema.maxItems)
      errors.push(`${path}: expected at most ${schema.maxItems} items`)
  }
  if (kind === 'string') {
    const len = [...data].length // code points, not UTF-16 units
    if (typeof schema.minLength === 'number' && len < schema.minLength)
      errors.push(`${path}: expected at least ${schema.minLength} characters`)
    if (typeof schema.maxLength === 'number' && len > schema.maxLength)
      errors.push(`${path}: expected at most ${schema.maxLength} characters`)
    if (typeof schema.pattern === 'string') {
      let re: RegExp | null = null
      try {
        re = new RegExp(schema.pattern)
      } catch {
        re = null // uncompilable pattern is ignored
      }
      if (re && !re.test(data))
        errors.push(
          typeof schema.format === 'string'
            ? `${path}: does not match pattern for format "${schema.format}"`
            : `${path}: does not match pattern`,
        )
    }
  }
  if (kind === 'integer' || kind === 'float') {
    if (typeof schema.minimum === 'number' && data < schema.minimum)
      errors.push(`${path}: expected a value >= ${schema.minimum}`)
    if (typeof schema.maximum === 'number' && data > schema.maximum)
      errors.push(`${path}: expected a value <= ${schema.maximum}`)
  }

  return errors
}

/** Advisory (warn-don't-block) validation — identical checks to validate(). */
export const validateAdvisory = validate

/**
 * True when a value is itself a Hypermedia schema — i.e. it validates against the
 * meta-schema (`schema`). Replaces v1's `isSchemaBlob` (which matched a
 * reserved `schema` link to a fixed meta-schema CID); here a blob IS a schema
 * iff it conforms to the discriminated-union meta-schema.
 */
export function isHypermediaSchema(value: unknown, reg: SchemaRegistry = {}): boolean {
  const meta = HM_SCHEMAS['schema']
  if (!meta || !value || typeof value !== 'object') return false
  return validate(meta, value, '$', {}, reg).length === 0
}

/**
 * What a schema IS, as a page to open: a union, a type parameter, a core type
 * (Struct, Map, String…), or the type it extends. Null when nothing names it.
 */
export function schemaShape(schema: HypermediaSchema | undefined): {label: string; slug: string} | null {
  if (schema === undefined) return null
  if (isLiteralSchema(schema)) return {label: 'Literal', slug: 'schema/literal-schema'}
  if (typeof schema !== 'object') return null
  if (Array.isArray(schema.anyOf)) return {label: 'Union', slug: 'schema/anyof'}
  if (typeof schema.var === 'string') return {label: `⟨${schema.var}⟩`, slug: 'schema/var-schema'}
  if (typeof schema.type === 'string') {
    const kind = kindOf(schema.type)
    const slug = kind !== schema.type ? kind : refToName(schema.type)
    if (HM_SCHEMAS[slug]) return {label: HM_SCHEMA_PAGES[slug]?.name ?? slug, slug}
    return null
  }
  if (typeof schema.ref === 'string') {
    const slug = refToName(schema.ref)
    return HM_SCHEMAS[slug] ? {label: HM_SCHEMA_PAGES[slug]?.name ?? slug, slug} : null
  }
  return null
}

// --- dependency graph (for the explorer) -----------------------------------

/**
 * All schemas a schema node mentions (recursively), as basenames: every `type` — whether it names a
 * core kind (a struct depends on `struct`, a map on `map`, so a kind's page lists who builds on it)
 * or another schema — plus a reference's `target`, and the older `ref` spelling.
 */
export function collectRefs(schema: any, acc = new Set<string>()): Set<string> {
  if (!schema || typeof schema !== 'object') return acc
  if (Array.isArray(schema)) {
    for (const s of schema) collectRefs(s, acc)
    return acc
  }
  if (typeof schema.ref === 'string') acc.add(refToName(schema.ref))
  if (typeof schema.type === 'string') {
    const kind = kindOf(schema.type)
    if (kind !== schema.type) {
      if (HM_SCHEMAS[kind]) acc.add(kind)
    } else acc.add(refToName(schema.type))
  }
  if (typeof schema.target === 'string') acc.add(refToName(schema.target))
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'ref' || k === 'type' || k === 'target') continue
    if (v && typeof v === 'object') collectRefs(v, acc)
  }
  return acc
}

/** Direct dependencies (schemas this one references), sorted, self excluded. */
export function dependencies(name: string, registry: SchemaRegistry = HM_SCHEMAS): string[] {
  const schema = registry[name] ?? HM_SCHEMAS[name]
  if (!schema) return []
  return Array.from(collectRefs(schema))
    .filter((n) => n !== name && (registry[n] || HM_SCHEMAS[n]))
    .sort()
}

/** Reverse dependencies (schemas that reference this one), sorted. */
export function dependents(name: string, registry: SchemaRegistry = HM_SCHEMAS): string[] {
  const out: string[] = []
  for (const [other, schema] of Object.entries(registry)) {
    if (other === name) continue
    if (collectRefs(schema).has(name)) out.push(other)
  }
  return out.sort()
}

export {HM_SCHEMAS, HM_SCHEMA_MANIFEST}

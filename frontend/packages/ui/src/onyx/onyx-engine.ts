// The Onyx validation engine — a TypeScript port of the reference validator
// (schemas/validate.mjs), resolving schema references from the bundled
// ONYX_SCHEMAS instead of the filesystem. Kept behaviorally identical so the
// in-app schema explorer/editor can never disagree with the reference oracle.
//
// Onyx data model (9 kinds): null, boolean, integer, float, string, bytes,
// list, map, link. In dag-json form a link is {"/":"<cid>"} and bytes is
// {"/":{"bytes":"<base64>"}} — both distinct kinds, NOT maps.

import {ONYX_AUTHORITY, ONYX_MANIFEST, ONYX_SCHEMAS} from './onyx-schemas.generated'

export type OnyxSchema = Record<string, any>
/** basename (no .json) -> schema, e.g. "onyx-map-schema". A caller may pass a
 * custom registry to resolve refs that aren't in the bundled standard library. */
export type OnyxRegistry = Record<string, OnyxSchema>

// References are hm:// URLs; bundled schemas are keyed by their filename alias
// (no .json). Each authority maps to a filename prefix — the only place the
// mapping lives (mirrors schemas/validate.mjs AUTHORITY).
const KIND_URL = /^hm:\/\/hyper\.media\/([a-z]+)$/

/** hm:// URL (or bare name) -> bundled-schema key (basename, no .json). */
export function refToName(ref: string): string {
  const m = /^hm:\/\/([^/]+)\/(.+)$/.exec(ref)
  if (!m) return ref.replace(/\.json$/, '')
  const [, auth = '', name = ''] = m
  const prefix = ONYX_AUTHORITY.find(([, a]) => a === auth)?.[0]
  return prefix ? `${prefix}${name}` : name
}

/** bundled-schema key (basename) -> canonical hm:// URL, or null if unknown authority. */
export function nameToUrl(name: string): string | null {
  const entry = ONYX_AUTHORITY.find(([p]) => name.startsWith(p))
  if (!entry) return null
  const [prefix, host] = entry
  return `hm://${host}/${name.slice(prefix.length)}`
}

/** Published DAG-CBOR CID for a schema (by basename or hm:// URL), if in the manifest. */
export function schemaCid(nameOrUrl: string): string | undefined {
  const url = nameOrUrl.startsWith('hm://') ? nameOrUrl : nameToUrl(nameOrUrl)
  return url ? ONYX_MANIFEST[url] : undefined
}

// Reverse of the manifest: a published DAG-CBOR CID -> the bundled schema's
// basename. Lets a document's `schemaDefinition` (ipfs://<cid>) resolve to a
// bundled Onyx schema without a network fetch — the bundled schemas encode to
// the same CIDs as the published ones (see schemas/publish.mjs).
const CID_TO_NAME: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  for (const [url, cid] of Object.entries(ONYX_MANIFEST)) {
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

/** The bundled Onyx schema for a published CID (or ipfs://<cid> URL), if known. */
export function schemaForCid(cidOrUrl: string): OnyxSchema | undefined {
  const name = nameForCid(cidOrUrl)
  return name ? ONYX_SCHEMAS[name] : undefined
}

export function loadFrom(registry: OnyxRegistry, ref: string): OnyxSchema | undefined {
  const name = refToName(ref)
  return registry[name] ?? ONYX_SCHEMAS[name]
}

/** Resolve a ref against the bundled standard library. */
export const load = (ref: string): OnyxSchema | undefined => loadFrom(ONYX_SCHEMAS, ref)

// An instance is data typed by a schema: { "$type": <schema-url>, "value": … }.
export const isInstance = (doc: any): boolean => !!(doc && typeof doc === 'object' && doc.$type && 'value' in doc)

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
export const kindOf = (t: string): string => KIND_URL.exec(t)?.[1] ?? t

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
      return typeOf(d) === 'map'
    case 'link':
      return isLink(d)
    default:
      return false
  }
}

const REFINE = ['properties', 'required', 'values', 'items', 'enum']

/** Merge an extension node's refinements over its (resolved) parent — a subtype. */
export function mergeExtend(parent: OnyxSchema, ext: OnyxSchema): OnyxSchema {
  const merged: OnyxSchema = {type: parent.type}
  const props = {...(parent.properties || {}), ...(ext.properties || {})}
  if (Object.keys(props).length) merged.properties = props
  const req = Array.from(new Set([...(parent.required || []), ...(ext.required || [])]))
  if (req.length) merged.required = req
  const values = ext.values ?? parent.values
  if (values) merged.values = values
  const items = ext.items ?? parent.items
  if (items) merged.items = items
  const en = ext.enum ?? parent.enum
  if (en) merged.enum = en
  return merged
}

export type Resolved = {schema: OnyxSchema; env: Record<string, any>}

/**
 * Resolve a node to a concrete schema, following var / params / ref+args
 * (application) / ref+refinements (extension) / bare ref (include). `env` binds
 * type variables. `reg` supplies additional (non-bundled) schemas.
 */
export function resolveSchema(schema: OnyxSchema, env: Record<string, any> = {}, reg: OnyxRegistry = {}): Resolved {
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
  if (schema.ref && schema.type === undefined && schema.anyOf === undefined) {
    const target = loadFrom(reg, schema.ref)
    if (!target) return {schema: {__missing: schema.ref}, env: {}}
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
    return parent // bare include
  }
  return {schema, env}
}

const deepEqual = (a: any, b: any): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Returns a list of error strings. Empty == valid. `env` binds type variables. */
export function validate(
  schema0: OnyxSchema,
  data: any,
  path = '$',
  env0: Record<string, any> = {},
  reg: OnyxRegistry = {},
): string[] {
  const {schema, env} = resolveSchema(schema0, env0, reg)

  if (schema.__unbound) return [`${path}: unbound type variable "${schema.__unbound}"`]
  if (schema.__missing) return [`${path}: unresolved reference "${schema.__missing}"`]

  if (schema.anyOf) {
    const attempts = schema.anyOf.map((v: OnyxSchema) => validate(v, data, path, env, reg))
    if (attempts.some((e: string[]) => e.length === 0)) return []
    const topLevel = (errs: string[]) => errs.some((e) => e.startsWith(`${path}: expected`))
    const best = attempts
      .slice()
      .sort((a: string[], b: string[]) => Number(topLevel(a)) - Number(topLevel(b)) || a.length - b.length)[0]
    return [`${path}: matches none of the ${schema.anyOf.length} variants`, ...best]
  }

  const errors: string[] = []
  if (schema.enum && !schema.enum.some((v: any) => deepEqual(v, data)))
    errors.push(`${path}: ${JSON.stringify(data)} not in enum ${JSON.stringify(schema.enum)}`)

  const kind = schema.type ? kindOf(schema.type) : null
  if (kind && !typeMatches(kind, data)) {
    errors.push(`${path}: expected ${kind}, got ${typeOf(data)}`)
    return errors
  }
  if (kind === 'map') {
    for (const key of schema.required ?? []) if (!(key in data)) errors.push(`${path}: missing required "${key}"`)
    const closed = schema.properties && !schema.values
    for (const [key, value] of Object.entries(data)) {
      const child = schema.properties?.[key] ?? schema.values
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
      if (re && !re.test(data)) errors.push(`${path}: does not match pattern`)
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

// --- dependency graph (for the explorer) -----------------------------------

/** All schema refs a schema node mentions (recursively), as basenames. */
export function collectRefs(schema: any, acc = new Set<string>()): Set<string> {
  if (!schema || typeof schema !== 'object') return acc
  if (Array.isArray(schema)) {
    for (const s of schema) collectRefs(s, acc)
    return acc
  }
  if (typeof schema.ref === 'string') acc.add(refToName(schema.ref))
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'ref') continue
    if (v && typeof v === 'object') collectRefs(v, acc)
  }
  return acc
}

/** Direct dependencies (schemas this one references), sorted, self excluded. */
export function dependencies(name: string, registry: OnyxRegistry = ONYX_SCHEMAS): string[] {
  const schema = registry[name] ?? ONYX_SCHEMAS[name]
  if (!schema) return []
  return Array.from(collectRefs(schema))
    .filter((n) => n !== name && (registry[n] || ONYX_SCHEMAS[n]))
    .sort()
}

/** Reverse dependencies (schemas that reference this one), sorted. */
export function dependents(name: string, registry: OnyxRegistry = ONYX_SCHEMAS): string[] {
  const out: string[] = []
  for (const [other, schema] of Object.entries(registry)) {
    if (other === name) continue
    if (collectRefs(schema).has(name)) out.push(other)
  }
  return out.sort()
}

export {ONYX_SCHEMAS, ONYX_MANIFEST, ONYX_AUTHORITY}

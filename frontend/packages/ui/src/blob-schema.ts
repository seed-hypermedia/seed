import {DagJsonLink, isDagJsonBytes, isDagJsonLink} from './dag-json'
import type {ValuePath} from './value-editor'

/**
 * Pure core for the "Seed Blob Schema v1" dialect (see
 * docs/blob-schemas/schema-dialect.md): a JSON-Schema-2020-12 subset extended
 * with IPLD's link/bytes kinds, stored as DAG-CBOR blobs. No React, no IO — a
 * synchronous subschema navigator, an advisory (warn-don't-block) validator, a
 * starter-value instantiator, and the bootstrap meta-schema.
 *
 * External `$ref`s are IPLD links resolved out-of-band into a plain registry
 * (cid → schema) before any of these functions run; validation stays sync/pure.
 */

// The seven JSON-Schema primitive type names the dialect supports (no arrays of
// types in v1). DAG-CBOR distinguishes int/float encodings, hence integer vs number.
export type SchemaType = 'null' | 'boolean' | 'integer' | 'number' | 'string' | 'array' | 'object'

// Our IPLD extension, a sibling of `type` (mutually exclusive). An unknown
// keyword to vanilla validators, so it degrades to a harmless annotation.
export type SchemaKind = 'link' | 'bytes'

export type BlobSchema = {
  type?: SchemaType
  kind?: SchemaKind
  title?: string
  description?: string
  default?: unknown
  enum?: unknown[]
  const?: unknown
  properties?: Record<string, BlobSchema>
  required?: string[]
  additionalProperties?: boolean
  items?: BlobSchema
  minItems?: number
  maxItems?: number
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  $defs?: Record<string, BlobSchema>
  // Union: the value must match one of these variants. Discriminated object
  // unions (a shared tag property with a distinct const/single-enum literal
  // per variant) get precise per-variant warnings.
  oneOf?: BlobSchema[]
  // Internal JSON pointer (`#/$defs/Name`) or external IPLD link (`{"/": cid}`).
  $ref?: string | DagJsonLink
  // For kind:"link" — the schema the linked blob is expected to conform to. Hint-only.
  targetSchema?: DagJsonLink
  maxBytes?: number
  // Unknown keywords are legal and ignored (annotation semantics).
  [keyword: string]: unknown
}

export type SchemaWarning = {path: ValuePath; message: string; keyword: string}

// cid string → schema blob. Populated by the app before validation runs.
export type SchemaRegistry = Record<string, BlobSchema>

// Guards against runaway recursion on pathological schemas or (defensively)
// circular JS values that could never come from the DAG-JSON path.
const MAX_DEPTH = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

// A real object leaf, not one of the two DAG-JSON kind forms.
function isPlainObjectValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !isDagJsonLink(value) && !isDagJsonBytes(value)
}

// ---------------------------------------------------------------------------
// $ref dereferencing
// ---------------------------------------------------------------------------

// Following a $ref chain yields both the target node and the blob it lives in
// (the "root"): after an external link the root becomes the referenced blob, so
// subsequent internal pointers resolve within it — not the original root.
type Deref = {schema: BlobSchema; root: BlobSchema}

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

// Own-property lookup that can't be fooled by Object.prototype members
// ('constructor', 'toString', …) on JSON-parsed data.
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

// Resolve a `#/a/b` JSON pointer within a single blob. Returns undefined when
// the pointer is malformed or doesn't land on an object node. `#` and `#/`
// both mean the root (documented dialect deviation from RFC 6901's ""-key
// reading of `#/`).
function resolveJsonPointer(root: BlobSchema, pointer: string): BlobSchema | undefined {
  if (pointer === '#' || pointer === '#/') return root
  if (!pointer.startsWith('#/')) return undefined
  const parts = pointer.slice(2).split('/').map(decodePointerSegment)
  let node: unknown = root
  for (const part of parts) {
    if (Array.isArray(node)) {
      const index = /^\d+$/.test(part) ? Number(part) : NaN
      node = Number.isInteger(index) ? node[index] : undefined
    } else if (isRecord(node) && hasOwn(node, part)) {
      node = node[part]
    } else {
      return undefined
    }
  }
  return isRecord(node) && !Array.isArray(node) ? (node as BlobSchema) : undefined
}

/**
 * Follow a node's `$ref` chain to the concrete schema it names. `visited` holds
 * node identities to break cycles: a revisited node means a recursive internal
 * ref, which yields 'unresolved' (never an infinite loop). External refs can't
 * cycle (immutable Merkle DAG) but a missing registry entry is also 'unresolved'.
 * A malformed `$ref` (neither pointer string nor link) is ignored — the node is
 * returned as-is. Siblings of `$ref` are not merged in v1.
 */
function derefSchema(
  node: BlobSchema,
  root: BlobSchema,
  registry: SchemaRegistry,
  visited: Set<BlobSchema>,
): Deref | 'unresolved' {
  let current: BlobSchema = node
  let currentRoot = root
  let guard = 0
  while (isRecord(current) && current.$ref !== undefined) {
    // A ref chain longer than the guard is unresolvable, not "resolved as-is".
    if (guard++ >= MAX_DEPTH) return 'unresolved'
    const ref = current.$ref
    let target: BlobSchema | undefined
    let targetRoot = currentRoot
    if (typeof ref === 'string') {
      target = resolveJsonPointer(currentRoot, ref)
    } else if (isDagJsonLink(ref)) {
      target = registry[ref['/']]
      targetRoot = target as BlobSchema
      if (!target) return 'unresolved'
    } else {
      break // malformed $ref: leave the node in place
    }
    if (target === undefined) return 'unresolved' // dangling internal pointer
    if (visited.has(target)) return 'unresolved' // cycle
    visited.add(target)
    current = target
    currentRoot = targetRoot
  }
  return {schema: current, root: currentRoot}
}

// ---------------------------------------------------------------------------
// resolveSubschema
// ---------------------------------------------------------------------------

/**
 * Walk a value path into its declaring subschema: string segments descend
 * `properties`, number segments descend `items`. Refs are dereferenced at every
 * step. Returns the resolved schema, 'unresolved' when a ref can't be followed
 * yet (a neutral loading state), or undefined when the schema simply says
 * nothing at that path (e.g. an undeclared property).
 */
function resolveSubschemaDeref(
  root: BlobSchema,
  path: ValuePath,
  registry: SchemaRegistry,
): Deref | 'unresolved' | undefined {
  const first = derefSchema(root, root, registry, new Set())
  if (first === 'unresolved') return 'unresolved'
  let node = first.schema
  let currentRoot = first.root
  for (const segment of path) {
    let child: unknown
    if (typeof segment === 'string') {
      child = isRecord(node.properties) && hasOwn(node.properties, segment) ? node.properties[segment] : undefined
    } else {
      child = isRecord(node.items) ? node.items : undefined
    }
    if (!isRecord(child)) return undefined
    const deref = derefSchema(child as BlobSchema, currentRoot, registry, new Set())
    if (deref === 'unresolved') return 'unresolved'
    node = deref.schema
    currentRoot = deref.root
  }
  return {schema: node, root: currentRoot}
}

export function resolveSubschema(
  root: BlobSchema,
  path: ValuePath,
  registry: SchemaRegistry,
): BlobSchema | 'unresolved' | undefined {
  const resolved = resolveSubschemaDeref(root, path, registry)
  if (resolved === 'unresolved' || resolved === undefined) return resolved
  return resolved.schema
}

// ---------------------------------------------------------------------------
// collectSchemaRefs
// ---------------------------------------------------------------------------

// Collect the external ref / targetSchema link CIDs within one blob (structural
// walk of nested schemas — never into `default`/`const`/`enum` data).
function collectRefsInBlob(node: BlobSchema, onCid: (cid: string) => void, depth: number): void {
  if (!isRecord(node) || depth > MAX_DEPTH) return
  if (isDagJsonLink(node.$ref)) onCid(node.$ref['/'])
  if (isDagJsonLink(node.targetSchema)) onCid(node.targetSchema['/'])
  if (isRecord(node.properties)) {
    for (const child of Object.values(node.properties)) collectRefsInBlob(child as BlobSchema, onCid, depth + 1)
  }
  if (isRecord(node.$defs)) {
    for (const child of Object.values(node.$defs)) collectRefsInBlob(child as BlobSchema, onCid, depth + 1)
  }
  if (isRecord(node.items)) collectRefsInBlob(node.items as BlobSchema, onCid, depth + 1)
  if (Array.isArray(node.oneOf)) {
    for (const child of node.oneOf) collectRefsInBlob(child as BlobSchema, onCid, depth + 1)
  }
}

/**
 * All external ref CIDs reachable from a schema, transitively through registry
 * entries already present (targetSchema link CIDs included — they're schema
 * blobs worth prefetching for labels). Deduped. Callers fetch iteratively:
 * collect → fetch missing → collect again.
 */
export function collectSchemaRefs(schema: BlobSchema, registry?: SchemaRegistry): string[] {
  const found = new Set<string>()
  const queue: BlobSchema[] = [schema]
  const seenBlobs = new Set<BlobSchema>()
  while (queue.length) {
    const blob = queue.shift()!
    if (!isRecord(blob) || seenBlobs.has(blob)) continue
    seenBlobs.add(blob)
    collectRefsInBlob(
      blob,
      (cid) => {
        if (!found.has(cid)) {
          found.add(cid)
          const next = registry?.[cid]
          if (next) queue.push(next)
        }
      },
      0,
    )
  }
  return Array.from(found)
}

// ---------------------------------------------------------------------------
// Deep equality (for enum / const), tolerant of bigint vs number
// ---------------------------------------------------------------------------

function isNumeric(value: unknown): value is number | bigint {
  return typeof value === 'bigint' || (typeof value === 'number' && Number.isFinite(value))
}

function deepEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true
  if (depth > MAX_DEPTH) return false
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    // Bigint tolerance is numeric-only: a bigint never equals a string or
    // boolean enum member, but 10n equals 10.
    if (!isNumeric(a) || !isNumeric(b)) return false
    try {
      return BigInt(a) === BigInt(b)
    } catch {
      return false // non-integer number vs bigint
    }
  }
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i], depth + 1))
  }
  if (typeof a === 'object') {
    const ak = Object.keys(a as object)
    const bk = Object.keys(b as object)
    if (ak.length !== bk.length) return false
    return ak.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth + 1),
    )
  }
  return false
}

// ---------------------------------------------------------------------------
// validateValue
// ---------------------------------------------------------------------------

// Schemas can arrive from the network, and validation runs synchronously on
// the UI thread — an adversarial pattern like `(a+)+$` backtracks
// exponentially and would freeze the window. JS has no linear-time regex
// engine, so patterns are bounded instead: size caps plus a shape heuristic
// rejecting the classic catastrophic forms (a quantified group containing a
// quantifier or alternation, at any nesting depth). Skipped patterns are
// neutral — no warning either way. Compiled patterns are memoized; the cache
// doubles as the invalid/risky-pattern memo.
const PATTERN_MAX_LENGTH = 100
const PATTERN_SUBJECT_MAX_LENGTH = 200
const patternCache = new Map<string, RegExp | null>()

// Marker standing in for a collapsed group that contained a quantifier or
// alternation ("backtracking fuel") — propagates risk to outer passes.
const FUEL = '\x01'

// Detects quantified groups whose body contains a quantifier or alternation
// (`(a+)+`, `(a|a)*`, `((a+))+`…) by collapsing innermost groups outward.
function isRiskyPattern(pattern: string): boolean {
  let p = pattern
  for (let i = 0; i < 25; i++) {
    let risky = false
    const next = p.replace(/\(\??:?([^()]*)\)([+*]|\{\d+(?:,\d*)?\})?/g, (_m, inner: string, quant?: string) => {
      const innerHasBacktrackFuel = /[+*|{]/.test(inner) || inner.includes(FUEL)
      if (quant && innerHasBacktrackFuel) risky = true

      return innerHasBacktrackFuel ? FUEL : 'x'
    })
    if (risky) return true
    if (next === p) break
    p = next
  }
  return false
}

// true = matches, false = does not match, undefined = skipped/neutral.
function testPattern(pattern: string, value: string): boolean | undefined {
  if (pattern.length > PATTERN_MAX_LENGTH || value.length > PATTERN_SUBJECT_MAX_LENGTH) return undefined
  let re = patternCache.get(pattern)
  if (re === undefined) {
    try {
      re = isRiskyPattern(pattern) ? null : new RegExp(pattern) // unanchored, per spec
    } catch {
      re = null // invalid regex in the schema is ignored
    }
    if (patternCache.size > 500) patternCache.clear()
    patternCache.set(pattern, re)
  }
  if (re === null) return undefined
  return re.test(value)
}

// A finite JS number from a number or (tolerated) bigint; otherwise undefined.
function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'bigint') return Number(value)
  return undefined
}

// A usable numeric keyword value, or undefined when malformed (ignored, not warned).
function keywordNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function articleFor(typeName: SchemaType): string {
  switch (typeName) {
    case 'string':
      return 'expected a string'
    case 'integer':
      return 'expected a whole number'
    case 'number':
      return 'expected a number'
    case 'boolean':
      return 'expected a boolean'
    case 'null':
      return 'expected null'
    case 'array':
      return 'expected a list'
    case 'object':
      return 'expected an object'
  }
}

function typeMatches(value: unknown, type: SchemaType): boolean {
  switch (type) {
    case 'null':
      return value === null
    case 'boolean':
      return typeof value === 'boolean'
    case 'integer':
      return (typeof value === 'number' && Number.isInteger(value)) || typeof value === 'bigint'
    case 'number':
      return (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint'
    case 'string':
      return typeof value === 'string'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObjectValue(value)
  }
}

const KNOWN_TYPES: SchemaType[] = ['null', 'boolean', 'integer', 'number', 'string', 'array', 'object']

// The single literal a union variant fixes for a property: its `const`, or a
// one-member `enum` (how the schema form authors tags).
function variantTagLiteral(node: unknown): unknown {
  if (!isRecord(node)) return undefined
  if ('const' in node) return node.const
  if (Array.isArray(node.enum) && node.enum.length === 1) return node.enum[0]
  return undefined
}

/**
 * A discriminator for a set of object variants: a property key that every
 * variant fixes to a distinct scalar literal (via const or one-member enum).
 */
export function findDiscriminator(variants: BlobSchema[]): string | undefined {
  const first = variants[0]
  if (!first || !isRecord(first.properties)) return undefined
  for (const key of Object.keys(first.properties)) {
    const literals = variants.map((variant) =>
      isRecord(variant.properties) ? variantTagLiteral(variant.properties[key]) : undefined,
    )
    const allScalar = literals.every(
      (literal) => typeof literal === 'string' || typeof literal === 'number' || typeof literal === 'boolean',
    )
    if (allScalar && new Set(literals).size === literals.length) return key
  }
  return undefined
}

function validateNode(
  value: unknown,
  schema: BlobSchema,
  root: BlobSchema,
  registry: SchemaRegistry,
  path: ValuePath,
  warnings: SchemaWarning[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) return
  const deref = derefSchema(schema, root, registry, new Set())
  if (deref === 'unresolved') return // unresolved ref is neutral, never a warning
  schema = deref.schema
  root = deref.root
  if (!isRecord(schema)) return

  const warn = (message: string, keyword: string, at: ValuePath = path) => warnings.push({path: at, message, keyword})

  // kind (our IPLD extension) wins over type when both are present.
  if (schema.kind === 'link') {
    if (!isDagJsonLink(value)) warn('expected a link', 'kind')
  } else if (schema.kind === 'bytes') {
    if (!isDagJsonBytes(value)) {
      warn('expected bytes', 'kind')
    } else {
      const max = keywordNumber(schema.maxBytes)
      if (max !== undefined) {
        // Decoded size from the base64 text itself — no need to materialize
        // (potentially large) byte arrays on every validation pass.
        const b64 = value['/'].bytes.replace(/=+$/, '')
        const size = Math.floor((b64.length * 3) / 4)
        if (size > max) warn(`expected at most ${max} bytes`, 'maxBytes')
      }
    }
  } else if (typeof schema.type === 'string' && (KNOWN_TYPES as string[]).includes(schema.type)) {
    if (!typeMatches(value, schema.type)) warn(articleFor(schema.type), 'type')
  }

  // enum / const on leaves — deep equality over JSON-shaped values.
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (!schema.enum.some((member) => deepEqual(value, member))) {
      warn('value is not one of the allowed options', 'enum')
    }
  }
  if ('const' in schema) {
    if (!deepEqual(value, schema.const)) warn('value must equal the fixed value', 'const')
  }

  // Union: match any variant cleanly, else recurse into the discriminated
  // variant for precise warnings, else one gentle summary warning. Any
  // unresolved variant makes the whole check neutral (we can't judge).
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const variants: Deref[] = []
    let unresolved = false
    for (const raw of schema.oneOf) {
      if (!isRecord(raw)) continue
      const variant = derefSchema(raw as BlobSchema, root, registry, new Set())
      if (variant === 'unresolved') {
        unresolved = true
        break
      }
      variants.push(variant)
    }
    if (!unresolved && variants.length > 0) {
      const matched = variants.some((variant) => {
        const scratch: SchemaWarning[] = []
        validateNode(value, variant.schema, variant.root, registry, path, scratch, depth + 1)
        return scratch.length === 0
      })
      if (!matched) {
        const discriminator = findDiscriminator(variants.map((variant) => variant.schema))
        const chosen =
          discriminator && isPlainObjectValue(value) && hasOwn(value, discriminator)
            ? variants.find((variant) =>
                deepEqual(variantTagLiteral(variant.schema.properties?.[discriminator]), value[discriminator]),
              )
            : undefined
        if (chosen) {
          validateNode(value, chosen.schema, chosen.root, registry, path, warnings, depth + 1)
        } else {
          warn(`does not match any of the ${variants.length} allowed variants`, 'oneOf')
        }
      }
    }
  }

  // Structural checks are gated by the actual JS type, so we never recurse into
  // a value shape the schema didn't get (avoids double/spurious warnings).
  if (isPlainObjectValue(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !hasOwn(value, key)) warn(`missing required property "${key}"`, 'required')
      }
    }
    if (isRecord(schema.properties)) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (hasOwn(value, key) && isRecord(sub)) {
          validateNode(value[key], sub as BlobSchema, root, registry, [...path, key], warnings, depth + 1)
        }
      }
    }
    if (schema.additionalProperties === false) {
      const declared = isRecord(schema.properties) ? schema.properties : {}
      for (const key of Object.keys(value)) {
        if (!hasOwn(declared, key))
          warn(`property "${key}" is not allowed by the schema`, 'additionalProperties', [...path, key])
      }
    }
  }

  if (Array.isArray(value)) {
    if (isRecord(schema.items)) {
      for (let i = 0; i < value.length; i++) {
        validateNode(value[i], schema.items as BlobSchema, root, registry, [...path, i], warnings, depth + 1)
      }
    }
    const min = keywordNumber(schema.minItems)
    const max = keywordNumber(schema.maxItems)
    if (min !== undefined && value.length < min)
      warn(`expected at least ${min} item${min === 1 ? '' : 's'}`, 'minItems')
    if (max !== undefined && value.length > max) warn(`expected at most ${max} item${max === 1 ? '' : 's'}`, 'maxItems')
  }

  if (typeof value === 'string') {
    const codepoints = Array.from(value).length
    const min = keywordNumber(schema.minLength)
    const max = keywordNumber(schema.maxLength)
    if (min !== undefined && codepoints < min)
      warn(`expected at least ${min} character${min === 1 ? '' : 's'}`, 'minLength')
    if (max !== undefined && codepoints > max)
      warn(`expected at most ${max} character${max === 1 ? '' : 's'}`, 'maxLength')
    if (typeof schema.pattern === 'string') {
      const verdict = testPattern(schema.pattern, value)
      if (verdict === false) warn('does not match the required pattern', 'pattern')
    }
  }

  const numeric = asFiniteNumber(value)
  if (numeric !== undefined) {
    const min = keywordNumber(schema.minimum)
    const max = keywordNumber(schema.maximum)
    if (min !== undefined && numeric < min) warn(`expected a value of at least ${min}`, 'minimum')
    if (max !== undefined && numeric > max) warn(`expected a value of at most ${max}`, 'maximum')
  }
}

/**
 * Advisory, multi-error validation. Never throws — on any unexpected failure it
 * returns the warnings gathered so far. Unknown/malformed keywords are ignored,
 * unresolved refs are neutral (no warning), and warning paths point into the
 * VALUE, keyed the same way the editor keys its rows.
 */
export function validateValue(value: unknown, schema: BlobSchema, registry: SchemaRegistry): SchemaWarning[] {
  const warnings: SchemaWarning[] = []
  try {
    validateNode(value, schema, schema, registry, [], warnings, 0)
  } catch {
    // defensive: advisory validation must never surface an exception
  }
  return warnings
}

// ---------------------------------------------------------------------------
// instantiateSchema
// ---------------------------------------------------------------------------

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch {
    return value
  }
}

function instantiateNode(
  schema: BlobSchema,
  root: BlobSchema,
  registry: SchemaRegistry,
  visited: Set<BlobSchema>,
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) return undefined
  const deref = derefSchema(schema, root, registry, new Set())
  if (deref === 'unresolved') return undefined // can't fabricate a target we don't have
  const node = deref.schema
  root = deref.root
  if (!isRecord(node)) return undefined
  if (visited.has(node)) return undefined // recursive type — stop expanding

  if ('default' in node) return cloneValue(node.default)
  if ('const' in node) return cloneValue(node.const)
  if (Array.isArray(node.enum) && node.enum.length > 0) return cloneValue(node.enum[0])
  if (Array.isArray(node.oneOf) && isRecord(node.oneOf[0])) {
    return instantiateNode(node.oneOf[0] as BlobSchema, root, registry, visited, depth + 1)
  }

  // Can't fabricate a real CID or bytes payload.
  if (node.kind === 'link' || node.kind === 'bytes') return undefined

  switch (node.type) {
    case 'string':
      return ''
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'null':
      return null
    case 'array':
      return []
    case 'object': {
      const result: Record<string, unknown> = {}
      const required = Array.isArray(node.required) ? node.required : []
      const props = isRecord(node.properties) ? node.properties : {}
      visited.add(node)
      try {
        for (const key of required) {
          if (typeof key !== 'string') continue
          const sub = props[key]
          if (!isRecord(sub)) continue // required but undeclared: nothing to seed
          const child = instantiateNode(sub as BlobSchema, root, registry, visited, depth + 1)
          // Omit link/bytes/unresolved required props — validateValue then shows
          // the gentle missing-required warning, which is the correct signal.
          if (child !== undefined) result[key] = child
        }
      } finally {
        visited.delete(node)
      }
      return result
    }
    default:
      return undefined // no type/kind: nothing sensible to materialize
  }
}

/**
 * Materialize a starter value: `default` wins, else `const`, else `enum[0]`,
 * else a per-type empty (string '', number 0, boolean false, null, [], {}). For
 * objects only REQUIRED properties are seeded recursively; link/bytes/unresolved
 * ones are omitted (a CID/bytes can't be fabricated). Returns undefined when the
 * root itself has nothing to materialize.
 */
export function instantiateSchema(schema: BlobSchema, registry: SchemaRegistry): unknown {
  return instantiateNode(schema, schema, registry, new Set(), 0)
}

/**
 * Instantiate the subschema at a value path while preserving the pointer root
 * it lives in — a subschema's internal `#/$defs` refs resolve against its own
 * blob, not against itself. Use this (not instantiateSchema on a resolved
 * subschema) when seeding a nested field.
 */
export function instantiateAtPath(root: BlobSchema, path: ValuePath, registry: SchemaRegistry): unknown {
  const resolved = resolveSubschemaDeref(root, path, registry)
  if (resolved === 'unresolved' || resolved === undefined) return undefined
  return instantiateNode(resolved.schema, resolved.root, registry, new Set(), 0)
}

// ---------------------------------------------------------------------------
// Meta-schema (bootstrap) + isSchemaBlob
// ---------------------------------------------------------------------------

/**
 * The self-describing meta-schema: an instance of it is a schema blob. It can't
 * fully express itself in the v1 subset (nested schemas are just `type:object`),
 * which is fine — its job is useful key suggestions and enum selects for `type`
 * and `kind` in the schema editor. It deliberately carries NO `schema` key (the
 * bootstrap exception: a content-addressed blob can't contain its own CID).
 */
export const BLOB_META_SCHEMA: BlobSchema = {
  title: 'Blob Schema',
  description: 'A Seed Blob Schema v1 document: a JSON-Schema subset with IPLD link and bytes kinds.',
  type: 'object',
  properties: {
    type: {
      type: 'string',
      title: 'Type',
      description: 'The JSON value type this schema describes.',
      enum: ['null', 'boolean', 'integer', 'number', 'string', 'array', 'object'],
    },
    kind: {
      type: 'string',
      title: 'Kind',
      description: 'An IPLD kind, mutually exclusive with type.',
      enum: ['link', 'bytes'],
    },
    title: {type: 'string', title: 'Title', description: 'A short label for the value.'},
    description: {type: 'string', title: 'Description', description: 'Help text for the value.'},
    default: {title: 'Default', description: 'Value used when materializing a new instance.'},
    enum: {type: 'array', title: 'Enum', description: 'The allowed values for a leaf.'},
    const: {title: 'Const', description: 'A single required value.'},
    properties: {type: 'object', title: 'Properties', description: 'Map of property name to subschema.'},
    required: {
      type: 'array',
      title: 'Required',
      description: 'Property names that must be present.',
      items: {type: 'string'},
    },
    additionalProperties: {
      type: 'boolean',
      title: 'Additional properties',
      description: 'Set false to warn on undeclared properties.',
    },
    items: {type: 'object', title: 'Items', description: 'Subschema applied to every array element.'},
    minItems: {type: 'integer', title: 'Min items', minimum: 0},
    maxItems: {type: 'integer', title: 'Max items', minimum: 0},
    minimum: {type: 'number', title: 'Minimum'},
    maximum: {type: 'number', title: 'Maximum'},
    minLength: {type: 'integer', title: 'Min length', minimum: 0},
    maxLength: {type: 'integer', title: 'Max length', minimum: 0},
    pattern: {type: 'string', title: 'Pattern', description: 'An ECMAScript regular expression (unanchored).'},
    oneOf: {
      type: 'array',
      title: 'Union variants',
      description: 'The value must match one of these subschemas.',
    },
    $defs: {type: 'object', title: 'Definitions', description: 'Named subschemas for internal $ref reuse.'},
    $ref: {title: '$ref', description: 'Internal JSON pointer (#/$defs/Name) or external schema link.'},
    targetSchema: {kind: 'link', title: 'Target schema', description: 'Schema the linked blob should conform to.'},
    maxBytes: {type: 'integer', title: 'Max bytes', minimum: 0},
  },
  additionalProperties: true,
}

// The dialect's keyword names, in the meta-schema's declaration order — handy
// for the schema editor's add-field key suggestions.
export const SCHEMA_KEYWORDS: string[] = Object.keys(BLOB_META_SCHEMA.properties!)

/**
 * CIDv1 (dag-cbor 0x71, sha2-256) of the canonical DAG-CBOR encoding of
 * BLOB_META_SCHEMA. Precomputed and hardcoded because a content-addressed blob
 * can't contain its own CID; blob-schema.test.ts re-derives it from
 * BLOB_META_SCHEMA and asserts equality so this can never silently drift.
 */
export const BLOB_META_SCHEMA_CID = 'bafyreigui6zgijfpiqa7y35bp55bwc7q2debrhdphxwrleohax6j2unjle'

/**
 * A blob is a schema iff its reserved `schema` key is a DAG-JSON link to the
 * meta-schema CID. Any other `schema` value is plain data (never hidden/stripped).
 */
export function isSchemaBlob(value: unknown): boolean {
  if (!isRecord(value)) return false
  const link = value.schema
  return isDagJsonLink(link) && link['/'] === BLOB_META_SCHEMA_CID
}

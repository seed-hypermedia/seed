import {type BlobSchema, type SchemaRegistry} from './blob-schema'
import {isDagJsonLink} from './dag-json'

/**
 * Pure, lossy lowering of the "Seed Blob Schema v1" dialect into the plain
 * JSON-Schema subset the agent tool registry speaks (see design §5). The dialect
 * carries $refs, IPLD link/bytes kinds, hm-url/profile formats, and oneOf unions
 * that the subset can't express; this compiler produces the best honest
 * approximation for an LLM-facing tool `inputSchema`, folding the lost structure
 * into human-readable `description` text. The desktop form generator keeps
 * consuming the rich dialect directly — this is only for the model.
 *
 * Never throws on garbage input: any node that can't be lowered falls back to an
 * empty schema `{}`. Depth- and cycle-guarded throughout.
 */

// The tool-registry JSON Schema subset (replicated locally — packages/ui cannot
// depend on agents/protocol). `type: 'null'` is intentionally absent: the subset
// has no null type, so a null schema lowers to a described {} instead.
export type PlainJsonSchema = {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
  description?: string
  properties?: Record<string, PlainJsonSchema>
  required?: string[]
  additionalProperties?: boolean
  enum?: (string | number)[]
  minLength?: number
  minimum?: number
  maximum?: number
  maxLength?: number
  items?: PlainJsonSchema
}

const MAX_DEPTH = 200

// The dialect types that survive lowering unchanged ('null' has no subset form).
const KNOWN_PLAIN_TYPES: string[] = ['object', 'string', 'number', 'integer', 'boolean', 'array']

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function decodePointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

// Resolve a `#/a/b` JSON pointer within one blob (same semantics as
// blob-schema.ts: `#`/`#/` both mean the root).
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

type Deref = {schema: BlobSchema; root: BlobSchema}

// Follow a node's $ref chain (internal pointer or external {'/':cid} via the
// registry). `visited` breaks cycles. Returns 'unresolved' when a ref can't be
// followed — the caller then lowers to a permissive described {}.
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
      break // malformed $ref: use the node as-is
    }
    if (target === undefined) return 'unresolved'
    if (visited.has(target)) return 'unresolved'
    visited.add(target)
    current = target
    currentRoot = targetRoot
  }
  return {schema: current, root: currentRoot}
}

// The title of the schema a `targetSchema` link points at (for link
// descriptions), resolved directly through the registry, or undefined.
function targetSchemaTitle(target: unknown, registry: SchemaRegistry): string | undefined {
  if (!isDagJsonLink(target)) return undefined
  const schema = registry[target['/']]
  return isRecord(schema) && typeof schema.title === 'string' ? schema.title : undefined
}

// Compose the leading description text from a node's title + description: both →
// 'Title — description', one → that one, neither → undefined.
function composeDescription(node: BlobSchema): string | undefined {
  const title = typeof node.title === 'string' ? node.title.trim() : ''
  const description = typeof node.description === 'string' ? node.description.trim() : ''
  if (title && description) return `${title} — ${description}`
  return title || description || undefined
}

// Append a clause to a schema's description, starting one if absent.
function appendDescription(schema: PlainJsonSchema, clause: string): void {
  schema.description = schema.description ? `${schema.description} ${clause}` : clause
}

function keywordNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// A one-line summary of a subschema for oneOf text: its composed description, or
// its type/kind as a fallback so the model at least knows the shape.
function variantSummary(node: BlobSchema, root: BlobSchema, registry: SchemaRegistry): string {
  const deref = derefSchema(node, root, registry, new Set())
  if (deref === 'unresolved') return 'a reference'
  const resolved = deref.schema
  const described = composeDescription(resolved)
  if (described) return described
  if (resolved.kind === 'link') return 'a link'
  if (resolved.kind === 'bytes') return 'bytes'
  if (typeof resolved.type === 'string') return resolved.type
  return 'a value'
}

// The lowered `type` shared by a set of dialect variants, or undefined when they
// disagree or aren't all plain object/string/number/integer/boolean/array types.
function sharedPlainType(
  variants: BlobSchema[],
  root: BlobSchema,
  registry: SchemaRegistry,
): PlainJsonSchema['type'] | undefined {
  let shared: PlainJsonSchema['type'] | undefined
  for (const variant of variants) {
    const deref = derefSchema(variant, root, registry, new Set())
    if (deref === 'unresolved') return undefined
    const type = deref.schema.type
    // link/bytes/hm variants lower to string; a plain 'string' type also does.
    const lowered: PlainJsonSchema['type'] | undefined =
      deref.schema.kind === 'link' || deref.schema.kind === 'bytes'
        ? 'string'
        : type === 'string' ||
            type === 'number' ||
            type === 'integer' ||
            type === 'boolean' ||
            type === 'array' ||
            type === 'object'
          ? type
          : undefined
    if (lowered === undefined) return undefined
    if (shared === undefined) shared = lowered
    else if (shared !== lowered) return undefined
  }
  return shared
}

function lowerNode(schema: BlobSchema, root: BlobSchema, registry: SchemaRegistry, depth: number): PlainJsonSchema {
  if (depth > MAX_DEPTH || !isRecord(schema)) return {}

  const deref = derefSchema(schema, root, registry, new Set())
  if (deref === 'unresolved') return {description: 'unresolved reference'}
  const node = deref.schema
  root = deref.root
  if (!isRecord(node)) return {}

  const out: PlainJsonSchema = {}
  const baseDescription = composeDescription(node)
  if (baseDescription) out.description = baseDescription

  // Copy through numeric bounds when well-formed.
  const minLength = keywordNumber(node.minLength)
  const maxLength = keywordNumber(node.maxLength)
  const minimum = keywordNumber(node.minimum)
  const maximum = keywordNumber(node.maximum)
  if (minLength !== undefined) out.minLength = minLength
  if (maxLength !== undefined) out.maxLength = maxLength
  if (minimum !== undefined) out.minimum = minimum
  if (maximum !== undefined) out.maximum = maximum

  // Union: the subset has no oneOf. Describe the variants; keep a shared type if
  // every variant lowers to the same one. Recurse only for the summary text.
  if (Array.isArray(node.oneOf) && node.oneOf.length > 0) {
    const variants = node.oneOf.filter(isRecord) as BlobSchema[]
    const summaries = variants.map((variant) => variantSummary(variant, root, registry))
    appendDescription(out, `One of: ${summaries.join('; ')}.`)
    const shared = sharedPlainType(variants, root, registry)
    if (shared) out.type = shared
    return out
  }

  // IPLD kinds lower to string with an explanatory description.
  if (node.kind === 'link') {
    out.type = 'string'
    const targetTitle = targetSchemaTitle(node.targetSchema, registry)
    appendDescription(out, `IPFS CID or ipfs:// URL${targetTitle ? ` to a ${targetTitle}` : ''}.`)
    return out
  }
  if (node.kind === 'bytes') {
    out.type = 'string'
    appendDescription(out, 'base64-encoded bytes.')
    return out
  }

  // Known string formats.
  if (node.format === 'hm-url') {
    out.type = 'string'
    appendDescription(out, 'hm:// document URL.')
    return out
  }
  if (node.format === 'hm-profile') {
    out.type = 'string'
    appendDescription(out, 'bare hm://<accountUid> account URL.')
    return out
  }

  // Literal unions. Keep an `enum` only when every member is a string or number
  // (the subset's enum type); a boolean/null member forces dropping the enum but
  // we still note the allowed values in the description.
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const members = node.enum
    const allStringOrNumber = members.every(
      (member) => typeof member === 'string' || (typeof member === 'number' && Number.isFinite(member)),
    )
    if (allStringOrNumber) {
      out.enum = members as (string | number)[]
    } else {
      appendDescription(out, `Allowed values: ${members.map((member) => JSON.stringify(member)).join(', ')}.`)
    }
    if (typeof node.type === 'string' && node.type !== 'null' && KNOWN_PLAIN_TYPES.includes(node.type)) {
      out.type = node.type as PlainJsonSchema['type']
    }
    // pattern is not expressible; note it if present.
    if (typeof node.pattern === 'string') appendDescription(out, `Must match pattern ${node.pattern}.`)
    return out
  }

  // type 'null' has no subset equivalent: drop the type, describe it.
  if (node.type === 'null') {
    appendDescription(out, 'must be null.')
    return out
  }

  // Plain types.
  if (typeof node.type === 'string' && KNOWN_PLAIN_TYPES.includes(node.type)) {
    out.type = node.type as PlainJsonSchema['type']
  }

  if (typeof node.pattern === 'string') appendDescription(out, `Must match pattern ${node.pattern}.`)

  if (node.type === 'object') {
    if (isRecord(node.properties)) {
      const properties: Record<string, PlainJsonSchema> = {}
      for (const [key, sub] of Object.entries(node.properties)) {
        if (isRecord(sub)) properties[key] = lowerNode(sub as BlobSchema, root, registry, depth + 1)
      }
      out.properties = properties
    }
    if (Array.isArray(node.required)) {
      const required = node.required.filter((key): key is string => typeof key === 'string')
      if (required.length > 0) out.required = required
    }
    if (typeof node.additionalProperties === 'boolean') out.additionalProperties = node.additionalProperties
  }

  if (node.type === 'array') {
    if (isRecord(node.items)) out.items = lowerNode(node.items as BlobSchema, root, registry, depth + 1)
    // minItems/maxItems aren't in the subset — note minItems if present.
    const minItems = keywordNumber(node.minItems)
    if (minItems !== undefined) appendDescription(out, `At least ${minItems} item${minItems === 1 ? '' : 's'}.`)
  }

  return out
}

/**
 * Lower a Blob Schema to the plain JSON-Schema subset for an LLM-facing tool
 * input schema. External refs are inlined from the registry; lost structure
 * (kinds, formats, unions, patterns) is folded into descriptions. Never throws.
 */
export function compileBlobSchemaForLLM(schema: BlobSchema, registry: SchemaRegistry): PlainJsonSchema {
  try {
    return lowerNode(schema, schema, registry, 0)
  } catch {
    return {}
  }
}

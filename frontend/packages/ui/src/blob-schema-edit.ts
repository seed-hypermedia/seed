import type {BlobSchema} from './blob-schema'
import {isDagJsonLink} from './dag-json'

/**
 * Pure editing helpers for the purpose-built schema form (blob-schema-editor):
 * mapping a schema node to the "field kind" the form's type picker shows, and
 * patch-style mutations that never touch keywords they don't own — unknown or
 * currently-irrelevant keywords ride along untouched (they're inert to the
 * validator and recoverable via the raw editing modes).
 */

/** What the schema form's type picker offers for one node. */
export type SchemaNodeKind =
  | 'object'
  | 'text'
  | 'literals'
  | 'integer'
  | 'number'
  | 'toggle'
  | 'list'
  | 'union'
  | 'link'
  | 'bytes'
  | 'null'
  | 'ref'
  | 'any'

export const SCHEMA_NODE_KIND_LABELS: Record<SchemaNodeKind, string> = {
  object: 'Object',
  text: 'Text',
  literals: 'Literal Union',
  integer: 'Whole number',
  number: 'Number',
  toggle: 'Toggle',
  list: 'List',
  union: 'Union',
  link: 'Link',
  bytes: 'Bytes',
  null: 'Null',
  ref: 'Reference',
  any: 'Any',
}

/** The picker kinds in display order. */
export const SCHEMA_NODE_KINDS: SchemaNodeKind[] = [
  'object',
  'text',
  'literals',
  'integer',
  'number',
  'toggle',
  'list',
  'union',
  'link',
  'bytes',
  'null',
  'ref',
  'any',
]

/**
 * Classify a schema node for the form's type picker. Identity precedence:
 * `$ref` > `kind` > `oneOf` (union) > `enum` (literal union) > `type`. A
 * node with both `type` and `enum` is a literal union — the enum fully
 * constrains the value, so that's the useful editing surface.
 */
export function schemaNodeKind(node: BlobSchema): SchemaNodeKind {
  if (node.$ref !== undefined) return 'ref'
  if (node.kind === 'link') return 'link'
  if (node.kind === 'bytes') return 'bytes'
  if (Array.isArray(node.oneOf)) return 'union'
  if (Array.isArray(node.enum)) return 'literals'
  switch (node.type) {
    case 'object':
      return 'object'
    case 'string':
      return 'text'
    case 'integer':
      return 'integer'
    case 'number':
      return 'number'
    case 'boolean':
      return 'toggle'
    case 'array':
      return 'list'
    case 'null':
      return 'null'
    default:
      return 'any'
  }
}

/**
 * Re-kind a node. Only the identity keywords (`type`, `kind`, `$ref`,
 * `oneOf`, `enum`) change; everything else — title, description, constraints
 * of other kinds, unknown keywords — is preserved (inert keywords are
 * harmless to the validator). Switching away from a literal/union kind drops
 * its members (they ARE that kind's identity); undo restores them.
 */
export function setSchemaNodeKind(node: BlobSchema, kind: SchemaNodeKind): BlobSchema {
  const next: BlobSchema = {...node}
  delete next.type
  delete next.kind
  delete next.$ref
  delete next.oneOf
  delete next.enum
  switch (kind) {
    case 'object':
      next.type = 'object'
      break
    case 'text':
      next.type = 'string'
      break
    case 'literals':
      next.enum = Array.isArray(node.enum) ? node.enum : []
      break
    case 'integer':
      next.type = 'integer'
      break
    case 'number':
      next.type = 'number'
      break
    case 'toggle':
      next.type = 'boolean'
      break
    case 'list':
      next.type = 'array'
      break
    case 'union':
      // A useful union starts with two variants to fill in.
      next.oneOf = Array.isArray(node.oneOf) ? node.oneOf : [{type: 'object'}, {type: 'object'}]
      break
    case 'null':
      next.type = 'null'
      break
    case 'link':
      next.kind = 'link'
      break
    case 'bytes':
      next.kind = 'bytes'
      break
    case 'ref':
      next.$ref = typeof node.$ref === 'string' || isDagJsonLink(node.$ref) ? node.$ref : ''
      break
    case 'any':
      break
  }
  return next
}

/**
 * Parse the schema form's literal input: JSON scalars are detected (`42`,
 * `true`, `null`, `"quoted text"`), anything else is plain text. Objects and
 * arrays are not literals — those come back as text too.
 */
export function parseLiteralInput(text: string): unknown {
  const trimmed = text.trim()
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed === null || ['string', 'number', 'boolean'].includes(typeof parsed)) return parsed
    return text
  } catch {
    return text
  }
}

/** Display label for a literal: quoted strings, plain scalars. */
export function literalLabel(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

/** Whether `key` is in the parent object schema's `required` list. */
export function isRequiredProperty(parent: BlobSchema, key: string): boolean {
  return Array.isArray(parent.required) && parent.required.includes(key)
}

/** Toggle `key`'s membership in `required`, dropping the list when empty. */
export function setRequiredProperty(parent: BlobSchema, key: string, required: boolean): BlobSchema {
  const current = Array.isArray(parent.required) ? parent.required.filter((k) => typeof k === 'string') : []
  const next = required ? (current.includes(key) ? current : [...current, key]) : current.filter((k) => k !== key)
  const result = {...parent}
  if (next.length > 0) result.required = next
  else delete result.required
  return result
}

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)

/** Rename a property, preserving declaration order and required membership. */
export function renameProperty(parent: BlobSchema, oldKey: string, newKey: string): BlobSchema {
  const props = parent.properties ?? {}
  if (!hasOwn(props, oldKey) || hasOwn(props, newKey) || newKey === '/' || !newKey) return parent
  const properties: Record<string, BlobSchema> = {}
  for (const [key, sub] of Object.entries(props)) {
    properties[key === oldKey ? newKey : key] = sub
  }
  let result: BlobSchema = {...parent, properties}
  if (isRequiredProperty(parent, oldKey)) {
    result = setRequiredProperty(setRequiredProperty(result, oldKey, false), newKey, true)
  }
  return result
}

/** Remove a property and its required membership. */
export function removeProperty(parent: BlobSchema, key: string): BlobSchema {
  const properties = {...(parent.properties ?? {})}
  delete properties[key]
  let result: BlobSchema = {...parent}
  if (Object.keys(properties).length > 0) result.properties = properties
  else delete result.properties
  result = setRequiredProperty(result, key, false)
  return result
}

/** Add a property with a starter node. Rejects duplicates, empty, and "/". */
export function addProperty(parent: BlobSchema, key: string, node: BlobSchema): BlobSchema | null {
  if (!key || key === '/' || (parent.properties && hasOwn(parent.properties, key))) return null
  return {...parent, properties: {...(parent.properties ?? {}), [key]: node}}
}

/**
 * Set or clear one keyword on a node: `undefined` deletes the key. The
 * returned object preserves every other keyword verbatim.
 */
export function setSchemaKeyword(node: BlobSchema, keyword: string, value: unknown): BlobSchema {
  const next = {...node}
  if (value === undefined) delete next[keyword]
  else next[keyword] = value
  return next
}

// The parts of an `allOf` schema as the reading view and the editor present it: the named types it
// includes (each field it brings), the inline struct that adds fields of its own, and the merged
// struct a value is checked against.
import {
  type HypermediaSchema,
  kindOf,
  namedSchemaUrl,
  resolveSchema,
  type SchemaRegistry,
  STRUCT_URL,
  type StructField,
  structFields,
} from './engine'

export type IntersectionArm = {
  index: number
  node: HypermediaSchema
  /** The type the arm names (`hm://…`, `ipfs://…`), or null for an inline struct. */
  url: string | null
  /** The fields the arm brings, once resolved; empty while its type is not fetched. */
  fields: StructField[]
  /** Its type could not be found (yet). */
  missing: boolean
}

export type Intersection = {
  arms: IntersectionArm[]
  /** The arms that name a type, in order. */
  named: IntersectionArm[]
  /** The first inline struct arm: where fields added here live. */
  own: IntersectionArm | null
  /** The merged struct, or a marker (`__missing`, `__invalid`) when it cannot be built yet. */
  merged: HypermediaSchema
  /** For each merged field, the named arms that define it (empty: added here). */
  sources: Record<string, IntersectionArm[]>
}

/** An inline struct (or map) arm: it spells out its own fields rather than naming a type. */
export const isInlineStructArm = (node: any): boolean =>
  !!node &&
  typeof node === 'object' &&
  !namedSchemaUrl(node) &&
  !node.anyOf &&
  !node.allOf &&
  ['struct', 'map'].includes(kindOf(node.type))

/** An intersection part the editor added and the user has not picked a type for yet. */
export const isBlankPart = (node: any): boolean => !!node && typeof node === 'object' && node.type === ''

export function intersectionOf(schema: HypermediaSchema, registry: SchemaRegistry = {}): Intersection {
  const nodes: HypermediaSchema[] = Array.isArray(schema.allOf) ? schema.allOf : []
  const arms = nodes.map((node, index): IntersectionArm => {
    const resolved = resolveSchema(node, {}, registry).schema
    return {
      index,
      node,
      url: namedSchemaUrl(node),
      fields: structFields(resolved),
      missing: !!resolved.__missing,
    }
  })
  const named = arms.filter((a) => a.url)
  // A part whose type is not chosen yet (the editor's blank chip) takes no part in the merge.
  const chosen = nodes.filter((n) => !(n && typeof n === 'object' && n.type === ''))
  const own = arms.find((a) => isInlineStructArm(a.node)) ?? null
  const sources: Record<string, IntersectionArm[]> = {}
  for (const arm of named) for (const f of arm.fields) (sources[f.name] ??= []).push(arm)
  return {
    arms,
    named,
    own,
    merged: chosen.length ? resolveSchema({...schema, allOf: chosen}, {}, registry).schema : {},
    sources,
  }
}

/**
 * The intersection with the fields added here replaced. The first inline struct arm holds them; it
 * is appended when there is none yet, and dropped when its last field goes (the named types alone
 * remain), so adding a field to an intersection is all it takes to give it fields of its own.
 */
export function withOwnFields(schema: HypermediaSchema, ownArm: HypermediaSchema): HypermediaSchema {
  const nodes: HypermediaSchema[] = Array.isArray(schema.allOf) ? schema.allOf : []
  const at = nodes.findIndex(isInlineStructArm)
  const empty = !structFields(ownArm).length && ownArm.values === undefined
  const next =
    at === -1
      ? empty
        ? nodes
        : [...nodes, ownArm]
      : empty && nodes.length > 1
        ? nodes.filter((_, i) => i !== at)
        : nodes.map((n, i) => (i === at ? ownArm : n))
  return {...schema, allOf: next}
}

/** The inline struct an editor starts from when an intersection has no fields of its own yet. */
export const emptyOwnArm = (): HypermediaSchema => ({type: STRUCT_URL})

/**
 * A struct-form schema turned into an intersection, keeping what it had: a base it extended
 * becomes the first part, and its own fields the inline part.
 */
export function toIntersection(schema: HypermediaSchema): HypermediaSchema {
  const {type: _t, ref: _r, properties, values, anyOf: _a, items: _i, ...rest} = schema
  const base = namedSchemaUrl(schema)
  const own: HypermediaSchema = {type: STRUCT_URL}
  if (properties && Object.keys(properties).length) own.properties = properties
  if (values !== undefined) own.values = values
  const parts: HypermediaSchema[] = []
  if (base) parts.push({type: base})
  if (own.properties || own.values !== undefined || !base) parts.push(own)
  return {...rest, allOf: parts}
}

/**
 * An intersection turned back into a single struct: its own fields kept, extending `url` when it
 * names a type (any other part is dropped).
 */
export function fromIntersection(schema: HypermediaSchema, url: string): HypermediaSchema {
  const {allOf, ...rest} = schema
  const own = (Array.isArray(allOf) ? allOf : []).find(isInlineStructArm)
  const out: HypermediaSchema = {...rest, type: url}
  if (own?.properties) out.properties = own.properties
  else if (['struct', 'map'].includes(kindOf(url)) || kindOf(url) !== url) out.properties = {}
  if (own?.values !== undefined) out.values = own.values
  return out
}

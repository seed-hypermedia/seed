import {
  BUILTIN_METADATA_KEYS,
  type HMDocumentInfo,
  type HMMetadata,
  type UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'

/** One inferred attribute in a collection item schema. */
export type DocumentSchemaAttribute =
  | {key: string; type: 'text'}
  | {key: string; type: 'number'}
  | {key: string; type: 'toggle'}
  | {key: string; type: 'object'; attributes: DocumentSchemaAttribute[]}

/** The attributes expected on direct items of a collection. */
export type DocumentSchema = {attributes: DocumentSchemaAttribute[]}

/** Inputs used by the temporary collection item schema inference. */
export type InferDocumentSchemaInput = {
  collectionId: UnpackedHypermediaId
  publishedChildren: HMDocumentInfo[]
  draftChildren: Array<{id: UnpackedHypermediaId; metadata: HMMetadata}>
}

type AttributeType = DocumentSchemaAttribute['type']

const TYPE_ORDER: AttributeType[] = ['text', 'number', 'toggle', 'object']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function valueType(value: unknown): AttributeType | null {
  if (typeof value === 'string') return 'text'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'toggle'
  if (isRecord(value)) return 'object'
  return null
}

function inferAttributes(records: Record<string, unknown>[], topLevel: boolean): DocumentSchemaAttribute[] {
  const keys = Array.from(
    new Set(
      records.flatMap((record) => Object.keys(record).filter((key) => !topLevel || !BUILTIN_METADATA_KEYS.has(key))),
    ),
  ).sort()

  return keys.flatMap<DocumentSchemaAttribute>((key): DocumentSchemaAttribute[] => {
    const values = records.map((record) => record[key]).filter((value) => valueType(value) !== null)
    if (!values.length) return []
    const counts = new Map<AttributeType, number>()
    for (const value of values) {
      const type = valueType(value)!
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
    const type = TYPE_ORDER.reduce((best, candidate) =>
      (counts.get(candidate) ?? 0) > (counts.get(best) ?? 0) ? candidate : best,
    )
    if (type !== 'object') return [{key, type}]
    return [{key, type, attributes: inferAttributes(values.filter(isRecord), false)}]
  })
}

function isDirectChild(collectionId: UnpackedHypermediaId, id: UnpackedHypermediaId): boolean {
  const collectionPath = collectionId.path ?? []
  const path = id.path ?? []
  return (
    id.uid === collectionId.uid &&
    path.length === collectionPath.length + 1 &&
    collectionPath.every((part, i) => path[i] === part)
  )
}

/** Infers a temporary schema from published and local-draft direct collection children. */
export function inferDocumentSchema(input: InferDocumentSchemaInput): DocumentSchema {
  const published = input.publishedChildren
    .filter((child) => isDirectChild(input.collectionId, child.id))
    .map((child) => child.metadata as Record<string, unknown>)
  const drafts = input.draftChildren
    .filter((child) => isDirectChild(input.collectionId, child.id))
    .map((child) => child.metadata as Record<string, unknown>)
  return {attributes: inferAttributes([...published, ...drafts], true)}
}

function starterValue(attribute: DocumentSchemaAttribute): unknown {
  if (attribute.type === 'text') return ''
  if (attribute.type === 'number') return 0
  if (attribute.type === 'toggle') return true
  return Object.fromEntries(attribute.attributes.map((child) => [child.key, starterValue(child)]))
}

/** Creates new-document metadata containing empty, type-aware values for a schema. */
export function createSchemaMetadata(schema: DocumentSchema): HMMetadata {
  return Object.fromEntries(schema.attributes.map((attribute) => [attribute.key, starterValue(attribute)]))
}

/** Adds missing schema fields to imported metadata without overwriting present values. */
export function applySchemaToMetadata(metadata: HMMetadata, schema: DocumentSchema): HMMetadata {
  const result: Record<string, unknown> = {...metadata}
  for (const attribute of schema.attributes) {
    if (!(attribute.key in result)) {
      result[attribute.key] = starterValue(attribute)
    } else if (attribute.type === 'object' && isRecord(result[attribute.key])) {
      result[attribute.key] = applySchemaToMetadata(result[attribute.key] as HMMetadata, {
        attributes: attribute.attributes,
      })
    }
  }
  return result as HMMetadata
}

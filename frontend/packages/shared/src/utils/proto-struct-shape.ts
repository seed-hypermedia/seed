/**
 * Repair block attributes that were published in the protobuf-es in-memory
 * Struct shape instead of plain JSON.
 *
 * Between 2026-10-28 (#1285) and this fix, the web editor handed protobuf Block
 * instances to PrepareDocumentChange. The client CBOR-encodes its input by
 * walking own properties, so a Struct travelled as
 * `{fields: {x: {kind: {case: 'stringValue', value: 'y'}}}}` and the daemon
 * stored that verbatim as the block's attributes. Those changes are signed and
 * immutable, so readers unwrap the shape back to the JSON it stood for.
 */

type ProtoValueShape = {kind: {case: string; value?: unknown}}
type ProtoStructShape = {fields: Record<string, ProtoValueShape>}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isProtoValueShape(value: unknown): value is ProtoValueShape {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'kind') return false
  const kind = value.kind
  return isRecord(kind) && typeof kind.case === 'string'
}

/** True for a non-empty `{fields: {...}}` whose every entry is a protobuf Value shape. */
export function isProtoStructShape(value: unknown): value is ProtoStructShape {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'fields') return false
  const fields = value.fields
  if (!isRecord(fields)) return false
  const entries = Object.values(fields)
  return entries.length > 0 && entries.every(isProtoValueShape)
}

function protoValueToJson(value: ProtoValueShape): unknown {
  const {kind} = value
  switch (kind.case) {
    case 'nullValue':
      return null
    case 'numberValue':
    case 'stringValue':
    case 'boolValue':
      return kind.value
    case 'structValue':
      return isRecord(kind.value) && isRecord(kind.value.fields) ? protoFieldsToJson(kind.value.fields) : {}
    case 'listValue': {
      const values = isRecord(kind.value) ? kind.value.values : undefined
      return Array.isArray(values)
        ? values.map((item) => (isProtoValueShape(item) ? protoValueToJson(item) : item))
        : []
    }
    default:
      return null
  }
}

function protoFieldsToJson(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    out[key] = isProtoValueShape(value) ? protoValueToJson(value) : value
  }
  return out
}

/** Returns the JSON a Struct-shaped attributes object stood for; anything else is returned as is. */
export function repairProtoStructShape<T>(attributes: T): T {
  if (!isProtoStructShape(attributes)) return attributes
  return protoFieldsToJson(attributes.fields) as T
}

/** Repairs block and annotation attributes in place throughout a document's block tree. */
export function repairProtoStructAttributes(nodes: unknown): void {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!isRecord(node)) continue
    const block = node.block
    if (isRecord(block)) {
      if (isProtoStructShape(block.attributes)) block.attributes = repairProtoStructShape(block.attributes)
      if (Array.isArray(block.annotations)) {
        for (const annotation of block.annotations) {
          if (isRecord(annotation) && isProtoStructShape(annotation.attributes)) {
            annotation.attributes = repairProtoStructShape(annotation.attributes)
          }
        }
      }
    }
    repairProtoStructAttributes(node.children)
  }
}

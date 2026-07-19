/**
 * The six signed Hypermedia (Onyx) blob types the Seed daemon indexes and
 * signature-verifies. Each corresponds to an `hypermedia-*` schema in
 * /schemas. A blob of one of these types is a DAG-CBOR map whose `type` field
 * equals the name, carrying the BaseBlob envelope fields `signer`, `sig` (and
 * `ts`).
 */
export const HYPERMEDIA_BLOB_TYPES = ['Comment', 'Change', 'Ref', 'Capability', 'Contact', 'Profile'] as const

export type HypermediaBlobType = (typeof HYPERMEDIA_BLOB_TYPES)[number]

const TYPE_SET: ReadonlySet<string> = new Set(HYPERMEDIA_BLOB_TYPES)

/**
 * Recognize a signed Hypermedia blob by its shape. Returns the type name only
 * when `value` is a plain (non-array) object whose `type` is one of the six
 * known names AND it carries the signed-envelope own properties `signer` and
 * `sig`. The envelope check is what distinguishes a genuine signed blob from
 * JSON-Schema-style data like `{type: "object"}`. Pure — safe to unit-test.
 */
export function hypermediaBlobType(value: unknown): HypermediaBlobType | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.type !== 'string' || !TYPE_SET.has(record.type)) return null
  if (!Object.prototype.hasOwnProperty.call(record, 'signer')) return null
  if (!Object.prototype.hasOwnProperty.call(record, 'sig')) return null
  return record.type as HypermediaBlobType
}

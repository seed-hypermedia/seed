// A draft's working schema (the schema a type-defining document is authoring) lives on the draft,
// beside its metadata — never in it. Drafts saved before that carried it as a `schemaDraft`
// metadata key; these helpers lift it out wherever such a draft is loaded, saved or published.
import type {HMMetadata} from '@seed-hypermedia/client/hm-types'

/** The metadata key older drafts kept the working schema under. */
export const LEGACY_SCHEMA_DRAFT_KEY = 'schemaDraft'

/** A draft's working schema: a schema object, or null. */
export type SchemaDraft = Record<string, any> | null

const asSchemaObject = (value: unknown): SchemaDraft =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null

/**
 * Split an older draft's metadata into the metadata proper and the working schema it carried.
 * Metadata without the legacy key comes back as the same object.
 */
export function splitLegacySchemaDraft<M extends HMMetadata | Record<string, unknown> | null | undefined>(
  metadata: M,
): {metadata: M; schemaDraft: SchemaDraft} {
  if (!metadata || !(LEGACY_SCHEMA_DRAFT_KEY in metadata)) return {metadata, schemaDraft: null}
  const {[LEGACY_SCHEMA_DRAFT_KEY]: legacy, ...rest} = metadata as Record<string, unknown>
  return {metadata: rest as M, schemaDraft: asSchemaObject(legacy)}
}

/** The metadata keys that bind a document to an attributes schema and can be authored in place. */
export const BINDING_SCHEMA_KEYS = ['attributesSchema', 'childAttributesSchema'] as const
export type BindingSchemaKey = (typeof BINDING_SCHEMA_KEYS)[number]
/**
 * A draft's working attributes schemas, by binding key: the struct behind this document's own
 * `attributesSchema` and/or its children's `childAttributesSchema`, authored in place. Same
 * lifecycle as `schemaDraft`: beside the metadata, frozen into IPFS objects at publish, each key
 * then pointing at its object.
 */
export type BindingSchemaDrafts = Partial<Record<BindingSchemaKey, Record<string, any>>> | null

/** The working binding schemas a draft carries, dropping anything that is not a schema object. */
export function draftBindingSchemaDrafts(
  draft: {bindingSchemaDrafts?: unknown} | null | undefined,
): BindingSchemaDrafts {
  const raw = draft?.bindingSchemaDrafts
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: NonNullable<BindingSchemaDrafts> = {}
  for (const key of BINDING_SCHEMA_KEYS) {
    const schema = asSchemaObject((raw as Record<string, unknown>)[key])
    if (schema) out[key] = schema
  }
  return Object.keys(out).length ? out : null
}

/** The working schema a draft carries: its own field, else the legacy metadata key. */
export function draftSchemaDraft(draft: {schemaDraft?: unknown; metadata?: unknown} | null | undefined): SchemaDraft {
  if (!draft) return null
  return (
    asSchemaObject(draft.schemaDraft) ??
    splitLegacySchemaDraft(draft.metadata as Record<string, unknown> | undefined).schemaDraft
  )
}

import type {DocumentOperation} from '@seed-hypermedia/client'
import type {HMMetadata} from '@seed-hypermedia/client/hm-types'

/** All HMMetadata keys that can be set via CLI flags or frontmatter. */
const METADATA_KEYS: (keyof HMMetadata)[] = [
  'name',
  'summary',
  'displayAuthor',
  'displayPublishTime',
  'icon',
  'cover',
  'coverPosition',
  'siteUrl',
  'layout',
  'showOutline',
  'showActivity',
  'contentWidth',
  'childrenType',
  'seedExperimentalLogo',
  'seedExperimentalHomeOrder',
  'importCategories',
  'importTags',
]

/**
 * Merge metadata from multiple sources.
 * Priority: defaults < inputMeta (frontmatter/PDF) < CLI flags.
 */
export function mergeMetadata(
  inputMeta: HMMetadata,
  options: Record<string, unknown>,
  defaults?: Partial<HMMetadata>,
): HMMetadata {
  const result: HMMetadata = {}

  for (const key of METADATA_KEYS) {
    const cli = options[key]
    const input = inputMeta[key]
    const def = defaults?.[key]
    const value = cli !== undefined ? cli : input !== undefined ? input : def
    if (value !== undefined) {
      ;(result as any)[key] = value
    }
  }

  // Handle theme (nested object, not a simple flag).
  if (inputMeta.theme) result.theme = inputMeta.theme

  return result
}

/** Preserve an explicitly supplied focal point, otherwise reset it when the cover changes. */
export function mergeUpdateMetadata(
  inputMeta: HMMetadata,
  options: Record<string, unknown>,
  existingMetadata: HMMetadata | undefined,
): HMMetadata {
  const merged = mergeMetadata(inputMeta, options)
  if (
    Object.prototype.hasOwnProperty.call(merged, 'cover') &&
    merged.cover !== existingMetadata?.cover &&
    !Object.prototype.hasOwnProperty.call(merged, 'coverPosition')
  ) {
    merged.coverPosition = null
  }
  return merged
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Convert metadata into a SetAttributes operation. Object removals expand to per-leaf nulls
 * because a parent null does not reliably clear every persisted child attribute.
 */
export function metadataToSetAttributes(metadata: HMMetadata, existingMetadata?: HMMetadata): DocumentOperation | null {
  const attrs: Array<{key: string[]; value: string | number | boolean | null}> = []

  const flatten = (value: unknown, key: string[], existingValue: unknown) => {
    if (value === undefined) return

    if (value === null && isPlainObject(existingValue)) {
      for (const [nestedKey, nestedValue] of Object.entries(existingValue)) {
        flatten(null, [...key, nestedKey], nestedValue)
      }
      return
    }

    if (isPlainObject(value)) {
      const existingObject = isPlainObject(existingValue) ? existingValue : undefined
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        flatten(nestedValue, [...key, nestedKey], existingObject?.[nestedKey])
      }
      return
    }

    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      attrs.push({key, value})
    }
  }

  for (const [key, value] of Object.entries(metadata)) {
    flatten(value, [key], existingMetadata?.[key as keyof HMMetadata])
  }
  if (attrs.length === 0) return null
  return {type: 'SetAttributes', attrs}
}

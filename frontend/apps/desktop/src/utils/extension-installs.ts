/**
 * Pure helpers for editing a site's `metadata.extensions` install map.
 *
 * The map is keyed by mount path (see docs/extensions/design.md §3.2) and is
 * written back through `useUpdateHomeDocument`, whose `getDocAttributeChanges`
 * diffs the full desired metadata against the published metadata. Because of
 * that the helpers here never emit ops themselves: install/update return a new
 * map with the key set, remove returns a map WITHOUT the key, and the diff
 * helper turns the missing key into per-leaf `nullValue` attribute ops — the
 * same mechanism `spaceAgents` removal relies on.
 */

import {
  EXTENSION_INSTALLS_KEY,
  EXTENSION_MOUNT_PATH_RE,
  ExtensionInstallRecordSchema,
  type ExtensionInstallRecord,
} from '@seed-hypermedia/client/extensions'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, packHmId} from '@shm/shared/utils/entity-id-url'

/** The raw map as stored in metadata. Values may be `null` (removed via the metadata editor) or malformed. */
export type RawExtensionInstalls = Record<string, unknown>

export function getRawExtensionInstalls(metadata: unknown): RawExtensionInstalls {
  if (!metadata || typeof metadata !== 'object') return {}
  const raw = (metadata as Record<string, unknown>)[EXTENSION_INSTALLS_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return {...(raw as RawExtensionInstalls)}
}

/** Normalize a mount path typed by the user: trim, strip leading/trailing slashes, lowercase. */
export function normalizeMountPath(input: string): string {
  return input
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase()
}

export function validateMountPath(mountPath: string, existing: RawExtensionInstalls): string | null {
  if (!mountPath) return 'Mount path is required'
  if (!EXTENSION_MOUNT_PATH_RE.test(mountPath)) {
    return 'Use lowercase letters, digits and dashes, separated by slashes (e.g. "board" or "tools/kanban")'
  }
  const current = existing[mountPath]
  if (current !== undefined && current !== null) return `"${mountPath}" is already used by another extension`
  return null
}

/** The versionless `hm://` URL used as the `ext` field of an install record. */
export function extensionIdFromHmId(id: UnpackedHypermediaId): string {
  return packHmId(hmId(id.uid, {path: id.path}))
}

export function buildInstallRecord(input: {
  extensionId: UnpackedHypermediaId
  /** Extension document version to pin, or null/undefined to follow latest. */
  pinnedVersion?: string | null
  title?: string
  nav?: boolean
  settings?: Record<string, unknown>
}): ExtensionInstallRecord {
  const record: ExtensionInstallRecord = {ext: extensionIdFromHmId(input.extensionId)}
  if (input.pinnedVersion) record.version = input.pinnedVersion
  if (input.title?.trim()) record.title = input.title.trim()
  if (input.nav === false) record.nav = false
  if (input.settings && Object.keys(input.settings).length) record.settings = input.settings
  return ExtensionInstallRecordSchema.parse(record)
}

/** Returns a new map with `mountPath` set to `record`. Throws when the mount path is invalid or taken. */
export function installExtension(
  current: RawExtensionInstalls,
  mountPath: string,
  record: ExtensionInstallRecord,
): RawExtensionInstalls {
  const error = validateMountPath(mountPath, current)
  if (error) throw new Error(error)
  return {...current, [mountPath]: record}
}

/**
 * Returns a new map without `mountPath`. The absent key makes
 * `getDocAttributeChanges` emit a null op for every leaf of the published
 * record, which is how the attribute model deletes an object.
 */
export function removeExtension(current: RawExtensionInstalls, mountPath: string): RawExtensionInstalls {
  const next = {...current}
  delete next[mountPath]
  return next
}

/** Returns a new map with the record at `mountPath` re-pinned to `version` (or following latest when null). */
export function updateExtensionVersion(
  current: RawExtensionInstalls,
  mountPath: string,
  version: string | null,
): RawExtensionInstalls {
  const parsed = ExtensionInstallRecordSchema.safeParse(current[mountPath])
  if (!parsed.success) throw new Error(`No extension is installed at "${mountPath}"`)
  const {version: _oldVersion, ...rest} = parsed.data
  const record: ExtensionInstallRecord = version ? {...rest, version} : rest
  return {...current, [mountPath]: record}
}

/** Returns a new map with the record's `nav` flag changed (true is stored as an absent field, the default). */
export function setExtensionNav(current: RawExtensionInstalls, mountPath: string, nav: boolean): RawExtensionInstalls {
  const parsed = ExtensionInstallRecordSchema.safeParse(current[mountPath])
  if (!parsed.success) throw new Error(`No extension is installed at "${mountPath}"`)
  const {nav: _oldNav, ...rest} = parsed.data
  const record: ExtensionInstallRecord = nav ? rest : {...rest, nav: false}
  return {...current, [mountPath]: record}
}

/** Short display form of a version CID: `bafy…3k2a`. */
export function shortVersion(version: string | null | undefined): string {
  if (!version) return 'latest'
  if (version.length <= 14) return version
  return `${version.slice(0, 6)}…${version.slice(-6)}`
}

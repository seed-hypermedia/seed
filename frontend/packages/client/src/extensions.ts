/**
 * Seed Extensions — shared data model.
 *
 * An extension is a hypermedia document. Its manifest lives in the document's
 * metadata under `seedExtension`, and its code is an IPFS file referenced from
 * the manifest. A site installs an extension by adding an install record to its
 * home document metadata under `extensions`, keyed by the path the extension is
 * mounted at. Everything is signed, versioned and content-addressed, so
 * extensions travel over the network exactly like any other document.
 *
 * This module is the single source of truth for those two schemas plus the
 * postMessage protocol spoken between a host app (web / desktop) and the
 * sandboxed iframe an extension runs in. It has no runtime dependencies beyond
 * zod so it can be consumed by the host apps, the CLI and the extension SDK.
 *
 * See docs/extensions/ in the Seed repo for the full specification.
 */

import * as z from 'zod'

// ── Manifest (lives in the extension document's metadata.seedExtension) ──────

export const EXTENSION_MANIFEST_VERSION = 1

/** Metadata key on an extension document that holds its manifest. */
export const EXTENSION_MANIFEST_KEY = 'seedExtension' as const

/** Metadata key on a site's home document that holds its install records. */
export const EXTENSION_INSTALLS_KEY = 'extensions' as const

/**
 * Capabilities an extension may ask for. The host only exposes bridge methods
 * whose permission is listed in the manifest. `read` is implicit.
 */
export const ExtensionPermissionSchema = z.enum([
  /** Sign and publish hypermedia blobs (comments, document changes) and sign arbitrary data as the current user. Every request is confirmed by the user. */
  'sign',
  /** Navigate the host app to hypermedia URLs and open external URLs. */
  'navigate',
  /** Per-extension key/value storage in the viewer's browser. */
  'storage',
])
export type ExtensionPermission = z.infer<typeof ExtensionPermissionSchema>

/** Extension kinds. Only `page` is implemented; the others reserve names for the roadmap. */
export const ExtensionKindSchema = z.enum(['page', 'block', 'attribute', 'theme'])
export type ExtensionKind = z.infer<typeof ExtensionKindSchema>

/** A mount path: one or more URL-safe segments joined by `/`, no leading slash. */
export const EXTENSION_MOUNT_PATH_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/

export const ExtensionManifestSchema = z
  .object({
    manifestVersion: z.literal(EXTENSION_MANIFEST_VERSION),
    kind: ExtensionKindSchema,
    /** Human-readable semver of the extension code. Informational; the document version is the real identity. */
    version: z.string().min(1),
    /**
     * `ipfs://<cid>` of the entry HTML. A single self-contained HTML file: all
     * scripts, styles and assets inlined. It is loaded into a sandboxed iframe
     * via `srcdoc`, so relative URLs do not resolve.
     */
    entry: z.string().regex(/^ipfs:\/\/[a-zA-Z0-9]+$/, 'entry must be an ipfs:// CID'),
    /** Short description shown in install UIs. The document body is the long-form README. */
    description: z.string().optional(),
    /** Permissions requested. Bridge methods outside this list are rejected. */
    permissions: z.array(ExtensionPermissionSchema).default([]),
    /** Suggested mount path when installing (site owners may override). */
    defaultMountPath: z.string().regex(EXTENSION_MOUNT_PATH_RE).optional(),
    /** Source repository or homepage. */
    homepage: z.string().optional(),
    /** Minimum bridge protocol version the extension needs. */
    minProtocol: z.number().int().positive().optional(),
  })
  .strict()
export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>
export type ExtensionManifestInput = z.input<typeof ExtensionManifestSchema>

// ── Install records (live in a site home document's metadata.extensions) ─────

export const ExtensionInstallRecordSchema = z
  .object({
    /** Hypermedia URL of the extension document, e.g. `hm://z6Mk.../kanban`. Must not carry a version — use `version`. */
    ext: z.string().regex(/^hm:\/\/[a-zA-Z0-9]+(\/[^?#\s]*)?$/, 'ext must be an hm:// document URL without version'),
    /**
     * Pinned extension document version (the `version` of the extension document
     * at install time). When set, the host loads exactly that version's manifest
     * and code even if the extension author publishes updates. When omitted the
     * host follows the latest version. Pinning is the default in install UIs.
     */
    version: z.string().optional(),
    /** Title shown in navigation. Falls back to the extension document's name. */
    title: z.string().optional(),
    /** Whether the mount appears in site navigation. Default true. */
    nav: z.boolean().optional(),
    /** Free-form settings the site owner passes to the extension (exposed in its context). */
    settings: z.record(z.unknown()).optional(),
  })
  .strict()
export type ExtensionInstallRecord = z.infer<typeof ExtensionInstallRecordSchema>

/** `{[mountPath]: record}`. Removing a key in the metadata editor leaves `null` behind, hence nullable. */
export const ExtensionInstallsSchema = z.record(ExtensionInstallRecordSchema.nullable())
export type ExtensionInstalls = z.infer<typeof ExtensionInstallsSchema>

/** A resolved mount: the record plus the path it lives at. */
export type ExtensionMount = {
  mountPath: string
  /** Path segments of the mount, e.g. `['board']` */
  mountSegments: string[]
  record: ExtensionInstallRecord
}

/**
 * Parse the `extensions` metadata field of a site home document. Invalid or
 * null entries are dropped so one bad record never hides the others.
 */
export function parseExtensionInstalls(metadata: unknown): ExtensionMount[] {
  if (!metadata || typeof metadata !== 'object') return []
  const raw = (metadata as Record<string, unknown>)[EXTENSION_INSTALLS_KEY]
  if (!raw || typeof raw !== 'object') return []
  const mounts: ExtensionMount[] = []
  for (const [mountPath, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!EXTENSION_MOUNT_PATH_RE.test(mountPath)) continue
    const parsed = ExtensionInstallRecordSchema.safeParse(value)
    if (!parsed.success) continue
    mounts.push({mountPath, mountSegments: mountPath.split('/'), record: parsed.data})
  }
  mounts.sort((a, b) => a.mountPath.localeCompare(b.mountPath))
  return mounts
}

/**
 * Given a site home document's metadata and a document path (segments, as in
 * `UnpackedHypermediaId.path`), find the extension mounted at that path or at
 * one of its ancestors. The remaining segments after the mount are returned as
 * `subPath` so an extension can implement its own routing beneath its mount.
 */
export function resolveExtensionMount(
  metadata: unknown,
  path: string[] | null | undefined,
): (ExtensionMount & {subPath: string[]}) | null {
  const segments = (path || []).filter((s) => s !== '')
  if (segments.length === 0) return null
  const mounts = parseExtensionInstalls(metadata)
  let best: (ExtensionMount & {subPath: string[]}) | null = null
  for (const mount of mounts) {
    const n = mount.mountSegments.length
    if (n > segments.length) continue
    let match = true
    for (let i = 0; i < n; i++) {
      if (mount.mountSegments[i] !== segments[i]) {
        match = false
        break
      }
    }
    if (!match) continue
    if (!best || n > best.mountSegments.length) {
      best = {...mount, subPath: segments.slice(n)}
    }
  }
  return best
}

/** Parse an extension document's metadata into a manifest, or null if it is not an extension. */
export function parseExtensionManifest(metadata: unknown): ExtensionManifest | null {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = (metadata as Record<string, unknown>)[EXTENSION_MANIFEST_KEY]
  if (!raw) return null
  const parsed = ExtensionManifestSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Strict variant that throws with a readable message (used by the CLI at publish time). */
export function validateExtensionManifest(raw: unknown): ExtensionManifest {
  const parsed = ExtensionManifestSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
  throw new Error(`Invalid extension manifest: ${issues}`)
}

export function extensionEntryCid(manifest: ExtensionManifest): string {
  return manifest.entry.slice('ipfs://'.length)
}

// ── Bridge protocol (host app ⇄ extension iframe, over postMessage) ──────────

/** Bumped when the wire format changes incompatibly. */
export const EXTENSION_PROTOCOL_VERSION = 1

/** Every message carries this discriminator so unrelated postMessage traffic is ignored. */
export const EXTENSION_MESSAGE_TAG = 'seed-extension' as const

export type ExtensionTheme = 'light' | 'dark'
export type ExtensionPlatform = 'web' | 'desktop' | 'mobile'

/** The signed-in viewer, as the extension sees them. */
export type ExtensionUser = {
  /** Account principal (`z6Mk...`). */
  accountId: string
  /** Display name if known. */
  name?: string
}

/**
 * Everything an extension knows about where it is running. Sent on connect and
 * re-sent (as a `context` event) whenever any field changes.
 */
export type ExtensionContext = {
  protocol: number
  platform: ExtensionPlatform
  /** `hm://` id of the extension document (without version). */
  extensionId: string
  /** Document version of the extension actually loaded (pinned or latest). */
  extensionVersion: string | null
  manifest: ExtensionManifest
  /** Site the extension is installed on. */
  site: {
    uid: string
    /** Site home document name. */
    name?: string
    /** Public origin of the site when known (web: the current origin). */
    origin?: string
  }
  /** Where the extension is mounted, e.g. `board`. */
  mountPath: string
  /** Segments after the mount, e.g. `['card', 'abc']` for `/board/card/abc`. */
  subPath: string[]
  /** Query string parameters of the current URL. */
  query: Record<string, string>
  /** Settings from the install record. */
  settings: Record<string, unknown>
  user: ExtensionUser | null
  theme: ExtensionTheme
  /** Permissions actually granted (intersection of manifest and host policy). */
  permissions: ExtensionPermission[]
  /** True when the extension code was loaded from a developer override instead of the published entry. */
  dev: boolean
}

/**
 * Read-only query keys an extension may call through `api.query`. These map
 * directly onto the host's universal client `request(key, input)`. Write keys
 * (`PublishBlobs`, `PrepareDocumentChange`) are deliberately excluded — writes
 * go through the confirmed `sign.*` methods.
 */
export const EXTENSION_READ_QUERY_KEYS = [
  'Resource',
  'ResourceMetadata',
  'Account',
  'AccountContacts',
  'SubjectContacts',
  'Comment',
  'Search',
  'Query',
  'QueryBlock',
  'ListComments',
  'ListDiscussions',
  'ListCommentsByReference',
  'ListCommentsByAuthor',
  'ListCommentVersions',
  'GetCommentReplyCount',
  'ListEvents',
  'ListCitations',
  'ListChanges',
  'ListCapabilities',
  'ListDocumentCollaborators',
  'InteractionSummary',
  'GetCID',
] as const
export type ExtensionReadQueryKey = (typeof EXTENSION_READ_QUERY_KEYS)[number]

/** Domain-separation prefix for `sign.data`, so extension signatures can never be mistaken for protocol blobs. */
export const EXTENSION_SIGN_DATA_PREFIX = 'seed-extension-signature:v1\n'

/**
 * Payload actually signed by `sign.data`: the prefix, the extension id, a
 * newline, then the caller's bytes. Verifiers must reconstruct this.
 */
export function buildSignDataPayload(extensionId: string, data: Uint8Array): Uint8Array {
  const head = new TextEncoder().encode(`${EXTENSION_SIGN_DATA_PREFIX}${extensionId}\n`)
  const out = new Uint8Array(head.length + data.length)
  out.set(head, 0)
  out.set(data, head.length)
  return out
}

/** Request/response method table. Params and results are JSON-serialisable. */
export type ExtensionMethods = {
  /** Handshake. The SDK calls this first; the host answers with the context. */
  hello: {params: {protocol: number; sdkVersion?: string}; result: ExtensionContext}
  getContext: {params: Record<string, never>; result: ExtensionContext}

  /** Read-only hypermedia query, see EXTENSION_READ_QUERY_KEYS. */
  'api.query': {params: {key: ExtensionReadQueryKey; input: unknown}; result: unknown}
  /** URL the iframe can use to load a file by CID (works in <img>, <video>, fetch where CORS allows). */
  'file.url': {params: {cid: string}; result: {url: string}}
  /** Read a file by CID through the host (bytes as base64) — for when the iframe cannot fetch directly. */
  'file.read': {params: {cid: string; maxBytes?: number}; result: {base64: string; contentType?: string}}

  /** Sign + publish a comment on a document as the current user. Requires `sign`. */
  'sign.comment': {
    params: {
      /** `hm://` id of the target document. */
      targetId: string
      /** Document version to attach to; defaults to latest known. */
      targetVersion?: string
      /** Markdown body (converted to blocks by the host). */
      markdown?: string
      /** Or explicit blocks (HMBlockNode[]). */
      blocks?: unknown[]
      replyCommentVersion?: string
      rootReplyCommentVersion?: string
    }
    result: {commentId: string}
  }
  /**
   * Sign + publish a document change as the current user. Requires `sign`.
   * Either full-document replace (`metadata` and/or `blocks`) or raw
   * operations — the host renders a human-readable summary for confirmation.
   */
  'sign.document': {
    params: {
      /** `hm://` id of the document (space uid + path). Created if it does not exist. */
      id: string
      /** Metadata keys to set. Values of `null` delete the key. */
      metadata?: Record<string, unknown>
      /** Replace the full body with these blocks (HMBlockNode[]). Omit to leave content untouched. */
      blocks?: unknown[]
      /** Human summary shown in the confirmation dialog. */
      summary?: string
    }
    result: {id: string; version: string}
  }
  /** Sign arbitrary bytes (domain-separated, see buildSignDataPayload). Requires `sign`. */
  'sign.data': {
    params: {
      /** Base64 of the bytes to sign. */
      base64: string
      /** Human summary shown in the confirmation dialog. */
      purpose: string
    }
    result: {
      /** Base64 signature over buildSignDataPayload(extensionId, data). */
      signature: string
      /** Signer principal (`z6Mk...`). May be a delegated device/session key, not the account key. */
      signer: string
      /** Account the signer acts for. */
      accountId: string
    }
  }

  /** Navigate the host to a hypermedia URL or a site-relative path. Requires `navigate`. */
  navigate: {params: {url: string; replace?: boolean}; result: null}
  /** Open an external http(s) URL in a new tab / the system browser. Requires `navigate`. */
  openExternal: {params: {url: string}; result: null}
  /** Update the browser URL beneath the mount without a host navigation (for in-extension routing). */
  'route.set': {params: {subPath: string[]; query?: Record<string, string>; replace?: boolean}; result: null}

  'storage.get': {params: {key: string}; result: {value: string | null}}
  'storage.set': {params: {key: string; value: string}; result: null}
  'storage.remove': {params: {key: string}; result: null}
  'storage.keys': {params: Record<string, never>; result: {keys: string[]}}

  'ui.toast': {params: {message: string; kind?: 'info' | 'success' | 'error'}; result: null}
  'ui.setTitle': {params: {title: string}; result: null}
  /** Ask the host to size the iframe to the given content height (host may clamp). */
  'ui.resize': {params: {height: number}; result: null}
}
export type ExtensionMethodName = keyof ExtensionMethods

/** Permission each method needs; methods absent here are always allowed. */
export const EXTENSION_METHOD_PERMISSIONS: Partial<Record<ExtensionMethodName, ExtensionPermission>> = {
  'sign.comment': 'sign',
  'sign.document': 'sign',
  'sign.data': 'sign',
  navigate: 'navigate',
  openExternal: 'navigate',
  'storage.get': 'storage',
  'storage.set': 'storage',
  'storage.remove': 'storage',
  'storage.keys': 'storage',
}

/** Events the host pushes to the extension. */
export type ExtensionEvents = {
  /** Context changed (user signed in/out, theme, route). Carries the full new context. */
  context: ExtensionContext
}
export type ExtensionEventName = keyof ExtensionEvents

export type ExtensionRequestMessage = {
  [EXTENSION_MESSAGE_TAG]: typeof EXTENSION_PROTOCOL_VERSION
  type: 'request'
  id: number
  method: ExtensionMethodName
  params: unknown
}
export type ExtensionResponseMessage = {
  [EXTENSION_MESSAGE_TAG]: typeof EXTENSION_PROTOCOL_VERSION
  type: 'response'
  id: number
  result?: unknown
  error?: ExtensionErrorPayload
}
export type ExtensionEventMessage = {
  [EXTENSION_MESSAGE_TAG]: typeof EXTENSION_PROTOCOL_VERSION
  type: 'event'
  event: ExtensionEventName
  data: unknown
}
export type ExtensionMessage = ExtensionRequestMessage | ExtensionResponseMessage | ExtensionEventMessage

export type ExtensionErrorCode =
  | 'permission_denied'
  | 'user_rejected'
  | 'not_signed_in'
  | 'unknown_method'
  | 'invalid_params'
  | 'not_supported'
  | 'internal'

export type ExtensionErrorPayload = {code: ExtensionErrorCode; message: string; data?: unknown}

export class ExtensionError extends Error {
  code: ExtensionErrorCode
  data?: unknown
  constructor(code: ExtensionErrorCode, message: string, data?: unknown) {
    super(message)
    this.name = 'ExtensionError'
    this.code = code
    this.data = data
  }
  toPayload(): ExtensionErrorPayload {
    return {code: this.code, message: this.message, data: this.data}
  }
}

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v[EXTENSION_MESSAGE_TAG] !== EXTENSION_PROTOCOL_VERSION) return false
  return v.type === 'request' || v.type === 'response' || v.type === 'event'
}

// ── Developer overrides ──────────────────────────────────────────────────────

/**
 * localStorage key holding `{[extensionId]: devServerUrl}`. When present for a
 * loaded extension, the host points the iframe at that URL (still sandboxed)
 * instead of the published entry, so `vite dev` hot reload works end to end.
 */
export const EXTENSION_DEV_OVERRIDES_STORAGE_KEY = 'seed.extensions.devOverrides'

/** Query parameter that installs a dev override for the extension on the current page (`?extdev=http://localhost:5174`). Use `?extdev=off` to clear. */
export const EXTENSION_DEV_QUERY_PARAM = 'extdev'

export function readExtensionDevOverrides(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): Record<string, string> {
  try {
    const raw = storage?.getItem(EXTENSION_DEV_OVERRIDES_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && /^https?:\/\//.test(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

export function writeExtensionDevOverride(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined,
  extensionId: string,
  devUrl: string | null,
): Record<string, string> {
  const current = readExtensionDevOverrides(storage)
  if (devUrl) current[extensionId] = devUrl
  else delete current[extensionId]
  try {
    if (Object.keys(current).length === 0) storage?.removeItem(EXTENSION_DEV_OVERRIDES_STORAGE_KEY)
    else storage?.setItem(EXTENSION_DEV_OVERRIDES_STORAGE_KEY, JSON.stringify(current))
  } catch {
    // storage unavailable (private mode, SSR) — overrides are a convenience only
  }
  return current
}

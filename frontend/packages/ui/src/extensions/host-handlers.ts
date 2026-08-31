/**
 * Implementation of every bridge method the host answers
 * (docs/extensions/design.md §5). Platform-agnostic: reads and writes go
 * through the universal client, everything else through the host adapter.
 *
 * `createExtensionHandlers` is a plain factory (testable without React);
 * `ExtensionFrame` wires it to the bridge server.
 */

import {
  computeReplaceOps,
  createBlocksMap,
  hmBlockNodeToBlockNode,
  toAPIBlockNode,
} from '@seed-hypermedia/client/block-diff'
import {principalToString} from '@seed-hypermedia/client/blobs'
import {resolveCapability} from '@seed-hypermedia/client/capability'
import {createChange, createChangeOps, type DocumentOperation} from '@seed-hypermedia/client/change'
import type {SeedClient} from '@seed-hypermedia/client/client'
import {commentRecordIdFromBlob, createComment, trimTrailingEmptyBlocks} from '@seed-hypermedia/client/comment'
import {resolveDocumentState, type DocumentState} from '@seed-hypermedia/client/document-state'
import {
  buildSignDataPayload,
  EXTENSION_INSTALLS_KEY,
  EXTENSION_MANIFEST_KEY,
  ExtensionError,
} from '@seed-hypermedia/client/extensions'
import {
  HMBlockNodeSchema,
  hmIdPathToEntityQueryPath,
  packHmId,
  type HMBlockNode,
  type HMDocument,
  type UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown} from '@seed-hypermedia/client/markdown-to-blocks'
import {createVersionRef} from '@seed-hypermedia/client/ref'
import type {UniversalClient} from '@shm/shared/universal-client'
import type {ExtensionHandlers} from './bridge-server'
import type {ExtensionHostAdapter, ExtensionHostUser} from './extension-host-context'
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHexPreview,
  extensionStoragePrefix,
  normalizeHmIdInput,
  normalizeQueryInput,
  randomBlockId,
  toCloneable,
  validateExternalUrl,
  validateNavigateUrl,
} from './host-utils'
import type {ConfirmSignFn, SignConfirmMetadataChange, SignConfirmRequest} from './sign-confirm-dialog'

const DEFAULT_FILE_READ_MAX_BYTES = 10 * 1024 * 1024
/** Hard ceiling for `file.read`: a caller-supplied `maxBytes` can never exceed it. */
export const MAX_FILE_READ_MAX_BYTES = 32 * 1024 * 1024

// ── Session allow list ───────────────────────────────────────────────────────

/**
 * In-memory "allow for this session" grants, keyed per extension + site +
 * account. Never persisted (design §6). Module-level so it survives page
 * navigation within the app but not a reload.
 */
export type SessionAllowStore = {
  has: (key: string) => boolean
  add: (key: string) => void
  clear: () => void
}

export function createSessionAllowStore(): SessionAllowStore {
  const set = new Set<string>()
  return {has: (k) => set.has(k), add: (k) => void set.add(k), clear: () => set.clear()}
}

export const defaultSessionAllowStore = createSessionAllowStore()

/**
 * `codeSource` is the dev override URL when one is active (null/undefined for
 * the published entry): a grant given to the published code must not carry
 * over to override code, and vice versa.
 */
export function sessionAllowKey(
  extensionId: string,
  siteUid: string,
  accountId: string,
  codeSource?: string | null,
): string {
  return `${extensionId}|${siteUid}|${accountId}|${codeSource ?? ''}`
}

/**
 * Metadata keys that change which code a site runs (install records on the
 * home document, the manifest on an extension document). Writes touching them
 * are always confirmed, even when a session grant exists — otherwise a
 * time-bounded grant could be turned into persistent control (security.md §7).
 */
export const ALWAYS_CONFIRM_METADATA_KEYS: ReadonlySet<string> = new Set<string>([
  EXTENSION_INSTALLS_KEY,
  EXTENSION_MANIFEST_KEY,
])

// ── Factory ──────────────────────────────────────────────────────────────────

export type ExtensionHandlerDeps = {
  client: UniversalClient
  adapter: ExtensionHostAdapter
  extension: {
    id: string
    name: string
    version: string | null
    /** Active developer override URL (code source), if any. */
    devUrl?: string | null
  }
  site: {uid: string; name?: string}
  /** Read on every call so sign-in changes are seen without recreating the handlers. */
  getUser: () => ExtensionHostUser | null
  confirmSign: ConfirmSignFn
  sessionAllow?: SessionAllowStore
  /** Platform hook fired after a blob is published (desktop pushes to the site). */
  onPushPublished?: (id: UnpackedHypermediaId) => void
  /** Called after a document was published so the host can refresh caches. */
  onDocumentPublished?: (id: UnpackedHypermediaId) => void
  /** `ui.setTitle`; defaults to `document.title` when available. */
  setTitle?: (title: string) => void
  /** `ui.resize`; pages ignore it. */
  onResize?: (height: number) => void
}

export function createExtensionHandlers(deps: ExtensionHandlerDeps): ExtensionHandlers {
  const sessionAllow = deps.sessionAllow ?? defaultSessionAllowStore

  function requireUser(): ExtensionHostUser {
    const user = deps.getUser()
    if (!user) throw new ExtensionError('not_signed_in', 'Sign in to let this extension sign on your behalf')
    return user
  }

  function getSigner(accountId: string) {
    if (!deps.client.getSigner) {
      throw new ExtensionError('not_supported', 'This host cannot sign')
    }
    return deps.client.getSigner(accountId)
  }

  async function confirm(
    user: ExtensionHostUser,
    detail: SignConfirmRequest['detail'],
    opts?: {ignoreSessionAllow?: boolean},
  ) {
    const key = sessionAllowKey(deps.extension.id, deps.site.uid, user.accountId, deps.extension.devUrl)
    const granted = sessionAllow.has(key)
    if (granted && !opts?.ignoreSessionAllow) return
    const result = await deps.confirmSign({
      extension: deps.extension,
      site: deps.site,
      account: user,
      detail,
      sessionAllowBypassed: granted,
    })
    if (result.allowSession) sessionAllow.add(key)
  }

  function getStorage() {
    const storage = deps.adapter.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
    if (!storage) throw new ExtensionError('not_supported', 'Storage is not available in this host')
    return storage
  }
  const storagePrefix = extensionStoragePrefix(deps.extension.id, deps.site.uid)

  async function fetchLatestDocument(id: UnpackedHypermediaId): Promise<HMDocument | null> {
    const resource = await deps.client.request('Resource', {...id, version: null, latest: true})
    if (resource.type === 'document') return resource.document
    if (resource.type === 'redirect') {
      throw new ExtensionError('not_supported', `${packHmId(id)} redirects to another document`, {
        redirectTarget: packHmId(resource.redirectTarget),
      })
    }
    if (resource.type === 'error') throw new ExtensionError('internal', resource.message)
    if (resource.type === 'comment') throw new ExtensionError('invalid_params', `${packHmId(id)} is a comment`)
    return null
  }

  return {
    // ── Reads ──
    async 'api.query'({key, input}) {
      const normalized = normalizeQueryInput(key, input)
      let result: unknown
      try {
        result = await deps.client.request(key, normalized as never)
      } catch (error) {
        if (isValidationError(error)) {
          throw new ExtensionError('invalid_params', error instanceof Error ? error.message : String(error))
        }
        throw error
      }
      return toCloneable(result)
    },

    async 'file.url'({cid}) {
      return {url: deps.adapter.fileUrl(cid)}
    },

    async 'file.read'({cid, maxBytes}) {
      const limit = Math.min(maxBytes ?? DEFAULT_FILE_READ_MAX_BYTES, MAX_FILE_READ_MAX_BYTES)
      const {bytes, contentType} = await deps.adapter.readFile(cid, limit)
      return {base64: bytesToBase64(bytes), contentType}
    },

    // ── Writes ──
    async 'sign.comment'(params) {
      const user = requireUser()
      const targetId = normalizeHmIdInput(params.targetId, 'targetId')
      const requestedVersion = params.targetVersion || targetId.version || undefined

      const resource = await deps.client.request('Resource', {
        ...targetId,
        version: requestedVersion ?? null,
        latest: !requestedVersion,
      })
      if (resource.type !== 'document') {
        throw new ExtensionError('invalid_params', `targetId does not resolve to a document (${resource.type})`)
      }
      const docVersion = requestedVersion ?? resource.document.version
      if (!docVersion) throw new ExtensionError('internal', 'Target document has no version')

      const content = trimTrailingEmptyBlocks(
        params.blocks !== undefined
          ? parseBlockNodes(ensureBlockIds(params.blocks))
          : markdownToBlockNodes(params.markdown ?? ''),
      )
      if (content.length === 0) throw new ExtensionError('invalid_params', 'Comment body is empty')

      // threadRoot must be the root of the thread, not the immediate parent
      // (same derivation as the daemon's CreateComment and the CLI).
      let rootReplyCommentVersion = params.rootReplyCommentVersion
      if (params.replyCommentVersion && !rootReplyCommentVersion) {
        let parent: {version?: string; threadRootVersion?: string}
        try {
          parent = await deps.client.request('Comment', params.replyCommentVersion)
        } catch (error) {
          throw new ExtensionError(
            'invalid_params',
            `replyCommentVersion does not resolve to a comment: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
        if (!parent) throw new ExtensionError('invalid_params', 'replyCommentVersion does not resolve to a comment')
        rootReplyCommentVersion = parent.threadRootVersion || parent.version || params.replyCommentVersion
      }

      const docId: UnpackedHypermediaId = {...targetId, version: null, latest: null, blockRef: null, blockRange: null}
      await confirm(user, {
        kind: 'comment',
        targetId: packHmId(docId),
        targetName: resource.document.metadata?.name,
        targetPath: hmIdPathToEntityQueryPath(docId.path),
        preview: blockNodesPreviewText(content),
        isReply: !!params.replyCommentVersion,
      })

      const signer = getSigner(user.accountId)
      const payload = await createComment(
        {
          content,
          docId,
          docVersion,
          replyCommentVersion: params.replyCommentVersion,
          rootReplyCommentVersion,
        },
        signer,
      )
      await deps.client.publish(payload)
      const commentBlob = payload.blobs[0]
      if (!commentBlob) throw new ExtensionError('internal', 'Comment payload is empty')
      const commentId = await commentRecordIdFromBlob(commentBlob.data)
      deps.onPushPublished?.(docId)
      return {commentId}
    },

    async 'sign.document'(params) {
      const user = requireUser()
      const target = normalizeHmIdInput(params.id, 'id')
      const docId: UnpackedHypermediaId = {...target, version: null, latest: true, blockRef: null, blockRange: null}
      const existing = await fetchLatestDocument(docId)

      const ops: DocumentOperation[] = []
      const metadataChanges: SignConfirmMetadataChange[] = []
      if (params.metadata) {
        const built = buildMetadataOps(params.metadata, existing?.metadata as Record<string, unknown> | undefined)
        if (built.op) ops.push(built.op)
        metadataChanges.push(...built.summary)
      }

      let blockCount = 0
      if (params.blocks !== undefined) {
        const nodes = parseBlockNodes(ensureBlockIds(params.blocks))
        blockCount = countBlocks(nodes)
        ops.push(...buildReplaceBodyOps(nodes, existing?.content ?? []))
      }
      if (ops.length === 0) {
        // Nothing differs from the published document: no dialog, no publish.
        if (existing) return {id: packHmId(docId), version: existing.version}
        throw new ExtensionError('invalid_params', 'Nothing to change: no metadata and no blocks given')
      }

      const touchesExtensionConfig = metadataChanges.some((c) => ALWAYS_CONFIRM_METADATA_KEYS.has(c.key))
      await confirm(
        user,
        {
          kind: 'document',
          id: packHmId(docId),
          name: existing?.metadata?.name ?? stringOrUndefined(params.metadata?.name),
          exists: !!existing,
          summary: params.summary,
          metadataRequested: params.metadata !== undefined,
          metadataChanges,
          replaceBody: params.blocks !== undefined,
          blockCount,
        },
        {ignoreSessionAllow: touchesExtensionConfig},
      )

      const path = hmIdPathToEntityQueryPath(docId.path)
      let capability: string | undefined
      if (user.accountId !== docId.uid) {
        capability = await resolveCapability(
          deps.client as unknown as SeedClient,
          docId.uid,
          user.accountId,
          path || undefined,
        )
        if (!capability) {
          throw new ExtensionError('permission_denied', `${user.accountId} has no write capability on ${docId.uid}`)
        }
      }

      // Build and sign the Change client-side (like the CLI): native ops keep
      // whole attribute values, which PrepareDocumentChange's scalar-only
      // setAttribute cannot carry.
      const state: DocumentState | null = existing
        ? await resolveDocumentState(deps.client as unknown as SeedClient, packHmId(docId))
        : null
      const signer = getSigner(user.accountId)
      const {unsignedBytes, ts} = state
        ? createChangeOps({ops, genesisCid: state.genesis, deps: state.heads, depth: state.headDepth + 1})
        : createChangeOps({ops})
      const change = await createChange(unsignedBytes, signer)
      const version = change.cid.toString()
      const existingGeneration = existing?.generationInfo?.generation
      const generation = Math.max(Number(ts), existingGeneration != null ? Number(existingGeneration) + 1 : 0)
      const ref = await createVersionRef(
        {
          space: docId.uid,
          path,
          genesis: state ? state.genesis : version,
          version,
          generation,
          capability,
        },
        signer,
      )
      await deps.client.publish({blobs: [{data: new Uint8Array(change.bytes), cid: version}, ...ref.blobs]})

      deps.onDocumentPublished?.(docId)
      deps.onPushPublished?.(docId)
      return {id: packHmId(docId), version}
    },

    async 'sign.data'({base64, purpose}) {
      const user = requireUser()
      const bytes = base64ToBytes(base64)
      await confirm(user, {
        kind: 'data',
        purpose,
        byteLength: bytes.length,
        hexPreview: bytesToHexPreview(bytes),
      })
      const signer = getSigner(user.accountId)
      const signature = await signer.sign(buildSignDataPayload(deps.extension.id, bytes))
      const publicKey = await signer.getPublicKey()
      return {
        signature: bytesToBase64(signature),
        signer: principalToString(publicKey),
        accountId: user.accountId,
      }
    },

    // ── Navigation ──
    async navigate({url, replace}) {
      deps.adapter.navigate(validateNavigateUrl(url), {replace})
      return null
    },
    async openExternal({url}) {
      deps.adapter.openExternal(validateExternalUrl(url))
      return null
    },
    async 'route.set'({subPath, query, replace}) {
      deps.adapter.setRoute(subPath, query, {replace})
      return null
    },

    // ── Storage ──
    async 'storage.get'({key}) {
      return {value: getStorage().getItem(storagePrefix + key)}
    },
    async 'storage.set'({key, value}) {
      try {
        getStorage().setItem(storagePrefix + key, value)
      } catch (error) {
        throw new ExtensionError('internal', error instanceof Error ? error.message : 'Storage write failed')
      }
      return null
    },
    async 'storage.remove'({key}) {
      getStorage().removeItem(storagePrefix + key)
      return null
    },
    async 'storage.keys'() {
      const storage = getStorage()
      const keys: string[] = []
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i)
        if (k && k.startsWith(storagePrefix)) keys.push(k.slice(storagePrefix.length))
      }
      return {keys}
    },

    // ── UI ──
    async 'ui.toast'({message, kind}) {
      deps.adapter.toast(message, kind ?? 'info')
      return null
    },
    async 'ui.setTitle'({title}) {
      if (deps.setTitle) deps.setTitle(title)
      else if (typeof document !== 'undefined') document.title = title
      return null
    },
    async 'ui.resize'({height}) {
      deps.onResize?.(height)
      return null
    },
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'SeedValidationError' || /^Invalid input for /.test(error.message)
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Validate untrusted `blocks` params as HMBlockNode[]. */
export function parseBlockNodes(blocks: unknown[]): HMBlockNode[] {
  const parsed = HMBlockNodeSchema.array().safeParse(blocks)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new ExtensionError('invalid_params', `blocks are not valid HMBlockNode[]: ${issues}`)
  }
  return parsed.data
}

/** Markdown → HMBlockNode[] using the client SDK's parser (frontmatter is ignored). */
export function markdownToBlockNodes(markdown: string): HMBlockNode[] {
  const {tree} = parseMarkdown(markdown)
  return markdownBlockNodesToHMBlockNodes(tree)
}

/** Plain-text preview of a block tree, for the confirmation dialog. */
export function blockNodesPreviewText(nodes: HMBlockNode[], max = 500): string {
  const parts: string[] = []
  const walk = (list: HMBlockNode[]) => {
    for (const node of list) {
      const block = node.block as {text?: string; type?: string; link?: string}
      if (block.text) parts.push(block.text)
      else if (block.link) parts.push(`[${block.type ?? 'link'}] ${block.link}`)
      if (node.children) walk(node.children)
    }
  }
  walk(nodes)
  const text = parts.join('\n')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function countBlocks(nodes: HMBlockNode[]): number {
  let n = 0
  for (const node of nodes) n += 1 + (node.children ? countBlocks(node.children) : 0)
  return n
}

/**
 * Give every block a unique id before schema validation (extensions may omit
 * ids or reuse them). Works on the raw, unvalidated tree: anything that is not
 * a `{block: {...}}` object is passed through for `parseBlockNodes` to reject.
 */
export function ensureBlockIds(nodes: unknown[], seen = new Set<string>()): unknown[] {
  return nodes.map((node) => {
    if (!node || typeof node !== 'object') return node
    const n = node as {block?: unknown; children?: unknown}
    if (!n.block || typeof n.block !== 'object') return node
    const block = n.block as {id?: unknown}
    let id = typeof block.id === 'string' && block.id ? block.id : ''
    if (!id || seen.has(id)) id = randomBlockId()
    seen.add(id)
    return {
      ...n,
      block: {...block, id},
      children: Array.isArray(n.children) ? ensureBlockIds(n.children, seen) : undefined,
    }
  })
}

export type AttributeValue = string | number | boolean | null | unknown[]

/** One entry of a SetAttributes op: a key path and the value stored at it. */
export type Attribute = {key: string[]; value: AttributeValue}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Flatten a value into attribute key paths the way the daemon models metadata
 * (mirrors the CLI's `flattenAttributes`): plain objects become nested key
 * paths, arrays are stored whole (flattening them would come back as an
 * object), numbers — including floats — are stored as-is, `null` deletes,
 * `undefined` is skipped.
 */
export function flattenAttributes(value: unknown, key: string[], attrs: Attribute[] = []): Attribute[] {
  if (value === undefined) return attrs
  if (Array.isArray(value)) {
    attrs.push({key, value})
    return attrs
  }
  if (isPlainObject(value)) {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      flattenAttributes(nestedValue, [...key, nestedKey], attrs)
    }
    return attrs
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    attrs.push({key, value})
  }
  return attrs
}

/**
 * Attributes that turn the published value at `key` into `next` (mirrors the
 * CLI's `diffAttributes`): leaves present in `previous` but absent from `next`
 * are nulled, unchanged leaves are skipped.
 *
 * Recurses only when both sides are plain objects (or an object is being
 * removed). A shape change (object ↔ scalar/array) is written at `key`
 * itself: the daemon drops descendant registers when an ancestor is set and
 * vice versa, so the previous leaves need no explicit nulling.
 */
export function diffAttributes(key: string[], next: unknown, previous: unknown, attrs: Attribute[] = []): Attribute[] {
  const nextObj = isPlainObject(next) ? next : undefined
  const prevObj = isPlainObject(previous) ? previous : undefined
  if ((nextObj && prevObj) || (next === undefined && prevObj)) {
    const keys = new Set([...Object.keys(prevObj ?? {}), ...Object.keys(nextObj ?? {})])
    for (const child of Array.from(keys)) {
      diffAttributes([...key, child], nextObj?.[child], prevObj?.[child], attrs)
    }
    return attrs
  }
  if (next === undefined) {
    if (previous !== undefined && previous !== null) attrs.push({key, value: null})
    return attrs
  }
  if (JSON.stringify(next) === JSON.stringify(previous)) return attrs
  flattenAttributes(next, key, attrs)
  return attrs
}

/**
 * Metadata → one SetAttributes op. Only the top-level keys present in
 * `requested` are touched (merge semantics); each of those keys is set to
 * exactly the requested value — leaves of a previous object value that the
 * new value lacks are deleted, `null` deletes the key.
 */
export function buildMetadataOps(
  requested: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
): {op: DocumentOperation | null; summary: SignConfirmMetadataChange[]} {
  const attrs: Attribute[] = []
  const summary: SignConfirmMetadataChange[] = []
  for (const [key, value] of Object.entries(requested)) {
    if (value === undefined) continue
    const previous = existing?.[key]
    const keyAttrs: Attribute[] = []
    if (value === null) {
      if (isPlainObject(previous)) diffAttributes([key], undefined, previous, keyAttrs)
      else if (previous !== undefined) keyAttrs.push({key: [key], value: null})
    } else {
      diffAttributes([key], value, previous, keyAttrs)
    }
    // Keys whose requested value equals the current value produce no ops and
    // are not listed as changes in the confirmation dialog.
    if (keyAttrs.length === 0) continue
    attrs.push(...keyAttrs)
    summary.push({key, before: previous, after: value})
  }
  if (attrs.length === 0) return {op: null, summary}
  // The client type declares scalar values only; the daemon stores any CBOR value.
  return {op: {type: 'SetAttributes', attrs} as unknown as DocumentOperation, summary}
}

/**
 * Full body replace as native ops: blocks are matched by id against the
 * existing content (unchanged blocks emit nothing), new/changed blocks are
 * replaced and positioned, every existing block absent from `nodes` is
 * deleted (descendants included).
 */
export function buildReplaceBodyOps(nodes: HMBlockNode[], existingContent: HMBlockNode[]): DocumentOperation[] {
  const oldMap = createBlocksMap(existingContent.map(toAPIBlockNode))
  return computeReplaceOps(oldMap, nodes.map(hmBlockNodeToBlockNode))
}

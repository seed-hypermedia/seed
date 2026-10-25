import {z} from 'zod'
import {decode, encode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {ipldToDagJson} from '@seed-hypermedia/client/dag-json'
import {HM_SCHEMAS} from '@seed-hypermedia/client/schema-registry.generated'
import {validate} from '@seed-hypermedia/client/schema-engine'
import {packBaseId, type HMRequest, type HMDocumentFilter, type HMQuery} from '@seed-hypermedia/client/hm-types'

/** A host-derived request. Pages never choose its kind, type, or permission scope. */
export type PagePermissionRequest = {
  kind: 'read' | 'sign' | 'publish'
  type: string
  title: string
  site?: string
  resource?: string
  details: unknown
  warning?: string
}
/** A remembered rule belongs to one viewer and canonical page document, including updates. */
export type PagePermissionGrant = Pick<PagePermissionRequest, 'kind'> & {
  scope: 'resource' | 'site' | 'type-site' | 'type' | 'all'
  type?: string
  site?: string
  resource?: string
}
/** The host UI can decline, allow only this operation, or remember a supported scope. */
export type PagePermissionDecision = 'deny' | 'once' | PagePermissionGrant['scope']

/** Offer scopes only when the host has established the corresponding boundary. */
export function pagePermissionScopes(request: PagePermissionRequest): PagePermissionDecision[] {
  if (request.kind === 'read')
    return [
      'once',
      ...(request.resource ? ['resource' as const] : []),
      ...(request.site ? ['site' as const] : []),
      'all',
    ]
  return [
    'once',
    ...(request.site && request.type !== 'raw' ? ['type-site' as const] : []),
    ...(request.type !== 'raw' ? ['type' as const] : []),
    'all',
  ]
}

/** Human-readable labels shared by the approval panel and saved-permission controls. */
export function pagePermissionLabel(
  scope: PagePermissionDecision,
  request: Pick<PagePermissionRequest, 'kind' | 'type'>,
): string {
  if (scope === 'once') return 'Allow once'
  if (scope === 'deny') return 'Deny'
  if (scope === 'resource') return 'Allow reading this resource'
  if (scope === 'site') return 'Allow reading this site'
  if (scope === 'all')
    return request.kind === 'read'
      ? 'Allow all reading'
      : request.kind === 'sign'
        ? 'Allow any signing'
        : 'Allow all publishing'
  const type =
    request.type === 'Comment'
      ? 'comments'
      : request.type === 'CommentEdit'
        ? 'comment edits and deletions'
        : request.type === 'Capability'
          ? 'permission grants'
          : request.type === 'Change'
            ? 'document changes'
            : request.type === 'Ref'
              ? 'document references, redirects and deletions'
              : request.type === 'Contact'
                ? 'contact changes'
                : request.type === 'Profile'
                  ? 'profile changes'
                  : 'publishing'
  return scope === 'type-site' ? `Allow ${type} on this site` : `Allow all ${type}`
}

/** Stable host-owned persistence key; code updates intentionally inherit the page's rules. */
export function pagePermissionStorageKey(account: string | null, document: string): string {
  return `seed-page-permissions:v1:${JSON.stringify([account, document])}`
}

/** Deserialize persisted rules at the host boundary, ignoring malformed or obsolete records. */
export function readPagePermissionGrants(storage: Pick<Storage, 'getItem'>, key: string): PagePermissionGrant[] {
  try {
    return z
      .array(
        z
          .object({
            kind: z.enum(['read', 'sign', 'publish']),
            scope: z.enum(['resource', 'site', 'type-site', 'type', 'all']),
            type: z.string().optional(),
            site: z.string().optional(),
            resource: z.string().optional(),
          })
          .strict(),
      )
      .max(128)
      .parse(JSON.parse(storage.getItem(key) || '[]'))
  } catch {
    return []
  }
}

/** Serialize approvals without coalescing different operations; revocation cancels queued and active calls. */
export function createDocumentPageAccess(
  approve: (request: PagePermissionRequest, signal: AbortSignal) => Promise<PagePermissionDecision>,
  onChange: (grants: PagePermissionGrant[]) => void = () => {},
  initial: PagePermissionGrant[] = [],
) {
  let grants = initial.map((grant) => ({...grant}))
  let controller = new AbortController()
  let queue: Promise<unknown> = Promise.resolve()
  const publications = new Set<string>()
  const matches = (request: PagePermissionRequest) =>
    grants.some(
      (grant) =>
        grant.kind === request.kind &&
        (grant.scope === 'all' ||
          (grant.scope === 'resource' && !!request.resource && grant.resource === request.resource) ||
          (grant.scope === 'site' && !!request.site && grant.site === request.site) ||
          (grant.scope === 'type' && grant.type === request.type) ||
          (grant.scope === 'type-site' &&
            !!request.site &&
            grant.site === request.site &&
            grant.type === request.type)),
    )
  return {
    signal(signal: AbortSignal) {
      return AbortSignal.any([signal, controller.signal])
    },
    snapshot() {
      return grants.map((grant) => ({...grant}))
    },
    async authorize(request: PagePermissionRequest, signal: AbortSignal) {
      const authorized = AbortSignal.any([signal, controller.signal])
      authorized.throwIfAborted()
      const operation = queue.then(async () => {
        authorized.throwIfAborted()
        if (matches(request)) return
        const decision = await approve(structuredClone(request), authorized)
        authorized.throwIfAborted()
        if (decision === 'deny') throw new Error('Page permission denied.')
        if (!pagePermissionScopes(request).includes(decision)) throw new Error('Invalid page permission scope.')
        if (decision !== 'once') {
          grants.push({
            kind: request.kind,
            scope: decision,
            ...(decision === 'type' || decision === 'type-site' ? {type: request.type} : {}),
            ...(decision === 'site' || decision === 'type-site' ? {site: request.site} : {}),
            ...(decision === 'resource' ? {resource: request.resource} : {}),
          })
          onChange(this.snapshot())
        }
      })
      queue = operation.catch(() => {})
      await operation
      authorized.throwIfAborted()
      return authorized
    },
    async allowPublication(data: Uint8Array, signal: AbortSignal) {
      const digest = await pageBytesDigest(data)
      signal.throwIfAborted()
      publications.add(digest)
    },
    async canPublish(data: Uint8Array) {
      return publications.has(await pageBytesDigest(data))
    },
    revoke(kind?: PagePermissionRequest['kind']) {
      grants = kind ? grants.filter((grant) => grant.kind !== kind) : []
      publications.clear()
      controller.abort(new Error('Page permissions revoked.'))
      controller = new AbortController()
      onChange(this.snapshot())
    },
    remove(index: number) {
      grants = grants.filter((_, position) => position !== index)
      controller.abort(new Error('Page permissions revoked.'))
      controller = new AbortController()
      publications.clear()
      onChange(this.snapshot())
    },
    replace(saved: PagePermissionGrant[]) {
      controller.abort(new Error('Page permissions changed.'))
      controller = new AbortController()
      grants = saved.map((grant) => ({...grant}))
      publications.clear()
    },
    start() {
      if (controller.signal.aborted) controller = new AbortController()
    },
    close() {
      controller.abort(new Error('Page closed.'))
      publications.clear()
    },
  }
}

/** Fingerprint exact payload bytes, also used for recognizable signing previews. */
export async function pageBytesDigest(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(data))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Decode and validate the actual canonical signing payload, never the caller's claimed operation. */
export function pageSignatureRequest(data: Uint8Array, principal: Uint8Array): PagePermissionRequest {
  try {
    const body = decode(data) as Record<string, unknown>
    const canonical = encode(body)
    if (canonical.length !== data.length || !canonical.every((byte, index) => byte === data[index]))
      throw new Error('Noncanonical payload')
    if (
      !(body.signer instanceof Uint8Array) ||
      body.signer.length !== principal.length ||
      !body.signer.every((byte, index) => byte === principal[index])
    )
      throw new Error('Different signer')
    if (!(body.sig instanceof Uint8Array) || body.sig.length !== 64 || body.sig.some((byte) => byte !== 0))
      throw new Error('Invalid signing envelope')
    const type = typeof body.type === 'string' ? body.type : ''
    if (!['Comment', 'Change', 'Ref', 'Capability', 'Contact', 'Profile'].includes(type))
      throw new Error('Unknown signed type')
    const schema = HM_SCHEMAS[type.toLowerCase()]
    const details = ipldToDagJson(body)
    if (!schema || validate(schema, details, '$', {}, HM_SCHEMAS).length) throw new Error('Invalid signed type')
    // Comment edits/deletions address an existing record; its original target cannot be established from these bytes.
    const category = type === 'Comment' && body.id ? 'CommentEdit' : type
    const site =
      (type === 'Comment' && !body.id) || type === 'Ref' || type === 'Capability'
        ? base58btc.encode(body.space instanceof Uint8Array ? body.space : principal)
        : undefined
    const resource =
      site && typeof body.path === 'string' ? packBaseId(site, body.path.split('/').filter(Boolean)) : undefined
    const title =
      category === 'Comment'
        ? `Post a ${body.visibility === 'Private' ? 'private' : 'public'} comment`
        : category === 'CommentEdit'
          ? 'Edit or delete a comment'
          : type === 'Capability'
            ? 'Grant account permissions'
            : type === 'Change'
              ? 'Sign a document change'
              : type === 'Ref'
                ? 'Update a document reference'
                : type === 'Contact'
                  ? 'Change a contact'
                  : 'Change a profile'
    return {
      kind: 'sign',
      type: category,
      site,
      resource,
      title,
      details,
      ...(type === 'Capability'
        ? {
            warning:
              'This can give another identity lasting access. Revoking this page does not revoke the permission it creates.',
          }
        : {}),
    }
  } catch {
    return {
      kind: 'sign',
      type: 'raw',
      title: 'Sign unrecognized data',
      details: {bytes: data.byteLength},
      warning: 'Seed cannot explain what this signature authorizes. It may be used outside this page.',
    }
  }
}

/** Derive a space only when the query predicate guarantees every result belongs to it. */
function querySpace(filter?: HMDocumentFilter): string | undefined {
  if (!filter || Object.keys(filter).length !== 1) return undefined
  if (filter.spaceMatch) return filter.spaceMatch.space || undefined
  if (filter.and) return filter.and.filters.map(querySpace).find(Boolean)
  if (filter.or) {
    const spaces = filter.or.filters.map(querySpace)
    return spaces.length && spaces[0] && spaces.every((space) => space === spaces[0]) ? spaces[0] : undefined
  }
  return undefined
}

/** Site scopes are available only for APIs whose read boundary is explicit and enforceable. */
export function pageReadRequest(key: HMRequest['key'], input: unknown): PagePermissionRequest {
  const object = input as Record<string, unknown> | null
  if (key === 'Resource' || key === 'ResourceMetadata') {
    const id = input as {uid: string; path?: string[]}
    return {
      kind: 'read',
      type: key,
      title: 'Read a document',
      site: id.uid,
      resource: packBaseId(id.uid, id.path || []),
      details: input,
    }
  }
  if (key === 'Account')
    return {
      kind: 'read',
      type: key,
      title: 'Read an account profile',
      site: input as string,
      resource: `hm://${input}/:profile`,
      details: input,
    }
  if (key === 'Query' || key === 'QueryDocuments') {
    const includes = key === 'Query' ? (input as HMQuery).includes : []
    const site =
      key === 'QueryDocuments'
        ? querySpace((input as {filter?: HMDocumentFilter}).filter)
        : includes.length && includes[0]?.space && includes.every((include) => include.space === includes[0]!.space)
          ? includes[0].space
          : undefined
    return {kind: 'read', type: key, title: 'Read documents', site, details: input}
  }
  // Search, citations and comments can reveal data beyond their starting site.
  return {
    kind: 'read',
    type: key,
    title:
      key === 'PrepareDocumentChange'
        ? 'Prepare a document edit'
        : `Read ${key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}`,
    details: object ?? input,
  }
}

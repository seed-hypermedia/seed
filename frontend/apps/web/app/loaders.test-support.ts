/**
 * Test support for the web loader: an in-memory stand-in for the daemon plus document fixtures.
 *
 * The loader reaches the daemon three ways — the gRPC resource fetcher/resolver, the universal
 * client's `Resource` request, and `documents.getDocument` — and a route-kind test needs all three
 * to agree on one small world. `FakeDaemon` is that world. It holds resources by address, serves
 * pinned versions, follows redirects the way the real resolver does, and lets a test make the
 * surfaces disagree on purpose when that is the point of the test.
 *
 * This module has no `vi.mock` calls: mocks are hoisted per test file, so each test file wires
 * the modules to its own FakeDaemon (see loaders.routes.test.ts).
 */
import type {HMComment, HMDocument, HMResource, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {HMNotFoundError} from '@shm/shared/models/entity'
import {MAX_REDIRECT_HOPS} from '@shm/shared/redirects'

export const SITE_UID = 'z6MkhzAVoSfE62UVefmbwjvriGk8J2NMXPMwBukkZ3SU288d'
export const OTHER_UID = 'z6MkjtdhPwB2jbdp6V8mn8oobZycbqqEuP6nXouN12EZN4Wa'
export const AUTHOR_UID = 'z6MknjjfAYZdrU3Ksw2imMhq5JLSE8Cuc7Cev9fcr4oxJaGC'

export function makeDocument(input: {
  uid: string
  path: string[]
  version: string
  name?: string
  text?: string
}): HMDocument {
  const entityPath = input.path.length ? `/${input.path.join('/')}` : ''
  return {
    account: input.uid,
    path: entityPath,
    version: input.version,
    authors: [AUTHOR_UID],
    metadata: {name: input.name ?? `Document ${input.path.join('/') || 'home'}`},
    content: input.text
      ? [
          {
            block: {id: 'b1', type: 'Paragraph', text: input.text, annotations: [], attributes: {}},
            children: [],
          },
        ]
      : [],
    createTime: '2026-09-01T00:00:00Z',
    updateTime: '2026-09-01T00:00:00Z',
    genesis: `genesis-${input.path.join('-') || 'home'}`,
    generationInfo: {genesis: `genesis-${input.path.join('-') || 'home'}`, generation: 1n},
    visibility: 'PUBLIC',
  } as unknown as HMDocument
}

export function makeComment(input: {
  id: string
  version: string
  author: string
  target: UnpackedHypermediaId
  text?: string
}): HMComment {
  return {
    id: input.id,
    version: input.version,
    author: input.author,
    targetAccount: input.target.uid,
    targetPath: input.target.path?.length ? `/${input.target.path.join('/')}` : '',
    targetVersion: input.target.version ?? '',
    content: [
      {
        block: {id: 'c1', type: 'Paragraph', text: input.text ?? 'A comment', annotations: [], attributes: {}},
        children: [],
      },
    ],
    createTime: '2026-09-01T00:00:00Z',
    updateTime: '2026-09-01T00:00:00Z',
    visibility: 'PUBLIC',
  } as unknown as HMComment
}

function addressKey(uid: string, path: string[] | null | undefined) {
  return `hm://${uid}${path?.length ? `/${path.join('/')}` : ''}`
}

type Entry = {latest: HMResource; versions: Map<string, HMResource>}

/** In-memory daemon: resources by address, optionally pinned by version. */
export class FakeDaemon {
  private entries = new Map<string, Entry>()

  /** Serve `resource` at `id`'s address. A document is also served under its own version. */
  put(id: UnpackedHypermediaId, resource: HMResource): this {
    const key = addressKey(id.uid, id.path)
    const entry = this.entries.get(key) ?? {latest: resource, versions: new Map()}
    entry.latest = resource
    if (resource.type === 'document') entry.versions.set(resource.document.version, resource)
    this.entries.set(key, entry)
    return this
  }

  /** Serve `document` at its own address (latest and by version). */
  putDocument(document: HMDocument): this {
    const path = document.path ? document.path.split('/').filter(Boolean) : []
    const id = hmId(document.account, {path, latest: true})
    return this.put(id, {type: 'document', id, document})
  }

  /** Serve a redirect at `from`, pointing at `to`. */
  putRedirect(from: UnpackedHypermediaId, to: UnpackedHypermediaId, {republish = false} = {}): this {
    return this.put(from, {type: 'redirect', id: from, redirectTarget: to, republish})
  }

  /** What `GetResource` answers for `id`: the pinned version if asked and known, else latest. */
  fetch(id: UnpackedHypermediaId): HMResource {
    const entry = this.entries.get(addressKey(id.uid, id.path))
    if (!entry) return {type: 'not-found', id}
    if (id.version && !id.latest) {
      const pinned = entry.versions.get(id.version)
      if (!pinned) return {type: 'not-found', id}
      return {...pinned, id}
    }
    return {...entry.latest, id}
  }

  /** The shared resolver's contract: follow redirects, throw on not-found, bounded hops. */
  async resolve(id: UnpackedHypermediaId): Promise<HMResource> {
    let current = id
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const resource = this.fetch(current)
      if (resource.type === 'redirect') {
        current = resource.redirectTarget
        continue
      }
      if (resource.type === 'not-found') throw new HMNotFoundError()
      if (resource.type === 'error') throw new Error(resource.message)
      return resource
    }
    throw new Error(`Too many redirects while resolving ${addressKey(id.uid, id.path)}`)
  }

  /** The universal client surface the loader prefetches through. */
  async request(name: string, input: unknown): Promise<unknown> {
    if (name === 'Resource') return this.fetch(input as UnpackedHypermediaId)
    return null
  }

  /** `documents.getDocument` as the loader's getDocument calls it. */
  async getDocument(req: {account: string; path: string; version?: string}): Promise<HMDocument> {
    const path = req.path.split('/').filter(Boolean)
    const id = hmId(req.account, {path, version: req.version || null, latest: !req.version})
    const resource = await this.resolve(id)
    if (resource.type !== 'document') throw new HMNotFoundError()
    return resource.document
  }
}

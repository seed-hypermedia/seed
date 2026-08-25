/**
 * Resolves document state (genesis, heads, depth) from the ListChanges API.
 *
 * Depth is needed to construct valid Change blobs but is not directly
 * exposed by the read API. We compute it by walking the change DAG:
 * genesis has depth 0, each subsequent change has depth = max(dep depths) + 1.
 */

import type {SeedClient} from './client'
import type {HMDocument, HMListChangesOutput, HMResource, UnpackedHypermediaId} from './hm-types'
import {packHmId, unpackHmId} from './hm-types'

/** The resolved state of a document's change DAG. */
export type DocumentState = {
  /** CID of the genesis change blob. */
  genesis: string
  /** CIDs of the current head changes (not depended on by any other change). */
  heads: string[]
  /** Maximum depth among head changes. */
  headDepth: number
  /** Dot-separated head CIDs (version string). */
  version: string
}

/**
 * Resolves the current document state including head depth.
 */
export async function resolveDocumentState(client: SeedClient, targetId: string): Promise<DocumentState> {
  const unpacked = unpackHmId(targetId)
  if (!unpacked) throw new Error(`Invalid ID: ${targetId}`)
  const changesResp = await client.request('ListChanges', {targetId: unpacked})

  if (!changesResp.changes || changesResp.changes.length === 0) {
    throw new Error(`No changes found for ${targetId}. Document may not exist.`)
  }

  const depthMap = computeDepths(changesResp)

  // Genesis is the change with no deps.
  let genesis = ''
  for (const change of changesResp.changes) {
    if (!change.deps || change.deps.length === 0) {
      genesis = change.id!
      break
    }
  }

  if (!genesis) {
    throw new Error('Could not find genesis change (change with no deps).')
  }

  // Heads are changes that are not depended upon by any other change.
  const allDeps = new Set<string>()
  for (const change of changesResp.changes) {
    if (change.deps) {
      for (const dep of change.deps) {
        allDeps.add(dep)
      }
    }
  }

  const heads: string[] = []
  for (const change of changesResp.changes) {
    if (change.id && !allDeps.has(change.id)) {
      heads.push(change.id)
    }
  }

  if (heads.length === 0) {
    throw new Error('Could not determine document heads.')
  }

  // Depth for the new change = max(head depths) + 1.
  let maxHeadDepth = 0
  for (const head of heads) {
    const d = depthMap.get(head) ?? 0
    if (d > maxHeadDepth) maxHeadDepth = d
  }

  // Version string: dot-separated head CIDs.
  const version = heads.join('.')

  return {
    genesis,
    heads,
    headDepth: maxHeadDepth,
    version,
  }
}

/** Maximum redirect hops {@link resolveEditableDocument} follows before giving up. */
const MAX_REDIRECT_HOPS = 5

/** A document address resolved through redirects to the document it currently presents. */
export type FollowedDocument = {
  /** The address that was resolved — where a new Ref should be published to affect this path. */
  id: UnpackedHypermediaId
  /** Where the document actually lives after following redirects (same as `id` for a plain document). */
  targetId: UnpackedHypermediaId
  /** The current document at the target — the content baseline for edits, forks, and moves. */
  document: HMDocument
  /**
   * Non-null when `id` currently holds a redirect Ref. Publishing a Version Ref at `id` with the
   * target's genesis and a fresh (current-timestamp) generation replaces the redirect: the path
   * becomes a live document continuing the target's change history, and stops following the target.
   */
  redirect: {republish: boolean; target: UnpackedHypermediaId} | null
}

/** The full baseline needed to build a new Change at an address: {@link FollowedDocument} plus DAG state. */
export type EditableDocumentBase = FollowedDocument & {
  /** Change-DAG state of the target (genesis/heads/depth) for building the next Change. */
  state: DocumentState
}

/** One redirect Ref that was followed while resolving an address. */
export type RedirectHop = {
  /** The address holding the redirect Ref. */
  from: UnpackedHypermediaId
  /** Where it points. */
  to: UnpackedHypermediaId
  /**
   * `true` for a "republish" redirect (the path re-publishes the target's latest content as its
   * own), `false` for a move redirect (the path has moved away).
   */
  republish: boolean
}

/** A resource read through any redirect Refs on the way, plus the trail of redirects followed. */
export type FollowedResource = {
  /** The address that was asked for. */
  id: UnpackedHypermediaId
  /** The address the resource was actually read from (equals `id` when nothing was followed). */
  targetId: UnpackedHypermediaId
  /** The resource at `targetId` — never a redirect. */
  resource: Exclude<HMResource, {type: 'redirect'}>
  /** Every redirect followed, in order. Empty when `id` holds no redirect. */
  redirects: RedirectHop[]
}

/**
 * Reads the resource at an address, following redirect Refs (bounded, cycle-safe) and reporting
 * every hop that was taken.
 *
 * Readers that follow redirects must never present the result as if it lived at the requested
 * address: the content belongs to `targetId`, and a write to `id` behaves differently from a write
 * to `targetId` (see {@link describeRedirect}). Callers surface `redirects` to the user or agent.
 */
export async function followRedirects(client: SeedClient, id: UnpackedHypermediaId): Promise<FollowedResource> {
  const seen = new Set<string>([packHmId(id)])
  const redirects: RedirectHop[] = []
  let current = id
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const resource = await client.request('Resource', current)
    if (resource.type !== 'redirect') {
      return {id, targetId: current, resource, redirects}
    }
    redirects.push({from: current, to: resource.redirectTarget, republish: resource.republish === true})
    const next = packHmId(resource.redirectTarget)
    if (seen.has(next)) throw new Error(`Redirect cycle detected at ${next}`)
    seen.add(next)
    current = resource.redirectTarget
  }
  throw new Error(`Too many redirects while resolving ${packHmId(id)} (limit ${MAX_REDIRECT_HOPS})`)
}

/**
 * One plain sentence explaining a followed redirect and what a write to either address does —
 * shared by the CLI and the agents read tool so every surface tells the same story.
 */
export function describeRedirect(followed: Pick<FollowedResource, 'id' | 'targetId' | 'redirects'>): string | null {
  const first = followed.redirects[0]
  if (!first) return null
  const from = packHmId(followed.id)
  const to = packHmId(followed.targetId)
  const via = followed.redirects.length > 1 ? ` (via ${followed.redirects.length} redirects)` : ''
  if (first.republish) {
    return (
      `${from} republishes ${to}${via}: the content shown is the latest version of ${to}. ` +
      `To edit the shared original, write to ${to}. ` +
      `Writing to ${from} replaces the republish with an independent copy that no longer follows ${to}.`
    )
  }
  return (
    `${from} has moved to ${to}${via}: the content shown is the latest version of ${to}. ` +
    `Write to ${to}. Writing to ${from} would revive it as an independent copy that no longer follows ${to}.`
  )
}

/**
 * Resolves an address to the document it currently presents, following redirect Refs.
 *
 * A path that holds a redirect Ref (including a "republish" redirect, which re-publishes the
 * target's latest content at this path) has no document of its own: the `Resource` API reports
 * `type: 'redirect'`. Operations on such a path (edit, fork, move, delete) act on the redirect
 * target's document, so this follows the chain (bounded, cycle-safe) to that document.
 */
export async function followToDocument(client: SeedClient, id: UnpackedHypermediaId): Promise<FollowedDocument> {
  const followed = await followRedirects(client, id)
  const first = followed.redirects[0]
  if (followed.resource.type !== 'document') {
    throw new Error(
      `Cannot edit ${packHmId(followed.targetId)}: resource is ${followed.resource.type}` +
        (first ? ` (followed redirect from ${packHmId(id)})` : ''),
    )
  }
  return {
    id,
    targetId: followed.targetId,
    document: followed.resource.document,
    redirect: first ? {republish: first.republish, target: first.to} : null,
  }
}

/**
 * Resolves an address to the state needed to edit the document there, following redirects.
 *
 * Edits at a redirected address must build the Change on the redirect target's DAG (the source
 * path has no changes of its own — `ListChanges` returns nothing for it) and publish a Version
 * Ref at the source path with a fresh generation, which supersedes the redirect Ref.
 */
export async function resolveEditableDocument(
  client: SeedClient,
  id: UnpackedHypermediaId,
): Promise<EditableDocumentBase> {
  const followed = await followToDocument(client, id)
  const state = await resolveDocumentState(client, packHmId(followed.targetId))
  return {...followed, state}
}

/**
 * Computes depth for every change in the DAG via BFS from genesis.
 */
function computeDepths(changesResp: HMListChangesOutput): Map<string, number> {
  const depthMap = new Map<string, number>()
  const depsMap = new Map<string, string[]>()
  const dependents = new Map<string, string[]>()

  for (const change of changesResp.changes) {
    const id = change.id!
    const deps = change.deps ?? []
    depsMap.set(id, deps)

    for (const dep of deps) {
      const existing = dependents.get(dep) ?? []
      existing.push(id)
      dependents.set(dep, existing)
    }
  }

  // Start from nodes with no deps (genesis).
  const queue: string[] = []
  for (const change of changesResp.changes) {
    const deps = change.deps ?? []
    if (deps.length === 0) {
      depthMap.set(change.id!, 0)
      queue.push(change.id!)
    }
  }

  // BFS propagation.
  while (queue.length > 0) {
    const current = queue.shift()!
    const children = dependents.get(current) ?? []
    for (const child of children) {
      const childDeps = depsMap.get(child) ?? []

      // Check if all deps of this child have been resolved.
      let allResolved = true
      let maxDepDepth = 0
      for (const dep of childDeps) {
        const d = depthMap.get(dep)
        if (d === undefined) {
          allResolved = false
          break
        }
        if (d > maxDepDepth) maxDepDepth = d
      }

      if (allResolved && !depthMap.has(child)) {
        depthMap.set(child, maxDepDepth + 1)
        queue.push(child)
      }
    }
  }

  return depthMap
}

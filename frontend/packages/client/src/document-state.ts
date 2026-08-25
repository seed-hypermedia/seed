/**
 * Resolves document state (genesis, heads, depth) from the ListChanges API.
 *
 * Depth is needed to construct valid Change blobs but is not directly
 * exposed by the read API. We compute it by walking the change DAG:
 * genesis has depth 0, each subsequent change has depth = max(dep depths) + 1.
 */

import type {SeedClient} from './client'
import type {HMDocument, HMListChangesOutput, UnpackedHypermediaId} from './hm-types'
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

/** The baseline needed to edit (or take over) a document address. */
export type EditableDocumentBase = {
  /** The address being edited — where a new Ref should be published. */
  id: UnpackedHypermediaId
  /** Where the content baseline lives after following redirects (same as `id` for a plain document). */
  targetId: UnpackedHypermediaId
  /** The current document at the target — the content baseline for edits. */
  document: HMDocument
  /** Change-DAG state of the target (genesis/heads/depth) for building the next Change. */
  state: DocumentState
  /**
   * Non-null when `id` currently holds a redirect Ref. Publishing a Version Ref at `id` with the
   * target's genesis and a fresh (current-timestamp) generation replaces the redirect: the path
   * becomes a live document continuing the target's change history, and stops following the target.
   */
  redirect: {republish: boolean; target: UnpackedHypermediaId} | null
}

/**
 * Resolves an address to the state needed to edit the document there, following redirects.
 *
 * A path that holds a redirect Ref (including a "republish" redirect, which re-publishes the
 * target's latest content at this path) has no change DAG of its own — `ListChanges` returns
 * nothing for it. The editable content lives at the redirect target, so edits at the source
 * address must build a Change on the target's DAG and publish a Version Ref at the source path
 * with a fresh generation, which supersedes the redirect Ref.
 */
export async function resolveEditableDocument(
  client: SeedClient,
  id: UnpackedHypermediaId,
): Promise<EditableDocumentBase> {
  const seen = new Set<string>([packHmId(id)])
  let current = id
  let firstRedirect: EditableDocumentBase['redirect'] = null
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const resource = await client.request('Resource', current)
    if (resource.type === 'document') {
      const state = await resolveDocumentState(client, packHmId(current))
      return {id, targetId: current, document: resource.document, state, redirect: firstRedirect}
    }
    if (resource.type === 'redirect') {
      firstRedirect ??= {republish: resource.republish === true, target: resource.redirectTarget}
      const next = packHmId(resource.redirectTarget)
      if (seen.has(next)) throw new Error(`Redirect cycle detected at ${next}`)
      seen.add(next)
      current = resource.redirectTarget
      continue
    }
    throw new Error(
      `Cannot edit ${packHmId(current)}: resource is ${resource.type}` +
        (firstRedirect ? ` (followed redirect from ${packHmId(id)})` : ''),
    )
  }
  throw new Error(`Too many redirects while resolving ${packHmId(id)} (limit ${MAX_REDIRECT_HOPS})`)
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

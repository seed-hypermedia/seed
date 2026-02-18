/**
 * Computes change DAG depth from the ListChanges API.
 *
 * Depth is needed to construct valid Change blobs but is not directly
 * exposed by the read API. We compute it by walking the change DAG:
 * genesis has depth 0, each subsequent change has depth = max(dep depths) + 1.
 */

import type {Client, ChangesResponse} from '../client'

export type DocumentState = {
  genesis: string
  heads: string[]
  headDepth: number
  version: string
}

/**
 * Resolves the current document state including head depth.
 */
export async function resolveDocumentState(
  client: Client,
  targetId: string,
): Promise<DocumentState> {
  const changesResp = await client.listChanges(targetId)

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

/**
 * Computes depth for every change in the DAG via BFS from genesis.
 */
function computeDepths(changesResp: ChangesResponse): Map<string, number> {
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
    const currentDepth = depthMap.get(current)!

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

import {getVersionHeads} from '@shm/shared/utils/entity-id-url'

/** Raw document change data needed to build a version dependency graph. */
export type DocumentVersionGraphChange = {
  id?: string
  deps?: string[]
  author?: string
  createTime?: string
}

/** A rendered node in the document version dependency graph. */
export type DocumentVersionGraphNode = {
  id: string
  shortId: string
  deps: string[]
  dependents: string[]
  author?: string
  createTime?: string
  depth: number
  lane: number
  row: number
  isHead: boolean
  isGenesis: boolean
  isMerge: boolean
  isMissing: boolean
}

/** A dependency edge from one document version to a later version. */
export type DocumentVersionGraphEdge = {
  from: string
  to: string
}

/** Prepared graph model for rendering a document version dependency DAG. */
export type DocumentVersionGraphModel = {
  nodes: DocumentVersionGraphNode[]
  edges: DocumentVersionGraphEdge[]
  nodesById: Record<string, DocumentVersionGraphNode>
  heads: string[]
  maxLane: number
}

type InternalGraphNode = {
  id: string
  deps: string[]
  dependents: string[]
  author?: string
  createTime?: string
  originalIndex: number
  isMissing: boolean
}

/** Converts raw ListChanges output into a deterministic document version dependency graph. */
export function buildDocumentVersionGraph({
  changes,
  latestVersion,
}: {
  changes: DocumentVersionGraphChange[] | undefined
  latestVersion?: string | null
}): DocumentVersionGraphModel {
  const internalNodes = new Map<string, InternalGraphNode>()

  ;(changes || []).forEach((change, index) => {
    if (!change.id || internalNodes.has(change.id)) return

    internalNodes.set(change.id, {
      id: change.id,
      deps: uniqueStrings(change.deps),
      dependents: [],
      author: change.author,
      createTime: change.createTime,
      originalIndex: index,
      isMissing: false,
    })
  })

  for (const node of Array.from(internalNodes.values())) {
    for (const dep of node.deps) {
      if (!internalNodes.has(dep)) {
        internalNodes.set(dep, {
          id: dep,
          deps: [],
          dependents: [],
          originalIndex: Number.MAX_SAFE_INTEGER,
          isMissing: true,
        })
      }
      internalNodes.get(dep)?.dependents.push(node.id)
    }
  }

  const depths = computeDepths(internalNodes)
  const edges = Array.from(internalNodes.values())
    .flatMap((node) => node.deps.map((dep) => ({from: dep, to: node.id})))
    .sort((a, b) => compareByDisplayOrder(a.to, b.to, internalNodes, depths) || a.from.localeCompare(b.from))
  const inferredHeads = Array.from(internalNodes.values())
    .filter((node) => !node.isMissing && node.dependents.length === 0)
    .map((node) => node.id)
  const explicitHeads = getVersionHeads(latestVersion).filter((head) => internalNodes.has(head))
  const heads = (explicitHeads.length ? explicitHeads : inferredHeads).sort(
    (a, b) => compareByDisplayOrder(a, b, internalNodes, depths) || a.localeCompare(b),
  )

  const displayNodes = Array.from(internalNodes.values()).sort(
    (a, b) => compareByDisplayOrder(a.id, b.id, internalNodes, depths) || a.id.localeCompare(b.id),
  )
  const lanes = assignLanes(displayNodes, heads)
  const headSet = new Set(heads)
  const nodes = displayNodes.map((node, row) => ({
    id: node.id,
    shortId: abbreviateChangeId(node.id),
    deps: node.deps,
    dependents: node.dependents.sort(),
    author: node.author,
    createTime: node.createTime,
    depth: depths.get(node.id) || 0,
    lane: lanes.get(node.id) || 0,
    row,
    isHead: headSet.has(node.id),
    isGenesis: node.deps.length === 0 && !node.isMissing,
    isMerge: node.deps.length > 1,
    isMissing: node.isMissing,
  }))
  const nodesById = Object.fromEntries(nodes.map((node) => [node.id, node]))

  return {
    nodes,
    edges,
    nodesById,
    heads,
    maxLane: nodes.reduce((maxLane, node) => Math.max(maxLane, node.lane), 0),
  }
}

function uniqueStrings(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).filter(Boolean)))
}

function abbreviateChangeId(id: string): string {
  if (id.length <= 14) return id
  return `${id.slice(0, 7)}…${id.slice(-5)}`
}

function computeDepths(nodes: Map<string, InternalGraphNode>): Map<string, number> {
  const depths = new Map<string, number>()
  const visiting = new Set<string>()

  const resolveDepth = (id: string): number => {
    const cachedDepth = depths.get(id)
    if (cachedDepth !== undefined) return cachedDepth
    const node = nodes.get(id)
    if (!node || visiting.has(id)) return 0

    visiting.add(id)
    const depth = node.deps.length ? Math.max(...node.deps.map((dep) => resolveDepth(dep))) + 1 : 0
    visiting.delete(id)
    depths.set(id, depth)
    return depth
  }

  for (const id of Array.from(nodes.keys())) {
    resolveDepth(id)
  }

  return depths
}

function compareByDisplayOrder(
  a: string,
  b: string,
  nodes: Map<string, InternalGraphNode>,
  depths: Map<string, number>,
): number {
  const nodeA = nodes.get(a)
  const nodeB = nodes.get(b)
  const depthDiff = (depths.get(b) || 0) - (depths.get(a) || 0)
  if (depthDiff) return depthDiff

  const timeA = Date.parse(nodeA?.createTime || '')
  const timeB = Date.parse(nodeB?.createTime || '')
  if (!Number.isNaN(timeA) && !Number.isNaN(timeB) && timeA !== timeB) {
    return timeB - timeA
  }

  return (nodeA?.originalIndex || 0) - (nodeB?.originalIndex || 0)
}

function assignLanes(displayNodes: InternalGraphNode[], heads: string[]): Map<string, number> {
  const lanes = new Map<string, number>()
  let nextLane = 0

  for (const head of heads) {
    if (!lanes.has(head)) {
      lanes.set(head, nextLane)
      nextLane += 1
    }
  }

  for (const node of displayNodes) {
    if (!lanes.has(node.id)) {
      lanes.set(node.id, nextLane)
      nextLane += 1
    }

    const nodeLane = lanes.get(node.id) || 0
    node.deps.forEach((dep, depIndex) => {
      if (lanes.has(dep)) return
      lanes.set(dep, depIndex === 0 ? nodeLane : nextLane)
      if (depIndex !== 0) {
        nextLane += 1
      }
    })
  }

  return lanes
}

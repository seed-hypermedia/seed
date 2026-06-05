import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {getMetadataName} from '../content'

export type DocumentTreeNode = {
  doc: HMDocumentInfo
  children: DocumentTreeNode[]
  depth: number
}

export type FlatRow = {
  doc: HMDocumentInfo
  depth: number
  hasChildren: boolean
  pathKey: string
}

function pathKeyOf(doc: HMDocumentInfo): string {
  return doc.path?.join('/') ?? ''
}

function documentName(doc: HMDocumentInfo): string {
  return getMetadataName(doc.metadata) ?? doc.path?.join('/') ?? ''
}

export function buildDocumentTree(docs: HMDocumentInfo[]): DocumentTreeNode[] {
  const pathMap = new Map<string, HMDocumentInfo>()
  for (const doc of docs) {
    const key = pathKeyOf(doc)
    if (key === '') continue
    pathMap.set(key, doc)
  }

  const childrenMap = new Map<string, HMDocumentInfo[]>()

  pathMap.forEach((doc, pathKey) => {
    const parts = pathKey.split('/')
    let parentKey = ''
    for (let i = parts.length - 1; i >= 1; i--) {
      const candidate = parts.slice(0, i).join('/')
      if (pathMap.has(candidate) || candidate === '') {
        parentKey = candidate
        break
      }
    }
    if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, [])
    childrenMap.get(parentKey)!.push(doc)
  })

  function buildSubtree(parentKey: string, depth: number): DocumentTreeNode[] {
    const children = childrenMap.get(parentKey) ?? []
    children.sort((a, b) => documentName(a).localeCompare(documentName(b)))
    return children.map((doc) => ({
      doc,
      depth,
      children: buildSubtree(pathKeyOf(doc), depth + 1),
    }))
  }

  return buildSubtree('', 0)
}

export function flattenTree(
  nodes: DocumentTreeNode[],
  expandedPaths: Set<string>,
  sortFn?: (a: DocumentTreeNode, b: DocumentTreeNode) => number,
): FlatRow[] {
  const result: FlatRow[] = []

  function walk(currentNodes: DocumentTreeNode[]) {
    const sorted = sortFn ? [...currentNodes].sort(sortFn) : currentNodes
    for (const node of sorted) {
      const pathKey = pathKeyOf(node.doc)
      const hasChildren = node.children.length > 0
      result.push({doc: node.doc, depth: node.depth, hasChildren, pathKey})
      if (hasChildren && expandedPaths.has(pathKey)) {
        walk(node.children)
      }
    }
  }

  walk(nodes)
  return result
}

import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {hmId} from './entity-id-url'
import {isDraftPlaceholderPath, type HMListedDraftWithLocation} from '../draft-breadcrumb-context'
import {getDocumentTitle} from '../content'

export type DocumentTreeNode = {
  doc: HMDocumentInfo
  children: DocumentTreeNode[]
  depth: number
  /** True when this node is an ancestor kept only for context (not a filter match). */
  contextOnly?: boolean
}

export type FlatRow = {
  doc: HMDocumentInfo
  depth: number
  hasChildren: boolean
  pathKey: string
  /** True when this row is an ancestor kept only for context (not a filter match). */
  contextOnly?: boolean
}

function pathKeyOf(doc: HMDocumentInfo): string {
  return doc.path?.join('/') ?? ''
}

function documentName(doc: HMDocumentInfo): string {
  return getDocumentTitle(doc, '')
}

/** Filters documents by a case-insensitive substring of their displayed title. */
export function filterDocumentsByTitle(docs: HMDocumentInfo[], query: string): HMDocumentInfo[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return docs
  return docs.filter((doc) => documentName(doc).toLocaleLowerCase().includes(normalized))
}

/** Returns the hierarchical path keys that must be expanded to reveal a document. */
export function getAncestorPathKeys(path: string[] | null | undefined): string[] {
  if (!path) return []
  return path.slice(0, -1).map((_, index) => path.slice(0, index + 1).join('/'))
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
      result.push({doc: node.doc, depth: node.depth, hasChildren, pathKey, contextOnly: node.contextOnly})
      if (hasChildren && expandedPaths.has(pathKey)) {
        walk(node.children)
      }
    }
  }

  walk(nodes)
  return result
}

/** A published directory doc plus the drafts derived from it, keyed by document id. */
export type AllDocumentsWithDrafts = {
  documents: HMDocumentInfo[]
  /** Document ids that are unpublished drafts (for icon/marker rendering). */
  unpublishedDraftIds: Set<string>
}

/**
 * Merges a space's published directory with the account's unpublished drafts, turning each
 * unlinked draft into a synthetic document at `/<location>/-<draftId>`. Shared by the sidebar
 * and the All documents page so both list drafts identically. Maps draft `lastUpdateTime`
 * (milliseconds) to `updateTime` (seconds) so drafts show and sort by it.
 */
export function mergeDraftDocuments(
  directory: HMDocumentInfo[] | null | undefined,
  drafts: HMListedDraftWithLocation[] | null | undefined,
): AllDocumentsWithDrafts {
  const unpublished = (drafts ?? []).flatMap((draft) => {
    const {editId, locationId} = draft
    if (!locationId || (editId && !isDraftPlaceholderPath(editId.path, draft.id))) return []
    const path = [...(locationId.path ?? []), `-${draft.id}`]
    // Draft lastUpdateTime is epoch milliseconds; HMDocumentInfo.updateTime is a Timestamp with .seconds.
    const updateTime =
      typeof draft.lastUpdateTime === 'number' ? {seconds: Math.floor(draft.lastUpdateTime / 1000)} : undefined
    return [
      {
        id: editId ?? hmId(locationId.uid, {path}),
        path,
        metadata: draft.metadata,
        isCollection: draft.isCollection ?? false,
        visibility: draft.visibility ?? 'PUBLIC',
        updateTime,
      } as HMDocumentInfo,
    ]
  })
  return {
    documents: [...(directory ?? []), ...unpublished],
    unpublishedDraftIds: new Set(unpublished.map((draft) => draft.id.id)),
  }
}

/**
 * The space's documents for the All documents view: published non-home docs plus unpublished
 * drafts. The home doc (empty path) is excluded so it never appears in the list or count.
 * Shared by the page and the sidebar so the sidebar count always equals the page's All count.
 */
export function listSpaceDocuments(
  directory: HMDocumentInfo[] | null | undefined,
  drafts: HMListedDraftWithLocation[] | null | undefined,
): AllDocumentsWithDrafts {
  const merged = mergeDraftDocuments(directory, drafts)
  return {
    documents: merged.documents.filter((doc) => (doc.path?.length ?? 0) > 0),
    unpublishedDraftIds: merged.unpublishedDraftIds,
  }
}

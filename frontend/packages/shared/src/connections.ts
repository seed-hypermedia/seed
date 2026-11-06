import type {HMBlockNode, HMRawCitation, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {extractAllContentRefs} from './content'
import {extractViewTermFromUrl, hmId, unpackHmId} from './utils/entity-id-url'
import {normalizeDate} from './utils/date'

/** One source item that contains a backlink. */
export type DocumentConnectionSource = {
  id: UnpackedHypermediaId
  citation: HMRawCitation
  isComment: boolean
}

/** Backlink source items grouped under their containing document. */
export type DocumentConnection = {
  id: UnpackedHypermediaId
  sources: DocumentConnectionSource[]
}

/** Groups external incoming links by document, keeping each source block once at its newest recorded version. */
export function groupDocumentConnections(
  targetDocId: UnpackedHypermediaId,
  citations: HMRawCitation[] = [],
  targetBlockId?: string,
): DocumentConnection[] {
  const groups = new Map<string, {id: UnpackedHypermediaId; sources: Map<string, DocumentConnectionSource>}>()
  const sorted = [...citations].sort(
    (a, b) =>
      (normalizeDate(b.sourceBlob?.createTime)?.getTime() ?? 0) -
      (normalizeDate(a.sourceBlob?.createTime)?.getTime() ?? 0),
  )
  for (const citation of sorted) {
    if (targetBlockId && citation.targetFragment?.split('[')[0] !== targetBlockId) continue
    const isComment = citation.sourceType === 'Comment' || citation.citationType?.startsWith('comment/') === true
    if (!isComment && citation.sourceType !== 'Ref' && !citation.citationType?.startsWith('doc/')) continue
    const source = unpackHmId(citation.source)
    const document = isComment ? unpackHmId(citation.sourceDocument) : source
    if (!source || !document) continue
    const id = hmId(document.uid, {path: document.path})
    if (id.id === targetDocId.id) continue
    let group = groups.get(id.id)
    if (!group) {
      group = {id, sources: new Map()}
      groups.set(id.id, group)
    }
    const sourceId = hmId(source.uid, {
      path: source.path,
      // Ref blob CIDs identify citation records, not document versions.
      version: isComment ? citation.sourceBlob?.cid || source.version : source.version,
      blockRef: citation.sourceContext || source.blockRef,
    })
    const key = JSON.stringify([source.id, sourceId.blockRef])
    if (!group.sources.has(key)) group.sources.set(key, {id: sourceId, citation, isComment})
  }
  return Array.from(groups.values()).map(({id, sources}) => ({id, sources: Array.from(sources.values())}))
}

/** A document or draft with all of its direct relationships to the current document. */
export type ConnectionGraphNode = {
  key: string
  id?: UnpackedHypermediaId
  draftId?: string
  name?: string
  citation: boolean
  child: boolean
  outgoing: boolean
}

/** Merges incoming citations, children, and outgoing links without limiting the graph size. */
export function buildConnectionsGraph(
  targetDocId: UnpackedHypermediaId,
  groups: DocumentConnection[],
  children: Array<{id?: UnpackedHypermediaId; draftId?: string | null; metadata: {name?: string}}>,
  content: HMBlockNode[],
): ConnectionGraphNode[] {
  const nodes = new Map<string, ConnectionGraphNode>()
  const targetKey = hmId(targetDocId.uid, {path: targetDocId.path}).id
  function documentNode(source: UnpackedHypermediaId): ConnectionGraphNode | undefined {
    const id = hmId(source.uid, {path: source.path})
    if (id.id === targetKey) return undefined
    let node = nodes.get(id.id)
    if (!node) {
      node = {key: id.id, id, citation: false, child: false, outgoing: false}
      nodes.set(id.id, node)
    }
    return node
  }
  for (const group of groups) {
    const node = documentNode(group.id)
    if (node) node.citation = true
  }
  for (const child of children) {
    if (child.id) {
      const node = documentNode(child.id)
      if (node) {
        node.child = true
        node.name = child.metadata.name
      }
    } else if (child.draftId) {
      const key = `draft:${child.draftId}`
      nodes.set(key, {
        key,
        draftId: child.draftId,
        name: child.metadata.name,
        citation: false,
        child: true,
        outgoing: false,
      })
    }
  }
  for (const ref of extractAllContentRefs(content)) {
    if (!ref.refId || ref.mentionKind === 'account') continue
    const {url, viewTerm, commentId} = extractViewTermFromUrl(ref.link)
    if (
      commentId ||
      viewTerm === ':profile' ||
      viewTerm === ':membership' ||
      viewTerm === ':followers' ||
      viewTerm === ':following'
    )
      continue
    const id = viewTerm ? unpackHmId(url) : ref.refId
    if (!id) continue
    const node = documentNode(id)
    if (node) node.outgoing = true
  }
  return Array.from(nodes.values()).sort(
    (a, b) => Number(b.citation) - Number(a.citation) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )
}

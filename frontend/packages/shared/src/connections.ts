import type {HMRawCitation, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, unpackHmId} from './utils/entity-id-url'
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

/** Groups incoming links by document, keeping each source block once at its newest recorded version. */
export function groupDocumentConnections(
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
    let group = groups.get(id.id)
    if (!group) {
      group = {id, sources: new Map()}
      groups.set(id.id, group)
    }
    const sourceId = hmId(source.uid, {
      path: source.path,
      version: citation.sourceBlob?.cid || source.version,
      blockRef: citation.sourceContext || source.blockRef,
    })
    const key = JSON.stringify([source.id, sourceId.blockRef])
    if (!group.sources.has(key)) group.sources.set(key, {id: sourceId, citation, isComment})
  }
  return [...groups.values()].map(({id, sources}) => ({id, sources: [...sources.values()]}))
}

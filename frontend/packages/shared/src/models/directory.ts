import {HMDocumentInfo, HMQuery, HMQueryResult, UnpackedHypermediaId} from '..'
import {BIG_INT} from '../constants'
import {GRPCClient} from '../grpc-client'
import {hmId} from '../utils'
import {prepareHMDocumentInfo} from './entity'

export function getDiretoryWithClient(client: GRPCClient) {
  async function getDirectory(
    id: UnpackedHypermediaId,
    mode: 'Children' | 'AllDescendants' = 'AllDescendants',
  ) {
    const listResult = await client.documents.listDocuments({
      account: id.uid,
      pageSize: BIG_INT,
    })
    // filter listResult by the id.path, and if mode is "Children", filter by the immediate children
    const allDocumentInfos = listResult.documents.map(prepareHMDocumentInfo)
    const filteredDocumentInfos = allDocumentInfos.filter(
      (doc: HMDocumentInfo) => {
        // Skip if document is the parent itself
        if (doc.id.id === id.id) return false

        // Skip if document is not a descendant of the parent
        if (!doc.id.id.startsWith(id.id)) return false

        if (mode === 'Children') {
          // For Children mode, only include immediate children
          // (path should only be one level deeper than parent)
          const includeInDir =
            doc.id.path?.length === (id.path?.length || 0) + 1
          return includeInDir
        }
        // For AllDescendants mode, include all nested documents
        return true
      },
    )
    return filteredDocumentInfos
  }

  return getDirectory
}

export function getQueryResultsWithClient(client: GRPCClient) {
  const getDirectory = getDiretoryWithClient(client)
  async function getQueryResults(
    query: HMQuery,
  ): Promise<HMQueryResult | null> {
    const {includes} = query
    if (includes.length !== 1) return null // only support one include for now
    // @ts-ignore
    const {path, mode, space} = includes[0]
    const inId = hmId(space, {
      path: path ? path.split('/') : [],
    })
    const dir = await getDirectory(inId, mode)
    if (!inId) return null
    return {in: inId, results: dir, mode} satisfies HMQueryResult
  }

  return getQueryResults
}

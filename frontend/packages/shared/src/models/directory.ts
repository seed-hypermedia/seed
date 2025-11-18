import {DocumentInfo, HMQuery, HMQueryResult, UnpackedHypermediaId} from '..'
import {BIG_INT} from '../constants'
import {GRPCClient} from '../grpc-client'
import {hmId, hmIdPathToEntityQueryPath} from '../utils'
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
    return (
      listResult.documents
        .filter((doc: DocumentInfo) => {
          const docPathStr = doc.path
          const parentPath = id.path || []
          const parentPathStr = hmIdPathToEntityQueryPath(id.path)

          // Skip if document is the parent itself
          if (docPathStr === parentPathStr) return false

          // Check if document is a descendant of the parent
          if (!docPathStr.startsWith(parentPathStr + '/')) return false

          if (mode === 'Children') {
            // For Children mode, only include immediate children
            // (path should only be one level deeper than parent)
            const includeInDir =
              doc.path.slice(1).split('/').length === parentPath.length + 1
            return includeInDir
          }
          // For AllDescendants mode, include all nested documents
          return true
        })
        // .map(prepareHMDocumentInfo)
        .map((dirDoc: DocumentInfo) => {
          const docInfo = prepareHMDocumentInfo(dirDoc)
          return docInfo
        })
    )
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

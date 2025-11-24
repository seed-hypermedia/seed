import {HMDocumentInfo, HMQuery, HMQueryResult, UnpackedHypermediaId} from '..'
import {BIG_INT} from '../constants'
import {queryBlockSortedItems} from '../content'
import {GRPCClient} from '../grpc-client'
import {entityQueryPathToHmIdPath, hmId} from '../utils'
import {prepareHMDocumentInfo} from './entity'

export function createDirectoryResolver(client: GRPCClient) {
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
            (doc.id.path?.length || 0) === (id.path?.length || 0) + 1
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

export function createQueryResolver(client: GRPCClient) {
  const getDirectory = createDirectoryResolver(client)
  async function getQueryResults(
    query: HMQuery,
  ): Promise<HMQueryResult | null> {
    const {includes, sort} = query
    if (includes.length !== 1) return null // only support one include for now
    const {path, mode, space} = includes[0]!
    const inId = hmId(space, {
      path: entityQueryPathToHmIdPath(path),
    })
    const dir = await getDirectory(inId, mode)
    if (!inId) return null

    // Apply sorting - default to UpdateTime descending if no sort specified
    const sortedDir = sort
      ? queryBlockSortedItems({entries: dir, sort})
      : queryBlockSortedItems({
          entries: dir,
          sort: [{term: 'UpdateTime', reverse: false}],
        })
    return {in: inId, results: sortedDir, mode} satisfies HMQueryResult
  }

  return getQueryResults
}

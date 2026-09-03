import {HMDocumentInfo, HMQuery, HMQueryResult, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {normalizeQuerySort} from '@seed-hypermedia/client/hm-types'
import {SortAttribute} from '../client/.generated/documents/v3alpha/documents_pb'
import {queryBlockSortedItems} from '../content'
import {GRPCClient} from '../grpc-client'
import {entityQueryPathToHmIdPath, hmId} from '../utils'
import {LIST_PAGE_SIZE, listAllPages} from '../list-all-pages'
import {hmIdPathToEntityQueryPath} from '../utils/path-api'
import {prepareHMDocumentInfo} from './entity'

function createDirectoryResolver(client: GRPCClient) {
  async function getDirectory(
    id: UnpackedHypermediaId,
    mode: 'Children' | 'AllDescendants' = 'AllDescendants',
    sort?: Array<{term: string; reverse: boolean}>,
  ) {
    const term = sort?.length === 1 ? sort[0]?.term : undefined
    const reverse = sort?.length === 1 ? !!sort[0]?.reverse : false
    const sortOptions =
      term === 'activity'
        ? {attribute: SortAttribute.ACTIVITY_TIME, descending: reverse}
        : term === 'title'
          ? {attribute: SortAttribute.NAME, descending: reverse}
          : term === 'path'
            ? {attribute: SortAttribute.PATH, descending: reverse}
            : undefined

    const documents = await listAllPages(
      (pageToken) =>
        client.documents.listDirectory({
          account: id.uid,
          directoryPath: hmIdPathToEntityQueryPath(id.path),
          recursive: mode === 'AllDescendants',
          pageSize: LIST_PAGE_SIZE,
          pageToken,
          ...(sortOptions ? {sortOptions} : {}),
        }),
      (r) => ({items: r.documents, nextPageToken: r.nextPageToken}),
    )

    return documents.map(prepareHMDocumentInfo).filter((doc: HMDocumentInfo) => {
      if (doc.id.id === id.id) return false
      if (!doc.id.id.startsWith(id.id)) return false

      if (mode === 'Children') {
        return (doc.id.path?.length || 0) === (id.path?.length || 0) + 1
      }

      return true
    })
  }

  return getDirectory
}

export function createQueryResolver(client: GRPCClient) {
  const getDirectory = createDirectoryResolver(client)
  async function getQueryResults(query: HMQuery): Promise<HMQueryResult | null> {
    const {includes} = query
    if (includes.length !== 1) return null // only support one include for now
    const {path, mode, space} = includes[0]!
    const inId = hmId(space, {
      path: entityQueryPathToHmIdPath(path),
    })
    if (!inId) return null

    const sort = normalizeQuerySort(query.sort)
    const effectiveSort = sort.length === 1 ? sort : [{term: 'updated', reverse: true}]

    const dir = await getDirectory(inId, mode, effectiveSort)
    const sortedDir = queryBlockSortedItems({entries: dir, sort: effectiveSort})
    return {in: inId, results: sortedDir, mode} satisfies HMQueryResult
  }

  return getQueryResults
}

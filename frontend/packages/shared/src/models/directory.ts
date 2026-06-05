import {
  HMDocumentInfo,
  HMQuery,
  HMQueryFilter,
  HMQueryResult,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {SortAttribute} from '../client/.generated/documents/v3alpha/documents_pb'
import {BIG_INT} from '../constants'
import {queryBlockSortedItems} from '../content'
import {GRPCClient} from '../grpc-client'
import {entityQueryPathToHmIdPath, hmId} from '../utils'
import {hmIdPathToEntityQueryPath} from '../utils/path-api'
import {prepareHMDocumentInfo} from './entity'

function filterQueryResults(entries: HMDocumentInfo[], filters: HMQueryFilter[] | undefined): HMDocumentInfo[] {
  if (!filters?.length) return entries

  const authorUids = filters.map((filter) => filter.uid).filter(Boolean)
  if (!authorUids.length) return entries

  return entries.filter((entry) => authorUids.some((uid) => entry.authors.includes(uid)))
}

function createDirectoryResolver(client: GRPCClient) {
  async function getDirectory(
    id: UnpackedHypermediaId,
    mode: 'Children' | 'AllDescendants' = 'AllDescendants',
    sort?: HMQuery['sort'],
  ) {
    const sortTerm = sort?.length === 1 ? sort[0]?.term : undefined
    const reverse = sort?.length === 1 ? !!sort[0]?.reverse : false
    const sortOptions =
      sortTerm === 'ActivityTime'
        ? {attribute: SortAttribute.ACTIVITY_TIME, descending: !reverse}
        : sortTerm === 'Title'
        ? {attribute: SortAttribute.NAME, descending: reverse}
        : undefined

    const listResult = await client.documents.listDirectory({
      account: id.uid,
      directoryPath: hmIdPathToEntityQueryPath(id.path),
      recursive: mode === 'AllDescendants',
      pageSize: BIG_INT,
      ...(sortOptions ? {sortOptions} : {}),
    })

    return listResult.documents.map(prepareHMDocumentInfo).filter((doc: HMDocumentInfo) => {
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
    const {includes, sort, filters} = query
    if (includes.length !== 1) return null // only support one include for now
    const {path, mode, space} = includes[0]!
    const inId = hmId(space, {
      path: entityQueryPathToHmIdPath(path),
    })
    const dir = await getDirectory(inId, mode, sort)
    if (!inId) return null

    const filteredDir = filterQueryResults(dir, filters)
    const sortedDir = sort
      ? queryBlockSortedItems({entries: filteredDir, sort})
      : queryBlockSortedItems({
          entries: filteredDir,
          sort: [{term: 'UpdateTime', reverse: false}],
        })
    return {in: inId, results: sortedDir, mode} satisfies HMQueryResult
  }

  return getQueryResults
}

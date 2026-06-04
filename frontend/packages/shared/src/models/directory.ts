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

function dateValueMs(value: unknown): number | null {
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : ms
  }
  if (value instanceof Date) return value.getTime()
  if (value && typeof value === 'object' && 'seconds' in value) {
    const seconds = Number((value as {seconds: unknown}).seconds)
    const nanos = Number((value as {nanos?: unknown}).nanos ?? 0)
    if (!Number.isFinite(seconds)) return null
    return seconds * 1000 + Math.floor(nanos / 1_000_000)
  }
  return null
}

function publishDateMs(entry: HMDocumentInfo): number | null {
  const displayPublishTime = entry.metadata.displayPublishTime
  if (displayPublishTime) {
    const ms = Date.parse(displayPublishTime)
    if (!Number.isNaN(ms)) return ms
  }
  return dateValueMs(entry.updateTime)
}

function startDateMs(value: string | undefined): number | null {
  if (!value?.trim()) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

function endDateMs(value: string | undefined): number | null {
  if (!value?.trim()) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return ms + 24 * 60 * 60 * 1000 - 1
  return ms
}

function filterQueryResults(entries: HMDocumentInfo[], filters: HMQueryFilter[] | undefined): HMDocumentInfo[] {
  if (!filters?.length) return entries

  const authorUids = filters
    .filter((filter): filter is Extract<HMQueryFilter, {type: 'Author'}> => filter.type === 'Author')
    .map((filter) => filter.uid)
    .filter(Boolean)
  const publishDateFilters = filters.filter(
    (filter): filter is Extract<HMQueryFilter, {type: 'PublishDate'}> => filter.type === 'PublishDate',
  )

  return entries.filter((entry) => {
    if (authorUids.length && !authorUids.some((uid) => entry.authors.includes(uid))) return false

    for (const filter of publishDateFilters) {
      const from = startDateMs(filter.from)
      const to = endDateMs(filter.to)
      if (from == null && to == null) continue

      const publishDate = publishDateMs(entry)
      if (publishDate == null) return false
      if (from != null && publishDate < from) return false
      if (to != null && publishDate > to) return false
    }

    return true
  })
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

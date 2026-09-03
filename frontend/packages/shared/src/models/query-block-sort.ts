import type {HMQuery} from '@seed-hypermedia/client/hm-types'
import {normalizeQuerySort} from '@seed-hypermedia/client/hm-types'
import {
  BuiltinSortAttribute,
  DocumentFilter,
  DocumentFilter_And,
  DocumentFilter_PathMatch,
  DocumentFilter_SpaceMatch,
  DocumentSort,
  QueryDocumentsRequest,
} from '../client/grpc-types'

/** Default page size used when a query block does not set a limit. */
export const QUERY_BLOCK_DEFAULT_PAGE_SIZE = 100

const METADATA_SORT_PREFIX = 'metadata:'

/**
 * Maps a canonical query-block sort key to the DocumentSort the QueryDocuments
 * API should use. Returns null for keys the server cannot sort by
 * (children/citations/tags/authors), which are sorted client-side instead.
 */
export function sortKeyToDocumentSort(key: string, reverse: boolean): DocumentSort | null {
  switch (key) {
    case 'title':
      return new DocumentSort({attribute: BuiltinSortAttribute.NAME, descending: reverse})
    case 'path':
      return new DocumentSort({attribute: BuiltinSortAttribute.PATH, descending: reverse})
    case 'created':
      return new DocumentSort({attribute: BuiltinSortAttribute.CREATE_TIME, descending: reverse})
    case 'updated':
      return new DocumentSort({attribute: BuiltinSortAttribute.UPDATE_TIME, descending: reverse})
    case 'activity':
      return new DocumentSort({attribute: BuiltinSortAttribute.ACTIVITY_TIME, descending: reverse})
    case 'comments':
      return new DocumentSort({attribute: BuiltinSortAttribute.COMMENT_COUNT, descending: reverse})
    case 'displayTime':
      return new DocumentSort({key: 'displayPublishTime', descending: reverse})
    default:
      if (key.startsWith(METADATA_SORT_PREFIX)) {
        return new DocumentSort({key: key.slice(METADATA_SORT_PREFIX.length), descending: reverse})
      }
      return null
  }
}

/** Converts a query-block entity path to the canonical PathMatch path form. */
function toPathMatchPath(path: string | undefined): string {
  if (!path) return ''
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

/**
 * Deterministically derives a QueryDocumentsRequest from persisted query-block
 * data. Returns null when there is no resolvable target (no space selected).
 *
 * The include's space/path are expressed as SpaceMatch + PathMatch (subtree)
 * filters, and each sort rule is mapped through {@link sortKeyToDocumentSort};
 * unsupported sort keys are omitted so the server applies its default order.
 */
export function queryToQueryDocumentsRequest(query: HMQuery): QueryDocumentsRequest | null {
  const include = query.includes?.[0]
  if (!include?.space) return null

  const filters: DocumentFilter[] = [
    new DocumentFilter({
      filter: {case: 'spaceMatch', value: new DocumentFilter_SpaceMatch({space: include.space})},
    }),
    new DocumentFilter({
      filter: {
        case: 'pathMatch',
        value: new DocumentFilter_PathMatch({path: toPathMatchPath(include.path), prefix: true}),
      },
    }),
  ]

  const sort = normalizeQuerySort(query.sort as Array<{key?: string; term?: string; reverse?: boolean}> | undefined)
    .map((rule) => sortKeyToDocumentSort(rule.key, rule.reverse))
    .filter((rule): rule is DocumentSort => rule !== null)

  // The limit is applied by the caller after post-filtering (as the previous
  // resolver did), so page_size only controls fetch batching here.
  return new QueryDocumentsRequest({
    filter: new DocumentFilter({filter: {case: 'and', value: new DocumentFilter_And({filters})}}),
    sort,
    pageSize: QUERY_BLOCK_DEFAULT_PAGE_SIZE,
  })
}

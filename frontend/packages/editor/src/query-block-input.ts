/**
 * Query-block request-input derivation, in a dependency-free module so the
 * web loader can import it without entering the editor block-spec import
 * cycle. The QueryBlock component and the loader prefetch must compute the
 * EXACT same input — it is the React Query cache key; any drift means
 * prefetched data is never found (SSR renders an empty query block and the
 * client refetches after mount).
 */

import {normalizeQuerySort} from '@seed-hypermedia/client/hm-types'

export const defaultQueryIncludes = '[{"space":"","path":"","mode":"Children"}]'
// Newest-first (updated descending), matching the previous UpdateTime default.
export const defaultQuerySort = '[{"term":"updated","reverse":true}]'

export type QueryBlockInputProps = {
  queryIncludes?: string
  querySort?: string
  queryLimit?: string
}

/** The document a query block sits in; an include with an empty space targets it. */
export type QueryBlockContainer = {uid: string; path?: string[] | null}

/** Points includes with an empty space at the containing document, as the collection view does. */
export function resolveQueryIncludes(includes: any[], container: QueryBlockContainer | null | undefined): any[] {
  if (!Array.isArray(includes) || !container) return includes
  const path = (container.path ?? []).filter(Boolean).join('/')
  return includes.map((include) => (include?.space ? include : {...include, space: container.uid, path}))
}

export function getQueryBlockInput(
  props: QueryBlockInputProps,
  container?: QueryBlockContainer | null,
): {query: {includes: any[]; sort: {term: string; reverse: boolean}[]; limit: number | undefined}} | null {
  const queryIncludes = resolveQueryIncludes(JSON.parse(props.queryIncludes || defaultQueryIncludes), container)
  const parsedSort = JSON.parse(props.querySort || defaultQuerySort)
  const querySort = normalizeQuerySort(parsedSort)
  const parsedLimit = parseInt(props.queryLimit || '', 10)
  if (!queryIncludes?.[0]?.space) return null
  return {
    query: {
      includes: queryIncludes,
      sort: querySort,
      limit: parsedLimit > 0 ? parsedLimit : undefined,
    },
  }
}

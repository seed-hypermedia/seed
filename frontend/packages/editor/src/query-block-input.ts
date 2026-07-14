/**
 * Query-block request-input derivation, in a dependency-free module so the
 * web loader can import it without entering the editor block-spec import
 * cycle. The QueryBlock component and the loader prefetch must compute the
 * EXACT same input — it is the React Query cache key; any drift means
 * prefetched data is never found (SSR renders an empty query block and the
 * client refetches after mount).
 */

export const defaultQueryIncludes = '[{"space":"","path":"","mode":"Children"}]'
export const defaultQuerySort = '[{"term":"UpdateTime","reverse":false}]'

export type QueryBlockInputProps = {
  queryIncludes?: string
  querySort?: string
  queryLimit?: string
}

export function getQueryBlockInput(
  props: QueryBlockInputProps,
): {query: {includes: any[]; sort: any; limit: number | undefined}} | null {
  const queryIncludes = JSON.parse(props.queryIncludes || defaultQueryIncludes)
  const querySort = JSON.parse(props.querySort || defaultQuerySort)
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

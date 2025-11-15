/**
 * React Hooks for GraphQL Queries
 *
 * Provides React hooks for querying the GraphQL API with urql.
 */

import {useQuery, type UseQueryResponse} from 'urql'
import {
  GET_RESOURCE_QUERY,
  LIST_COMMENTS_QUERY,
  HELLO_QUERY,
} from './queries'
import type {
  NormalizedResource,
  NormalizedDocument,
  NormalizedComment,
} from './types'

/**
 * Query result for getResource
 */
export interface GetResourceData {
  getResource: NormalizedResource
}

export interface GetResourceVariables {
  iri: string
}

/**
 * Hook to fetch a resource by IRI
 *
 * @param iri - HM IRI of the resource
 * @param pause - Pause query execution
 * @returns urql query result
 */
export function useResource(
  iri: string,
  pause?: boolean,
): UseQueryResponse<GetResourceData, GetResourceVariables>[0] {
  const [result] = useQuery<GetResourceData, GetResourceVariables>({
    query: GET_RESOURCE_QUERY,
    variables: {iri},
    pause,
  })

  return result
}

/**
 * Query result for listComments
 */
export interface ListCommentsData {
  getResource: NormalizedDocument & {
    discussions: NormalizedComment[]
  }
}

export interface ListCommentsVariables {
  iri: string
  pageSize?: number
  pageToken?: string
}

/**
 * Hook to fetch comments for a document
 *
 * @param iri - HM IRI of the document
 * @param options - Query options (pageSize, pageToken, pause)
 * @returns urql query result
 */
export function useComments(
  iri: string,
  options?: {
    pageSize?: number
    pageToken?: string
    pause?: boolean
  },
): UseQueryResponse<ListCommentsData, ListCommentsVariables>[0] {
  const {pageSize, pageToken, pause} = options || {}

  const [result] = useQuery<ListCommentsData, ListCommentsVariables>({
    query: LIST_COMMENTS_QUERY,
    variables: {
      iri,
      pageSize,
      pageToken,
    },
    pause,
  })

  return result
}

/**
 * Query result for hello
 */
export interface HelloData {
  hello: string
}

/**
 * Hook for health check query
 *
 * @param pause - Pause query execution
 * @returns urql query result
 */
export function useHello(
  pause?: boolean,
): UseQueryResponse<HelloData, object>[0] {
  const [result] = useQuery<HelloData, object>({
    query: HELLO_QUERY,
    pause,
  })

  return result
}

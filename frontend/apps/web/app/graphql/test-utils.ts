import {Client, cacheExchange, fetchExchange, type AnyVariables} from '@urql/core'

/**
 * Creates a urql GraphQL client for testing
 */
export function createTestGraphQLClient(baseUrl: string = 'http://localhost:58001') {
  return new Client({
    url: `${baseUrl}/hm/api/graphql`,
    exchanges: [cacheExchange, fetchExchange],
    // Disable request policy to always fetch fresh data in tests
    requestPolicy: 'network-only',
  })
}

/**
 * Helper to execute GraphQL queries in tests
 */
export async function executeQuery<TData = any, TVariables extends AnyVariables = AnyVariables>(
  client: Client,
  query: string,
  variables?: TVariables,
) {
  const result = await client.query<TData, TVariables>(query, variables as TVariables).toPromise()

  if (result.error) {
    throw new Error(`GraphQL Error: ${result.error.message}`)
  }

  return result.data
}

/**
 * Helper to execute GraphQL mutations in tests
 */
export async function executeMutation<TData = any, TVariables extends AnyVariables = AnyVariables>(
  client: Client,
  mutation: string,
  variables?: TVariables,
) {
  const result = await client.mutation<TData, TVariables>(mutation, variables as TVariables).toPromise()

  if (result.error) {
    throw new Error(`GraphQL Error: ${result.error.message}`)
  }

  return result.data
}

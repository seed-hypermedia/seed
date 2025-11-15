/**
 * GraphQL Client
 *
 * Creates and configures urql GraphQL client with normalized caching.
 */

import {Client, fetchExchange} from '@urql/core'
import {createGraphcacheExchange} from './cache'

export interface GraphQLClientOptions {
  /** Base URL for the GraphQL endpoint */
  url: string
  /** Optional fetch implementation (for server-side usage) */
  fetch?: typeof fetch
  /** Request policy override */
  requestPolicy?: 'cache-first' | 'cache-only' | 'network-only' | 'cache-and-network'
}

/**
 * Create a GraphQL client with normalized caching
 *
 * @param options - Client configuration options
 * @returns Configured urql client
 */
export function createGraphQLClient(options: GraphQLClientOptions): Client {
  const {url, fetch: customFetch, requestPolicy = 'cache-first'} = options

  return new Client({
    url,
    fetch: customFetch,
    requestPolicy,
    exchanges: [
      // Graphcache for normalized caching
      createGraphcacheExchange(),
      // Fetch exchange for network requests
      fetchExchange,
    ],
  })
}

/**
 * Default GraphQL client instance (lazy-loaded)
 */
let defaultClient: Client | null = null

/**
 * Get or create the default GraphQL client
 *
 * @param url - GraphQL endpoint URL (required on first call)
 * @returns Default client instance
 */
export function getDefaultGraphQLClient(url?: string): Client {
  if (!defaultClient) {
    if (!url) {
      throw new Error(
        'GraphQL client URL must be provided on first initialization',
      )
    }
    defaultClient = createGraphQLClient({url})
  }
  return defaultClient
}

/**
 * Reset the default client (useful for testing)
 */
export function resetDefaultGraphQLClient(): void {
  defaultClient = null
}

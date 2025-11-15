/**
 * GraphQL Provider
 *
 * React context provider for urql GraphQL client.
 */

import React from 'react'
import {Provider as UrqlProvider, type Client} from 'urql'
import {createGraphQLClient, type GraphQLClientOptions} from './client'

export interface GraphQLProviderProps {
  /** Child components */
  children: React.ReactNode
  /** Pre-configured client instance (optional) */
  client?: Client
  /** Client options (used if client not provided) */
  options?: GraphQLClientOptions
}

/**
 * GraphQL Provider component
 *
 * Wraps app with urql Provider for GraphQL queries.
 *
 * @example
 * ```tsx
 * <GraphQLProvider options={{ url: 'http://localhost:58001/hm/api/graphql' }}>
 *   <App />
 * </GraphQLProvider>
 * ```
 */
export function GraphQLProvider({
  children,
  client,
  options,
}: GraphQLProviderProps) {
  const urqlClient = React.useMemo(() => {
    if (client) return client
    if (!options) {
      throw new Error('GraphQLProvider requires either client or options prop')
    }
    return createGraphQLClient(options)
  }, [client, options])

  return <UrqlProvider value={urqlClient}>{children}</UrqlProvider>
}

/**
 * Server-side universal client for SSR prefetching.
 *
 * This client calls gRPC directly (not via API endpoints) and is used
 * during server-side rendering to prefetch data into React Query cache.
 */

import {UniversalClient} from '@shm/shared'
import {APIRouter} from '@shm/shared/api'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import type {HMRequest} from '@shm/shared/hm-types'
import {grpcClient} from './client.server'

// queryDaemon for handlers that need direct HTTP access (e.g., GetCID)
async function queryDaemon<T>(pathAndQuery: string): Promise<T> {
  const response = await fetch(`${DAEMON_HTTP_URL}${pathAndQuery}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${pathAndQuery}: ${response.statusText}`)
  }
  return (await response.json()) as T
}

/**
 * Server-side request function for SSR.
 * Uses gRPC client directly instead of going through API endpoints.
 */
export async function serverRequest<K extends keyof typeof APIRouter>(
  key: K,
  input: Parameters<(typeof APIRouter)[K]['getData']>[1],
): Promise<Awaited<ReturnType<(typeof APIRouter)[K]['getData']>>> {
  const apiDefinition = APIRouter[key]
  const result = await apiDefinition.getData(
    grpcClient,
    input as never,
    queryDaemon,
  )
  return result as Awaited<ReturnType<(typeof APIRouter)[K]['getData']>>
}

/**
 * Server universal client for SSR prefetching.
 * Implements the same request interface as the client-side universal client.
 */
export const serverUniversalClient: UniversalClient = {
  request: serverRequest as <Request extends HMRequest>(
    key: Request['key'],
    input: Request['input'],
  ) => Promise<Request['output']>,
}

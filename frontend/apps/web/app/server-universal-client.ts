/**
 * Server-side universal client for SSR prefetching.
 *
 * This client calls gRPC directly (not via API endpoints) and is used
 * during server-side rendering to prefetch data into React Query cache.
 */

import {UniversalClient} from '@shm/shared'
import {APIRouter} from '@shm/shared/api'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
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
 * Short-lived cache for the hot read-only API keys the SSR loaders fan out on
 * every page render (a single document view fires dozens of these, and crawler
 * traffic replays the same pages continuously with no HTTP caching in front).
 *
 * Entries store in-flight Promises, so concurrent renders of the same page
 * share one gRPC call instead of racing duplicates. This client is never
 * authenticated (it always sees the public view of the data), so entries are
 * safe to share across requests and users. Failed calls are evicted so errors
 * are not cached.
 */
const CACHEABLE_KEYS: ReadonlySet<string> = new Set(['Query', 'QueryBlock', 'InteractionSummary', 'ListCitations'])
const CACHE_TTL_MS = 30_000
/** LRU-ish cap, same pattern as the SSR HTML cache in @shm/editor/ssr-render. */
const CACHE_MAX_ENTRIES = 500
const responseCache = new Map<string, {expires: number; result: Promise<unknown>}>()

/** JSON with sorted object keys, so logically-equal inputs produce one cache key. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}

/**
 * Server-side request function for SSR.
 * Uses gRPC client directly instead of going through API endpoints.
 */
export async function serverRequest<K extends keyof typeof APIRouter>(
  key: K,
  input: Parameters<(typeof APIRouter)[K]['getData']>[1],
): Promise<Awaited<ReturnType<(typeof APIRouter)[K]['getData']>>> {
  type Result = Awaited<ReturnType<(typeof APIRouter)[K]['getData']>>
  const apiDefinition = APIRouter[key]

  if (!CACHEABLE_KEYS.has(key)) {
    const result = await apiDefinition.getData(grpcClient, input as never, queryDaemon)
    return result as Result
  }

  const cacheKey = `${key}:${stableStringify(input)}`
  const cached = responseCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return cached.result as Promise<Result>
  }
  responseCache.delete(cacheKey)

  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value
    if (oldest !== undefined) responseCache.delete(oldest)
  }

  const result = apiDefinition.getData(grpcClient, input as never, queryDaemon)
  responseCache.set(cacheKey, {expires: Date.now() + CACHE_TTL_MS, result})
  result.catch(() => {
    const entry = responseCache.get(cacheKey)
    if (entry?.result === result) responseCache.delete(cacheKey)
  })
  return result as Promise<Result>
}

export const serverPublish: UniversalClient['publish'] = (input) => {
  return serverRequest('PublishBlobs', input) as ReturnType<UniversalClient['publish']>
}

/**
 * Server universal client for SSR prefetching.
 * Implements the same request interface as the client-side universal client.
 */
export const serverUniversalClient: UniversalClient = {
  request: serverRequest as UniversalClient['request'],
  publish: serverPublish,
  queryDocuments: (request, options) => grpcClient.documents.queryDocuments(request, options),
}

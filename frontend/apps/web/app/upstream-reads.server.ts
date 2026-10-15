import {Code, ConnectError} from '@connectrpc/connect'
import type {GRPCClient} from '@shm/shared/grpc-client'
import {createSeedClient} from '@seed-hypermedia/client'

/**
 * Public reads from a mainnet node for content the local daemon does not have.
 *
 * An isolated daemon (the Enterprise profile runs `-p2p.isolated`) only ever holds its own
 * organization's space, so an embed of another space's document, such as the hosted Agent Guide,
 * resolves to not-found. With `SEED_UPSTREAM_API_URL` set (e.g. `https://hyper.media`), a read
 * that comes back not-found is asked again of that node's public HTTP API, the same `/api/<Key>`
 * this app serves, and its answer is passed through. The daemon stays isolated; nothing is stored.
 *
 * Only accounts the local daemon has never seen go upstream: a miss inside the organization's own
 * space (or any space present locally) is a real miss, and its id is never sent out.
 */

const UPSTREAM_URL = (process.env.SEED_UPSTREAM_API_URL || '').trim().replace(/\/+$/, '')

/** Keys that may fall back, each with how its "not found" answer looks. */
const NOT_FOUND: Record<string, (output: any) => boolean> = {
  Resource: (output) => output?.type === 'not-found',
  ResourceMetadata: (output) => output?.metadata == null,
  Account: (output) => output?.type === 'account-not-found',
  // A directory listing of a space this node does not have comes back empty, not not-found.
  Query: (output) => Array.isArray(output?.results) && output.results.length === 0,
}

const UPSTREAM_TIMEOUT_MS = 8_000
const CACHE_TTL_MS = 60_000
const CACHE_MAX_ENTRIES = 500
const cache = new Map<string, {expires: number; result: Promise<unknown | null>}>()
const localAccountCache = new Map<string, {expires: number; local: boolean}>()

function inputUid(key: string, input: any): string | null {
  if (key === 'Account') return typeof input === 'string' ? input : null
  if (key === 'Query') {
    // Only a query over one space: a mix with this node's own space must stay local.
    const spaces = new Set<unknown>((input?.includes ?? []).map((include: any) => include?.space))
    const [space] = spaces
    return spaces.size === 1 && typeof space === 'string' ? space : null
  }
  return typeof input?.uid === 'string' ? input.uid : null
}

/** True when the local daemon knows this account (its own space, a member): then a miss there is final. */
async function isLocalAccount(grpcClient: GRPCClient, uid: string): Promise<boolean> {
  const cached = localAccountCache.get(uid)
  if (cached && cached.expires > Date.now()) return cached.local
  let local = true // if the daemon cannot answer, stay local: never send an id out on doubt
  try {
    await grpcClient.documents.getAccount({id: uid})
  } catch (error) {
    local = ConnectError.from(error).code !== Code.NotFound
  }
  localAccountCache.set(uid, {expires: Date.now() + CACHE_TTL_MS, local})
  return local
}

async function fetchUpstream(key: string, input: unknown): Promise<unknown | null> {
  const client = createSeedClient(UPSTREAM_URL)
  try {
    const output = await client.request(key as any, input as any, {signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)})
    return NOT_FOUND[key]!(output) ? null : output
  } catch (error) {
    console.warn(`[upstream] ${key} from ${UPSTREAM_URL} failed:`, error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Returns `output`, or the upstream node's answer for the same request when `output` is a
 * not-found for an account this node does not have. Off unless SEED_UPSTREAM_API_URL is set.
 */
export async function withUpstreamFallback<T>(
  key: string,
  input: unknown,
  output: T,
  grpcClient: GRPCClient,
): Promise<T> {
  if (!UPSTREAM_URL) return output
  const isNotFound = NOT_FOUND[key]
  if (!isNotFound || !isNotFound(output)) return output
  const uid = inputUid(key, input)
  if (!uid || (await isLocalAccount(grpcClient, uid))) return output

  const cacheKey = `${key}:${JSON.stringify(input)}`
  let entry = cache.get(cacheKey)
  if (!entry || entry.expires <= Date.now()) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    entry = {expires: Date.now() + CACHE_TTL_MS, result: fetchUpstream(key, input)}
    cache.set(cacheKey, entry)
  }
  const upstream = await entry.result
  return (upstream ?? output) as T
}

/**
 * Fetches a file or image from the upstream node when the local daemon does not have the blob.
 * `pathAndQuery` is a path on the upstream node (e.g. `/ipfs/<cid>`). Returns
 * null when upstream reads are off or the upstream does not have it either.
 */
export async function fetchUpstreamFile(pathAndQuery: string, range?: string | null): Promise<Response | null> {
  if (!UPSTREAM_URL) return null
  try {
    const response = await fetch(`${UPSTREAM_URL}${pathAndQuery}`, {
      headers: range ? {Range: range} : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    return response.ok || response.status === 206 ? response : null
  } catch (error) {
    console.warn(
      `[upstream] ${pathAndQuery} from ${UPSTREAM_URL} failed:`,
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

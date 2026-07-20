// Resolve schema blobs by CID for the Onyx engine — the Onyx port of
// blob-schema-registry.ts's useSchemaRegistries. Much simpler than v1: Onyx
// name-refs resolve from the bundled ONYX_SCHEMAS, so there is no transitive
// $ref-by-CID closure to chase. Bundled CIDs resolve synchronously; only
// unbundled (user-published) schema blobs are fetched. Strictly advisory: an
// unfindable blob stays a neutral loading state, never throws.
import {useUniversalClient} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useQueries} from '@tanstack/react-query'
import {useRef} from 'react'
import {schemaForCid, type OnyxSchema} from './onyx-engine'

function asOnyxSchema(value: unknown): OnyxSchema | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as OnyxSchema) : undefined
}

function sameByCid(a: Record<string, OnyxSchema>, b: Record<string, OnyxSchema>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => a[key] === b[key])
}

/**
 * Resolve a set of schema CIDs to their Onyx schemas. `byCid` maps each CID to
 * its schema (bundled or fetched); referentially stable while unchanged so
 * consumers can memoize. Bundled CIDs never hit the network.
 */
export function useOnyxSchemaRegistry(cids: string[]): {
  byCid: Record<string, OnyxSchema>
  isLoading: boolean
  isComplete: boolean
} {
  const client = useUniversalClient()
  const unbundled = cids.filter((cid) => !schemaForCid(cid))

  const queries = useQueries({
    queries: unbundled.map((cid) => ({
      queryKey: [queryKeys.CID, cid],
      queryFn: async () => client.request('GetCID', {cid}),
      staleTime: Infinity,
      useErrorBoundary: false,
      retry: false,
      refetchInterval: (data: unknown) => (data === undefined ? 15_000 : false),
    })),
  })

  const byCidRef = useRef<Record<string, OnyxSchema>>({})
  const built: Record<string, OnyxSchema> = {}
  for (const cid of cids) {
    const bundled = schemaForCid(cid)
    if (bundled) built[cid] = bundled
  }
  queries.forEach((query, i) => {
    const schema = asOnyxSchema((query.data as {value?: unknown} | undefined)?.value)
    if (schema) built[unbundled[i]!] = schema
  })
  const byCid = sameByCid(byCidRef.current, built) ? byCidRef.current : built
  byCidRef.current = byCid

  const loaded = cids.filter((cid) => byCid[cid])
  return {
    byCid,
    isLoading: cids.length > 0 && loaded.length < cids.length && queries.some((query) => query.isLoading),
    isComplete: cids.length > 0 && loaded.length === cids.length,
  }
}

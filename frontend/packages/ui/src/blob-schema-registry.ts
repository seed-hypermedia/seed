import {useUniversalClient} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useQueries} from '@tanstack/react-query'
import {useEffect, useRef, useState} from 'react'
import {collectSchemaRefs, type BlobSchema, type SchemaRegistry} from './blob-schema'

function asSchemaBlob(value: unknown): BlobSchema | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as BlobSchema) : undefined
}

function sameRegistry(a: SchemaRegistry, b: SchemaRegistry): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  // Blobs are immutable and react-query keeps data references stable, so
  // same key set + same value references means the registry is unchanged.
  return aKeys.every((key) => a[key] === b[key])
}

/**
 * Fetch a set of schema blobs plus the transitive closure of their external
 * `$ref` / `targetSchema` links into a plain synchronous registry for the
 * validator.
 *
 * Discovery is iterative: loaded blobs reveal more ref CIDs, which are added
 * to the fetch set until the closure converges. Blobs are immutable, so every
 * query caches forever under the same key `useCID` uses. While anything is
 * still loading (or unfindable), `isComplete` stays false and validation
 * treats those refs as neutral — never as violations.
 *
 * The returned registry is referentially stable across renders while its
 * contents are unchanged, so consumers (BlobSchemaProvider) can memoize on it.
 * `seedCids` is keyed by content, so a fresh array per render is fine.
 */
export function useSchemaRegistries(seedCids: string[]): {
  registry: SchemaRegistry
  isLoading: boolean
  isComplete: boolean
} {
  const client = useUniversalClient()
  const seedsKey = seedCids.join('\n')
  const [cids, setCids] = useState<string[]>(seedCids)

  useEffect(() => {
    setCids(seedsKey ? seedsKey.split('\n') : [])
  }, [seedsKey])

  const queries = useQueries({
    queries: cids.map((cid) => ({
      queryKey: [queryKeys.CID, cid],
      queryFn: async () => client.request('GetCID', {cid}),
      staleTime: Infinity,
      // Schema fetching is strictly advisory: an unfindable schema or ref
      // must stay a neutral loading state forever, never throw to the page
      // error boundary (the app's QueryClient defaults useErrorBoundary to
      // true) — that would destroy the editor and any unpublished edits.
      useErrorBoundary: false,
      retry: false,
      // The daemon searches the network for up to 30s per attempt; keep
      // retrying periodically so late-discovered schema blobs appear.
      refetchInterval: (data: unknown) => (data === undefined ? 15_000 : false),
    })),
  })

  // useQueries returns a fresh array every render, so build the registry each
  // time but keep the previous object identity while nothing changed.
  const registryRef = useRef<SchemaRegistry>({})
  const built: SchemaRegistry = {}
  queries.forEach((query, i) => {
    const schema = asSchemaBlob((query.data as {value?: unknown} | undefined)?.value)
    if (schema) built[cids[i]!] = schema
  })
  const registry = sameRegistry(registryRef.current, built) ? registryRef.current : built
  registryRef.current = registry

  const seeds = seedsKey ? seedsKey.split('\n') : []
  const loadedSeeds = seeds.filter((cid) => registry[cid])
  const missing = new Set<string>(seeds.filter((cid) => !registry[cid]))
  for (const cid of loadedSeeds) {
    for (const ref of collectSchemaRefs(registry[cid]!, registry)) {
      if (!registry[ref]) missing.add(ref)
    }
  }

  // Fold newly-discovered refs into the fetch set until the closure
  // converges. Keyed on the content of BOTH lists: after a seed switch
  // shrinks `cids`, the same still-missing ref must be re-added even though
  // `missing` itself didn't change.
  const missingKey = Array.from(missing).join('\n')
  const cidsKey = cids.join('\n')
  useEffect(() => {
    if (!missingKey) return
    setCids((prev) => {
      const next = missingKey.split('\n').filter((cid) => !prev.includes(cid))
      return next.length > 0 ? [...prev, ...next] : prev
    })
  }, [missingKey, cidsKey])

  return {
    registry,
    isLoading: seeds.length > 0 && loadedSeeds.length < seeds.length && queries.some((query) => query.isLoading),
    isComplete: seeds.length > 0 && loadedSeeds.length === seeds.length && missing.size === 0,
  }
}

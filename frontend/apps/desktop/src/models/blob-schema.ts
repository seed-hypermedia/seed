import {useUniversalClient} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'
import {collectSchemaRefs, type BlobSchema, type SchemaRegistry} from '@shm/ui/blob-schema'
import {useQueries} from '@tanstack/react-query'
import {useEffect, useRef, useState} from 'react'

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
 * Fetch a schema blob plus the transitive closure of its external `$ref` /
 * `targetSchema` links into a plain synchronous registry for the validator.
 *
 * Discovery is iterative: loaded blobs reveal more ref CIDs, which are added
 * to the fetch set until the closure converges. Blobs are immutable, so every
 * query caches forever under the same key `useCID` uses. While any ref is
 * still loading (or unfindable), `isComplete` stays false and validation
 * treats those refs as neutral — never as violations.
 *
 * The returned registry is referentially stable across renders while its
 * contents are unchanged, so consumers (BlobSchemaProvider) can memoize on it.
 */
export function useSchemaRegistry(schemaCid: string | undefined): {
  rootSchema: BlobSchema | undefined
  registry: SchemaRegistry
  isLoading: boolean
  isComplete: boolean
} {
  const client = useUniversalClient()
  const [cids, setCids] = useState<string[]>(schemaCid ? [schemaCid] : [])

  useEffect(() => {
    setCids(schemaCid ? [schemaCid] : [])
  }, [schemaCid])

  const queries = useQueries({
    queries: cids.map((cid) => ({
      queryKey: [queryKeys.CID, cid],
      queryFn: async () => client.request('GetCID', {cid}),
      staleTime: Infinity,
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

  const rootSchema = schemaCid ? registry[schemaCid] : undefined
  const missing = rootSchema ? collectSchemaRefs(rootSchema, registry).filter((cid) => !registry[cid]) : []

  // Fold newly-discovered refs into the fetch set until the closure converges.
  const missingKey = missing.join('\n')
  useEffect(() => {
    if (!missingKey) return
    setCids((prev) => {
      const next = missingKey.split('\n').filter((cid) => !prev.includes(cid))
      return next.length > 0 ? [...prev, ...next] : prev
    })
  }, [missingKey])

  return {
    rootSchema,
    registry,
    isLoading: !!schemaCid && !rootSchema && queries.some((query) => query.isLoading),
    isComplete: !!rootSchema && missing.length === 0,
  }
}

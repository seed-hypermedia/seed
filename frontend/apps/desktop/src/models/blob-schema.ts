import {useUniversalClient} from '@shm/shared'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useQueries} from '@tanstack/react-query'
import {collectSchemaRefs, type BlobSchema, type SchemaRegistry} from '@shm/ui/blob-schema'
import {useEffect, useMemo, useState} from 'react'

function asSchemaBlob(value: unknown): BlobSchema | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as BlobSchema) : undefined
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

  const {registry, rootSchema, missing} = useMemo(() => {
    const registry: SchemaRegistry = {}
    queries.forEach((query, i) => {
      const schema = asSchemaBlob((query.data as {value?: unknown} | undefined)?.value)
      if (schema) registry[cids[i]] = schema
    })
    const rootSchema = schemaCid ? registry[schemaCid] : undefined
    const missing = rootSchema ? collectSchemaRefs(rootSchema, registry).filter((cid) => !registry[cid]) : []
    return {registry, rootSchema, missing}
  }, [queries, cids, schemaCid])

  // Fold newly-discovered refs into the fetch set until the closure converges.
  useEffect(() => {
    const next = missing.filter((cid) => !cids.includes(cid))
    if (next.length > 0) setCids((prev) => [...prev, ...next])
  }, [missing, cids])

  return {
    rootSchema,
    registry,
    isLoading: !!schemaCid && !rootSchema && queries.some((query) => query.isLoading),
    isComplete: !!rootSchema && missing.length === 0,
  }
}

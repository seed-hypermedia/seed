import {useResources} from '@shm/shared/models/entity'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useMemo} from 'react'
import type {BlobSchema} from './blob-schema'
import {useSchemaRegistries} from './blob-schema-registry'
import {getSchemaDefinitionCid} from './schema-document'

/**
 * Pure helper: map document resources to the schema-blob CID each one names
 * (from its `schemaDefinition = ipfs://<cid>` metadata), keyed by hm:// URL.
 * Documents whose metadata does not reference a schema blob are skipped.
 */
export function schemaCidsFromResources(entries: Array<{url: string; metadata: unknown}>): Record<string, string> {
  const cids: Record<string, string> = {}
  for (const {url, metadata} of entries) {
    const cid = getSchemaDefinitionCid(metadata)
    if (cid) cids[url] = cid
  }
  return cids
}

/**
 * Resolve a set of hm:// schema-document URLs to their schema definitions in
 * two hops: hm:// URL → the document's `schemaDefinition` (an `ipfs://<cid>`
 * reference) → the schema blob fetched by CID (via `useSchemaRegistries`, which
 * also pulls the transitive `$ref` closure).
 *
 * Unparseable URLs and non-schema documents are skipped, so the registry only
 * contains real schemas, keyed by the original hm:// URL. `isComplete` is true
 * once every document has settled AND its schema blob has resolved.
 */
export function useSchemaDocuments(hmUrls: string[]): {
  registry: Record<string, BlobSchema>
  isLoading: boolean
  isComplete: boolean
} {
  const urlsKey = hmUrls.join('\n')

  // Parse urls to ids, keeping only parseable ones and their originating url.
  const parsed = useMemo(() => {
    const urls = urlsKey ? urlsKey.split('\n') : []
    const items = urls
      .map((url) => ({url, id: unpackHmId(url)}))
      .filter((item): item is {url: string; id: NonNullable<typeof item.id>} => !!item.id)
    return {urls: items.map((item) => item.url), ids: items.map((item) => item.id)}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey])

  const results = useResources(parsed.ids)
  const docsLoading = results.some((result) => result.isLoading)
  const docsSettled = parsed.ids.length > 0 && results.every((result) => !result.isLoading)

  // hm:// URL → schema blob CID (from the resolved document metadata).
  const cidByUrl = schemaCidsFromResources(
    parsed.urls.map((url, i) => {
      const data = results[i]?.data
      return {url, metadata: data && data.type === 'document' ? data.document.metadata : undefined}
    }),
  )

  // Second hop: fetch the schema blobs (+ transitive $ref closure) by CID.
  const {registry: cidRegistry, isLoading: cidLoading, isComplete: cidComplete} = useSchemaRegistries(
    Object.values(cidByUrl),
  )

  // Re-key the CID registry by the original hm:// URL. Memoized on a content
  // signature so identity is stable while the resolved definitions are unchanged.
  const signature = JSON.stringify(
    Object.fromEntries(Object.entries(cidByUrl).map(([url, cid]) => [url, cidRegistry[cid] ?? null])),
  )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const registry = useMemo(() => {
    const out: Record<string, BlobSchema> = {}
    for (const [url, cid] of Object.entries(cidByUrl)) {
      const def = cidRegistry[cid]
      if (def) out[url] = def
    }
    return out
  }, [signature])

  return {
    registry,
    isLoading: docsLoading || cidLoading,
    isComplete: docsSettled && cidComplete,
  }
}

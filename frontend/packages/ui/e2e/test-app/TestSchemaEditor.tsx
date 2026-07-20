import * as cbor from '@ipld/dag-cbor'
import {UniversalAppProvider} from '@shm/shared/routing'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useEffect, useRef, useState} from 'react'
// ui-internal modules imported relative to source: the @shm/ui exports map only
// resolves *.tsx, so `@shm/ui/onyx/onyx-engine` (a .ts) would fail as a bare
// specifier. Relative imports sidestep that and keep all three consistent.
import {DocumentMetadataView, type MetadataPatch} from '../../src/document-metadata-view'
import {schemaCid} from '../../src/onyx/onyx-engine'
import {TooltipProvider} from '../../src/tooltip'

/**
 * E2E harness for the Onyx schema editor UI. Mounts the REAL
 * DocumentMetadataView (which owns the add-field form, the schemaDefinition
 * row, and the SchemaEditorDialog) with a local metadata state and a mock
 * universal client so publishing/CID-resolution work without a daemon.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Merge a staged patch into the metadata. `null` values are tombstones and
 * delete their key (top-level and nested). This mirrors the desktop draft
 * merge the real DocumentMetadataView publishes against.
 */
function applyPatch(meta: Record<string, unknown>, patch: MetadataPatch): Record<string, unknown> {
  const next: Record<string, unknown> = {...meta}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key]
    } else if (isPlainObject(value)) {
      next[key] = isPlainObject(next[key]) ? applyPatch(next[key] as Record<string, unknown>, value) : stripNulls(value)
    } else {
      next[key] = value
    }
  }
  return next
}

/** Deep-remove null tombstones from a fresh object value. */
function stripNulls(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    if (v === null) continue
    out[key] = isPlainObject(v) ? stripNulls(v) : v
  }
  return out
}

// A mock universal client: the editor computes blob CIDs client-side, so
// PublishBlobs just echoes them back. GetCID is only hit for UNBUNDLED schema
// CIDs (bundled ones resolve synchronously) — return an empty result so the
// registry stays in a neutral loading state rather than throwing.
const mockUniversalClient = {
  request: async (method: string, params: any) => {
    if (method === 'PublishBlobs') {
      // Decode each published DAG-CBOR blob back to its object form and stash it
      // so tests can assert exactly what the editor published (schema shape,
      // required array, field kinds). Struct schemas carry no bytes/link
      // envelopes, so cbor.decode round-trips them to the plain object.
      for (const blob of params?.blobs ?? []) {
        try {
          const decoded = cbor.decode(blob.data)
          window.__publishedSchemas = [...(window.__publishedSchemas ?? []), decoded]
          window.__lastPublishedSchema = decoded
        } catch {
          // non-schema blob; ignore
        }
      }
      return {cids: (params?.blobs ?? []).map((b: {cid: string}) => b.cid)}
    }
    if (method === 'GetCID') {
      return {value: null}
    }
    if (method === 'Search') {
      return {entities: []}
    }
    return {}
  },
  publish: async () => ({cids: []}),
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
    },
  },
})

declare global {
  interface Window {
    __initialMeta?: Record<string, unknown>
    __meta: () => Record<string, unknown>
    __setMeta: (meta: Record<string, unknown>) => void
    __schemaCid: (nameOrUrl: string) => string | undefined
    __lastPublishedSchema?: unknown
    __publishedSchemas?: unknown[]
  }
}

export function TestSchemaEditor() {
  const [meta, setMeta] = useState<Record<string, unknown>>(() => window.__initialMeta ?? {name: 'Foo'})

  // Re-expose the live metadata (and a setter) on every render so tests always
  // read the freshest staged state.
  const metaRef = useRef(meta)
  metaRef.current = meta
  useEffect(() => {
    window.__meta = () => metaRef.current
    window.__setMeta = (next) => setMeta(next)
    window.__schemaCid = (nameOrUrl) => schemaCid(nameOrUrl)
  })

  return (
    <TooltipProvider>
      <QueryClientProvider client={queryClient}>
        <UniversalAppProvider
          universalClient={mockUniversalClient as any}
          openUrl={(url?: string, newWindow?: boolean) => {
            console.log('openUrl', {url, newWindow})
          }}
          openRoute={(...args: any[]) => {
            console.log('openRoute', args)
          }}
        >
          <div className="test-harness" data-testid="schema-editor-harness">
            <DocumentMetadataView
              metadata={meta}
              canEdit
              onMetadata={(patch) => setMeta((m) => applyPatch(m, patch))}
            />
          </div>
        </UniversalAppProvider>
      </QueryClientProvider>
    </TooltipProvider>
  )
}

import {Struct, Timestamp} from '@bufbuild/protobuf'
import * as cbor from '@ipld/dag-cbor'
import {DocumentInfo, type DocumentFilter, type QueryDocumentsRequest} from '@shm/shared/client/grpc-types'
import {UniversalAppProvider} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {useEffect, useRef, useState} from 'react'
// ui-internal modules imported relative to source: the @shm/ui exports map only
// resolves *.tsx, so `@shm/ui/schema/engine` (a .ts) would fail as a bare
// specifier. Relative imports sidestep that and keep all three consistent.
import {DocumentMetadataView, type MetadataPatch} from '../../src/document-metadata-view'
import {schemaCid} from '../../src/schema/engine'
import {useEffectiveDocSchema} from '../../src/schema/schema-resolve'
import {TooltipProvider} from '../../src/tooltip'

/**
 * E2E harness for the Hypermedia schema editor UI. Mounts the REAL
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

// A small world for typed-reference tests: a folder of places typed through its
// childAttributesSchema (so The Shire is a Place without a binding of its own), a place
// with its own binding, and a faction — what a Character's `home` field (target: Place)
// must offer and must warn about, respectively.
export const WORLD_UID = 'z6MkWorldFixture'
const LIBRARY = 'hm://hyper.media'
type FixtureDoc = {path: string[]; metadata: Record<string, unknown>}
// Two type pages of the world's own: Mammal EXTENDS Animal by document URL, so resolving a
// mammal's fields needs the animal page fetched too (the registry hydration the app does).
const ANIMAL_CID = 'bafyreigkxnvamoxiyp2qvcn7qazdppwnt2mdnbojuehthjrk7yfpuhnmjq'
const MAMMAL_CID = 'bafyreidedtokl6mruxplo3w6hgqmluuubnfgmz43c5zq7oqehysi5wo5ea'
const worldBlobs: Record<string, unknown> = {
  [ANIMAL_CID]: {
    type: `${LIBRARY}/struct`,
    properties: {
      diet: {value: {anyOf: ['herbivore', 'carnivore', 'omnivore']}, required: true},
      habitat: {value: {type: `${LIBRARY}/string`}, required: true},
    },
  },
  [MAMMAL_CID]: {
    type: `hm://${WORLD_UID}/types/animal`,
    properties: {
      hasFur: {value: {type: `${LIBRARY}/boolean`}, required: true},
      gestationDays: {value: {type: `${LIBRARY}/integer`, minimum: 0}},
    },
  },
}
const worldDocs: FixtureDoc[] = [
  {path: ['types', 'animal'], metadata: {name: 'Animal', schemaDefinition: `ipfs://${ANIMAL_CID}`}},
  {path: ['types', 'mammal'], metadata: {name: 'Mammal', schemaDefinition: `ipfs://${MAMMAL_CID}`}},
  {path: ['places'], metadata: {name: 'Places', childAttributesSchema: `${LIBRARY}/example/place-doc`}},
  {path: ['places', 'shire'], metadata: {name: 'The Shire'}},
  {path: ['places', 'mordor'], metadata: {name: 'Mordor', attributesSchema: `${LIBRARY}/example/place-doc`}},
  {
    path: ['factions', 'fellowship'],
    metadata: {name: 'The Fellowship', attributesSchema: `${LIBRARY}/example/faction-doc`},
  },
]
const samePath = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i])
const findDoc = (path: string[]) => worldDocs.find((doc) => samePath(doc.path, path))
/** The daemon's effective-schema rule: own attributesSchema, else the parent's childAttributesSchema. */
const effectiveSchema = (doc: FixtureDoc): string | undefined => {
  const own = doc.metadata.attributesSchema
  if (typeof own === 'string') return own
  const parent = findDoc(doc.path.slice(0, -1))
  const inherited = parent?.metadata.childAttributesSchema
  return typeof inherited === 'string' ? inherited : undefined
}
/** Evaluate the subset of DocumentFilter the typed-document search and schema-page listing use. */
function matchesFilter(doc: FixtureDoc, filter: DocumentFilter | undefined): boolean {
  if (!filter) return true
  const f = filter.filter
  switch (f.case) {
    case 'and':
      return f.value.filters.every((child) => matchesFilter(doc, child))
    case 'or':
      return f.value.filters.some((child) => matchesFilter(doc, child))
    case 'not':
      return !matchesFilter(doc, f.value.filter)
    case 'exists':
      return f.value.key === 'attributesSchema' ? !!effectiveSchema(doc) : doc.metadata[f.value.key] != null
    case 'comparison': {
      const actual = f.value.key === 'attributesSchema' ? effectiveSchema(doc) : doc.metadata[f.value.key]
      const expected = f.value.value?.value.case === 'stringValue' ? f.value.value.value.value : undefined
      return actual === expected
    }
    case 'stringMatch': {
      const actual = doc.metadata[f.value.key]
      return typeof actual === 'string' && actual.toLowerCase().includes(f.value.value.toLowerCase())
    }
    default:
      return false
  }
}
const now = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'))
const toDocumentInfo = (doc: FixtureDoc) =>
  new DocumentInfo({
    account: WORLD_UID,
    path: `/${doc.path.join('/')}`,
    metadata: Struct.fromJson(doc.metadata as any),
    authors: [WORLD_UID],
    createTime: now,
    updateTime: now,
    genesis: 'bafyfixturegenesis',
    version: 'bafyfixtureversion',
    activitySummary: {latestChangeTime: now, latestCommentId: '', commentCount: 0, isUnread: false},
    generationInfo: {genesis: 'bafyfixturegenesis', generation: 1n},
  })
const toResource = (doc: FixtureDoc) => ({
  type: 'document',
  id: hmId(WORLD_UID, {path: doc.path}),
  document: {
    account: WORLD_UID,
    path: `/${doc.path.join('/')}`,
    authors: [WORLD_UID],
    metadata: doc.metadata,
    genesis: 'bafyfixturegenesis',
    version: 'bafyfixtureversion',
    visibility: 'PUBLIC',
  },
})

// A mock universal client: the editor computes blob CIDs client-side, so
// PublishBlobs just echoes them back. GetCID is only hit for UNBUNDLED schema
// CIDs (bundled ones resolve synchronously) — return an empty result so the
// registry stays in a neutral loading state rather than throwing.
const mockUniversalClient = {
  queryDocuments: async (request: QueryDocumentsRequest) => ({
    documents: worldDocs.filter((doc) => matchesFilter(doc, request.filter)).map(toDocumentInfo),
    nextPageToken: '',
  }),
  request: async (method: string, params: any) => {
    if (method === 'Resource') {
      const doc = params?.uid === WORLD_UID ? findDoc(params.path ?? []) : undefined
      return doc ? toResource(doc) : {type: 'not-found', id: params}
    }
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
      return {value: worldBlobs[params?.cid] ?? null}
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
    __openedUrl?: string
  }
}

/** Inner editor — inside the providers so it can resolve the conformance schema
 * (from `metadata.attributesSchema`) exactly like the real app does. */
function MetadataEditor({
  meta,
  onMetadata,
}: {
  meta: Record<string, unknown>
  onMetadata: (patch: MetadataPatch) => void
}) {
  const {metadataSchema: conformanceSchema, registry} = useEffectiveDocSchema(undefined, meta)
  return (
    <DocumentMetadataView
      metadata={meta}
      canEdit
      conformanceSchema={conformanceSchema}
      conformanceRegistry={registry}
      onMetadata={onMetadata}
      // A mock uploader so ipfs-typed fields show their file-picker affordance.
      fileUpload={async () => 'bafyreietestuploadcidxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
      // Record navigations so a test can assert an HM-link pill is clickable.
      openUrl={(url) => {
        window.__openedUrl = url
      }}
    />
  )
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
            <MetadataEditor meta={meta} onMetadata={(patch) => setMeta((m) => applyPatch(m, patch))} />
          </div>
        </UniversalAppProvider>
      </QueryClientProvider>
    </TooltipProvider>
  )
}

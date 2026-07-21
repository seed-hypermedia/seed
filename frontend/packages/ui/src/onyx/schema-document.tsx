// The schema-document header actions: when a document carries a
// `schemaDefinition` metadata field (an ipfs://<cid> pointing at a schema
// blob), it "describes a type." This surfaces two header buttons:
//   - "Schema"  → a dialog rendering that Onyx schema (browse it, follow refs).
//   - "Create"  → a dialog with a schema-respecting editor to build and publish
//                 a value of that type (e.g. create an employee on the employee
//                 document).
// Resolves the schema from the bundled Onyx registry by CID (no fetch needed for
// the tour's schemas); documents pointing at an unbundled schema simply show no
// actions for now.
import * as cbor from '@ipld/dag-cbor'
import {FileCode2, Plus} from 'lucide-react'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {useState} from 'react'
import {useUniversalClient} from '@shm/shared'
import {Button} from '../button'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '../components/dialog'
import {dagJsonToIpld} from '../dag-json'
import {toast} from '../toast'
import {Tooltip} from '../tooltip'
import {OnyxDataEditor, seedValue} from './onyx-data-editor'
import {nameForCid, schemaForCid, validate} from './onyx-engine'
import {OnyxSchemaPage} from './onyx-explorer'
import {OnyxSchemaEditor} from './onyx-schema-editor'
import {useOnyxSchemaRegistry} from './onyx-schema-registry-cid'

const DAG_CBOR_CODE = 0x71
/** The metadata field naming the schema THIS document conforms to. */
export const SCHEMA_KEY = 'schema'
/** The metadata field naming the schema this document's CHILDREN must conform to. */
export const CHILDREN_SCHEMA_KEY = 'childrenSchema'
/** The metadata field pointing at a schema blob this document DEFINES. */
export const SCHEMA_DEFINITION_KEY = 'schemaDefinition'

/**
 * Metadata keys that are NOT ordinary content fields: the standard header fields
 * and the three schema-binding fields. Excluded from schema-required rows and
 * add-field suggestions (they're authored via the header / dedicated UI).
 */
export const RESERVED_METADATA_KEYS = new Set<string>([
  'name',
  'summary',
  SCHEMA_KEY,
  CHILDREN_SCHEMA_KEY,
  SCHEMA_DEFINITION_KEY,
])

/** The bare schema CID a document points at via its `schemaDefinition` metadata, or null. */
export function schemaDefinitionCid(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = (metadata as Record<string, unknown>)[SCHEMA_DEFINITION_KEY]
  if (typeof raw !== 'string') return null
  const cid = raw.replace(/^ipfs:\/\//i, '').split('/')[0] ?? ''
  return cid || null
}

/** True when this document describes a type (carries a resolvable schemaDefinition). */
export function isSchemaDocument(metadata: unknown): boolean {
  const cid = schemaDefinitionCid(metadata)
  return !!cid && !!schemaForCid(cid)
}

/** Build + publish a value of a schema — the "Create an instance" flow. */
function CreateInstance({schema, typeName}: {schema: Record<string, any>; typeName: string}) {
  const client = useUniversalClient()
  const [value, setValue] = useState<unknown>(() => seedValue(schema))
  const [publishing, setPublishing] = useState(false)
  const [publishedCid, setPublishedCid] = useState<string | null>(null)
  const errors = validate(schema, value)

  const publish = async () => {
    setPublishing(true)
    try {
      const data = cbor.encode(dagJsonToIpld(value) as any)
      const digest = await sha256.digest(data)
      const cid = CID.createV1(DAG_CBOR_CODE, digest).toString()
      await client.request('PublishBlobs', {blobs: [{cid, data}]})
      setPublishedCid(cid)
      toast.success(`Published a new ${typeName}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to publish')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Fill in a <span className="font-medium">{typeName}</span>. The form follows the schema; every field is validated
        live. Publish mints a content-addressed blob you can reference.
      </p>
      <OnyxDataEditor schema={schema} value={value} onValue={setValue} />
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span className={errors.length ? 'text-destructive text-sm' : 'text-sm text-green-600'}>
          {errors.length ? `${errors.length} issue${errors.length > 1 ? 's' : ''} to resolve` : '✓ valid'}
        </span>
        <Button size="sm" onClick={publish} disabled={publishing || errors.length > 0}>
          {publishing ? 'Publishing…' : 'Publish'}
        </Button>
      </div>
      {publishedCid && (
        <div className="rounded-md border border-green-500/40 bg-green-500/5 p-2 font-mono text-xs">
          Published: ipfs://{publishedCid}
        </div>
      )}
    </div>
  )
}

/**
 * Header actions for a document that DEFINES a type (has a `schemaDefinition`):
 *   - a tag-style link that opens the schema (browse its shape),
 *   - a "Create" button that opens a schema-defined value editor and publishes
 *     the result as a new content-addressed IPFS blob.
 * Resolves the schema from the `schemaDefinition` CID via the registry, so it
 * works for both bundled and user-published schemas. Renders nothing until the
 * schema resolves.
 */
export function SchemaDocumentHeaderActions({metadata}: {metadata: unknown}) {
  const cid = schemaDefinitionCid(metadata)
  const {byCid} = useOnyxSchemaRegistry(cid ? [cid] : [])
  const bundledName = cid ? nameForCid(cid) : undefined
  const schema = cid ? byCid[cid] : undefined
  const [viewOpen, setViewOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [viewSlug, setViewSlug] = useState<string | undefined>(bundledName)
  if (!cid) return null
  const typeName = (typeof schema?.name === 'string' && schema.name) || bundledName || 'Schema'
  const isInstantiable = !!schema && !schema.anyOf // a union has no single seed shape

  return (
    <div className="flex items-center gap-1.5">
      {/* Tag-style link: opens the schema. */}
      <Tooltip content="Open the schema this document defines">
        <button
          type="button"
          className="border-border bg-muted/40 hover:bg-muted text-foreground inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
          onClick={() => {
            setViewSlug(bundledName)
            setViewOpen(true)
          }}
        >
          <FileCode2 className="size-3.5" />
          {typeName}
        </button>
      </Tooltip>
      {isInstantiable && (
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-4" /> Create
        </Button>
      )}

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{typeName} — schema</DialogTitle>
          </DialogHeader>
          {viewSlug ? (
            <OnyxSchemaPage slug={viewSlug} nav={setViewSlug} />
          ) : schema ? (
            // A published (non-bundled) schema: show its shape with the struct editor,
            // read-only (edits don't persist — authoring lives on the Attributes tab).
            <OnyxSchemaEditor schema={schema} onSchema={() => {}} />
          ) : (
            <p className="text-muted-foreground text-sm">Loading schema…</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create {typeName}</DialogTitle>
          </DialogHeader>
          {schema && <CreateInstance schema={schema} typeName={typeName} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

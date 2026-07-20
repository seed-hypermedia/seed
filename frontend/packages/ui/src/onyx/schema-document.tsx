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
import {OnyxDataEditor, seedValue} from './onyx-data-editor'
import {nameForCid, ONYX_SCHEMAS, schemaForCid, validate} from './onyx-engine'
import {OnyxSchemaPage} from './onyx-explorer'

const DAG_CBOR_CODE = 0x71
export const SCHEMA_DEFINITION_KEY = 'schemaDefinition'

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
 * Inline "define a new type" flow for the metadata editor: when a user adds a
 * metadata field named `schemaDefinition`, this authoring panel appears — build
 * a schema with the meta-schema-driven editor, publish it, and attach it (its
 * ipfs://<cid> becomes the document's `schemaDefinition`, so the document now
 * describes that type).
 */
export function SchemaDefinitionBuilder({onAttach, onCancel}: {onAttach: (cid: string) => void; onCancel: () => void}) {
  const client = useUniversalClient()
  const metaSchema = ONYX_SCHEMAS['onyx-schema']
  const [value, setValue] = useState<unknown>(() => seedValue(metaSchema))
  const [publishing, setPublishing] = useState(false)
  const errors = validate(metaSchema, value)

  const publish = async () => {
    setPublishing(true)
    try {
      const data = cbor.encode(dagJsonToIpld(value) as any)
      const digest = await sha256.digest(data)
      const cid = CID.createV1(DAG_CBOR_CODE, digest).toString()
      await client.request('PublishBlobs', {blobs: [{cid, data}]})
      toast.success('Schema published and attached')
      onAttach(cid)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to publish schema')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="border-primary/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="text-sm font-semibold">Define a new type</div>
      <p className="text-muted-foreground text-xs">
        You're adding <code className="bg-muted rounded px-1">schemaDefinition</code> — build a schema below. Publishing
        attaches it to this document, so this document then <em>describes</em> that type (and gains Schema / Create
        actions in its header).
      </p>
      <OnyxDataEditor schema={metaSchema} value={value} onValue={setValue} />
      <div className="flex items-center justify-between border-t pt-2">
        <span className={errors.length ? 'text-destructive text-xs' : 'text-xs text-green-600'}>
          {errors.length
            ? `${errors.length} issue${errors.length > 1 ? 's' : ''} — not yet a valid schema`
            : '✓ valid schema'}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={publish} disabled={publishing || errors.length > 0}>
            {publishing ? 'Publishing…' : 'Publish & attach'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Header actions for a document that describes a type. Renders nothing otherwise. */
export function SchemaDocumentHeaderActions({metadata}: {metadata: unknown}) {
  const cid = schemaDefinitionCid(metadata)
  const name = cid ? nameForCid(cid) : undefined
  const schema = cid ? schemaForCid(cid) : undefined
  const [viewOpen, setViewOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [viewSlug, setViewSlug] = useState<string | undefined>(name)
  if (!cid || !name || !schema) return null
  const isInstantiable = !ONYX_SCHEMAS[name]?.anyOf // a union has no single seed shape

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setViewSlug(name)
          setViewOpen(true)
        }}
      >
        <FileCode2 className="mr-1 size-4" /> Schema
      </Button>
      {isInstantiable && (
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-4" /> Create
        </Button>
      )}

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Schema</DialogTitle>
          </DialogHeader>
          {viewSlug && <OnyxSchemaPage slug={viewSlug} nav={setViewSlug} />}
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create {schema.name || name}</DialogTitle>
          </DialogHeader>
          <CreateInstance schema={schema} typeName={schema.name || name} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Schema-document affordances: when a document carries a `schemaDefinition`
// metadata field (an ipfs://<cid> pointing at a schema blob), it "describes a
// type." The Schema tool tab is the way in (see DocumentTools); this module
// carries the options-menu rows (useSchemaMenuItems) and the toolbar "Create"
// button (SchemaDocumentHeaderActions), which builds and publishes a value of
// the type through a schema-respecting editor.
import * as cbor from '@ipld/dag-cbor'
import {Layers, Plus, SearchCode} from 'lucide-react'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {useMemo, useState} from 'react'
import {useUniversalClient} from '@shm/shared'
import {useNavigate} from '@shm/shared/utils/navigation'
import {Button} from '../button'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '../components/dialog'
import {dagJsonToIpld} from '../dag-json'
import type {MenuItemType} from '../options-dropdown'
import {toast} from '../toast'
import {extendSchemaRoute, newInstanceRoute} from './blob-menu-items'
import {OnyxDataEditor, seedValue} from './onyx-data-editor'
import {nameForCid, schemaForCid, validate} from './onyx-engine'
import {useOnyxSchemaRegistry} from './onyx-schema-registry-cid'
import {isSignedBlobSchema} from './signed-blob'
import {SignedBlobCreator} from './signed-blob-creator'

const DAG_CBOR_CODE = 0x71
/** The metadata field naming the schema THIS document conforms to. */
export const SCHEMA_KEY = 'schema'
/** The metadata field naming the schema this document's CHILDREN must conform to. */
export const CHILDREN_SCHEMA_KEY = 'childrenSchema'
/** The metadata field pointing at a schema blob this document DEFINES. */
export const SCHEMA_DEFINITION_KEY = 'schemaDefinition'
/** The WORKING schema object a draft carries while being authored; frozen into a blob at publish. */
export const SCHEMA_DRAFT_KEY = 'schemaDraft'

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
  SCHEMA_DRAFT_KEY,
])

/** The draft's working schema object, when the metadata carries one. */
export function schemaDraftValue(metadata: unknown): Record<string, any> | null {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = (metadata as Record<string, unknown>)[SCHEMA_DRAFT_KEY]
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : null
}

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
 * The schema actions for a document that DEFINES a type, as rows for the document's
 * REGULAR options menu: New <Type>, Extend Schema, and Inspect Schema (the raw
 * IPFS blob in the inspector). The generic "New Schema" lives in the account
 * dropdown's dev section. Empty for every other document, so the menu shows
 * nothing schema-ish unless a schema is actually set.
 */
export function useSchemaMenuItems(
  metadata: unknown,
  options?: {
    /** Platform override for Extend Schema — e.g. the desktop dialog that creates an extending
     * document draft. Without it, extend falls back to the raw blob-draft flow. */
    onExtendSchema?: (baseSchemaCid: string) => void
  },
): MenuItemType[] {
  const navigate = useNavigate()
  const onExtendSchema = options?.onExtendSchema
  const cid = schemaDefinitionCid(metadata)
  const bundledName = cid ? nameForCid(cid) : undefined
  const {byCid} = useOnyxSchemaRegistry(cid && !bundledName ? [cid] : [])
  const schema = !cid ? undefined : bundledName ? schemaForCid(cid) : byCid[cid]
  return useMemo(() => {
    if (!cid) return []
    // The defining document's name is the type's canonical name; the schema blob no longer
    // carries one of its own (the blob's `name`, when present, is a legacy fallback).
    const docName =
      metadata && typeof metadata === 'object' && typeof (metadata as Record<string, unknown>).name === 'string'
        ? ((metadata as Record<string, unknown>).name as string)
        : undefined
    const typeName = docName || bundledName || 'Instance'
    const canCreate = !!schema && !schema.anyOf && !schema.$type
    return [
      ...(canCreate
        ? [
            {
              key: 'schema-new-instance',
              label: `New ${typeName}`,
              icon: <Plus className="size-4" />,
              onClick: () => navigate(newInstanceRoute(cid)),
            },
            {
              key: 'schema-extend',
              label: 'Extend Schema',
              icon: <Layers className="size-4" />,
              onClick: () => (onExtendSchema ? onExtendSchema(cid) : navigate(extendSchemaRoute(cid))),
            },
          ]
        : []),
      {
        key: 'schema-inspect',
        label: 'Inspect Schema',
        icon: <SearchCode className="size-4" />,
        onClick: () => navigate({key: 'inspect-ipfs', ipfsPath: cid}),
      },
    ]
  }, [cid, schema, bundledName, metadata, navigate, onExtendSchema])
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
  const [createOpen, setCreateOpen] = useState(false)
  if (!cid) return null
  const typeName = bundledName || 'Schema'
  const isInstantiable = !!schema && !schema.anyOf // a union has no single seed shape

  return (
    <div className="flex items-center gap-1.5">
      {isInstantiable && (
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 size-4" /> Create
        </Button>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create {typeName}</DialogTitle>
          </DialogHeader>
          {schema &&
            (isSignedBlobSchema(schema) ? (
              <SignedBlobCreator schema={schema} typeName={typeName} />
            ) : (
              <CreateInstance schema={schema} typeName={typeName} />
            ))}
        </DialogContent>
      </Dialog>
    </div>
  )
}

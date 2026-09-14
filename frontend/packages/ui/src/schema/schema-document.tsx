// Schema-document affordances: when a document carries a `schemaDefinition`
// metadata field (an ipfs://<cid> pointing at a schema blob), it "describes a
// type" — a struct of attributes. The Schema tool tab is the way in (see
// DocumentTools); this module carries the options-menu rows (useSchemaMenuItems)
// and the toolbar buttons (SchemaDocumentHeaderActions). The actions a schema
// page offers, in order of prominence: a new document whose `attributesSchema` is
// this page, a new collection whose `childAttributesSchema` is this page, an
// extension of the schema, and — for developers — a raw value of the type
// published as a bare IPFS blob.
import * as cbor from '@ipld/dag-cbor'
import {Braces, FolderPlus, Layers, Plus, SearchCode} from 'lucide-react'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {useMemo, useState} from 'react'
import {useUniversalClient, type UniversalClient} from '@shm/shared'
import {useNavigate} from '@shm/shared/utils/navigation'
import {Button} from '../button'
import {Tooltip} from '../tooltip'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '../components/dialog'
import {dagJsonToIpld} from '../dag-json'
import type {MenuItemType} from '../options-dropdown'
import {toast} from '../toast'
import {extendSchemaRoute, newInstanceRoute} from './blob-menu-items'
import {SchemaDataEditor, seedValue} from './data-editor'
import {nameForCid, schemaForCid, validate} from './engine'
import {useSchemaRegistry} from './schema-registry-cid'
import {isSignedBlobSchema} from './signed-blob'
import {SignedBlobCreator} from './signed-blob-creator'

const DAG_CBOR_CODE = 0x71
/** The metadata field naming the attributes schema THIS document conforms to. */
export const ATTRIBUTES_SCHEMA_KEY = 'attributesSchema'
/** The metadata field naming the attributes schema this document's CHILDREN conform to. */
export const CHILD_ATTRIBUTES_SCHEMA_KEY = 'childAttributesSchema'
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
  ATTRIBUTES_SCHEMA_KEY,
  CHILD_ATTRIBUTES_SCHEMA_KEY,
  SCHEMA_DEFINITION_KEY,
  SCHEMA_DRAFT_KEY,
])

/** The draft's working schema object, when the metadata carries one. */
export function schemaDraftValue(metadata: unknown): Record<string, any> | null {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = (metadata as Record<string, unknown>)[SCHEMA_DRAFT_KEY]
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, any>) : null
}

/**
 * Freeze a draft's working schema into a DAG-CBOR blob for publish.
 *
 * Returns the metadata to publish: `schemaDraft` removed and
 * `schemaDefinition` pointing at the published blob. Metadata without a
 * working schema passes through untouched. Both the desktop and the web
 * publish paths call this, so a `schemaDraft` never reaches a published
 * document.
 */
export async function freezeSchemaDraft<M extends Record<string, unknown> | undefined | null>(
  client: {request: UniversalClient['request']},
  metadata: M,
): Promise<M> {
  const draft = schemaDraftValue(metadata)
  if (!draft) return metadata
  const data = cbor.encode(dagJsonToIpld(draft) as any)
  const digest = await sha256.digest(data)
  const cid = CID.createV1(DAG_CBOR_CODE, digest).toString()
  await client.request('PublishBlobs', {blobs: [{cid, data}]})
  const {[SCHEMA_DRAFT_KEY]: _omit, ...rest} = metadata as Record<string, unknown>
  return {...rest, [SCHEMA_DEFINITION_KEY]: `ipfs://${cid}`} as unknown as M
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
      <SchemaDataEditor schema={schema} value={value} onValue={setValue} />
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

/** Platform handlers for what a schema page can start. Absent on a platform (the web), the
 * corresponding action is not offered — except extend, which falls back to the raw blob-draft route. */
export type SchemaDocumentActions = {
  /** Create a document draft whose `attributesSchema` is this schema page's URL. */
  onNewTypedDocument?: (schemaUrl: string) => void
  /** Create a document draft whose `childAttributesSchema` is this schema page's URL. */
  onNewTypedCollection?: (schemaUrl: string) => void
  /** Create a document draft carrying a working schema rooted on this schema (an extension). */
  onExtendSchema?: (baseSchemaCid: string) => void
}

/** Whether a schema can be the attributes schema of a document: a struct (not a union, not a
 * signed-blob envelope, which describes a whole signed object rather than a page's attributes). */
function isAttributesSchema(schema: Record<string, any> | undefined): boolean {
  return !!schema && !schema.anyOf && !schema.$type && !isSignedBlobSchema(schema)
}

/**
 * The schema actions for a document that DEFINES a type, as rows for the document's
 * REGULAR options menu: New Document, New Collection, Extend Schema, New Raw Value,
 * and Inspect Schema (the raw IPFS blob in the inspector). The generic "New Schema"
 * lives in the account dropdown's dev section. Empty for every other document, so
 * the menu shows nothing schema-ish unless a schema is actually set.
 */
export function useSchemaMenuItems(
  metadata: unknown,
  options?: SchemaDocumentActions & {
    /** This schema page's canonical `hm://` URL — what a typed document's binding key names. */
    docUrl?: string
  },
): MenuItemType[] {
  const navigate = useNavigate()
  const onExtendSchema = options?.onExtendSchema
  const onNewTypedDocument = options?.onNewTypedDocument
  const onNewTypedCollection = options?.onNewTypedCollection
  const docUrl = options?.docUrl
  const cid = schemaDefinitionCid(metadata)
  const bundledName = cid ? nameForCid(cid) : undefined
  const {byCid} = useSchemaRegistry(cid && !bundledName ? [cid] : [])
  const schema = !cid ? undefined : bundledName ? schemaForCid(cid) : byCid[cid]
  return useMemo(() => {
    if (!cid) return []
    const canCreate = !!schema && !schema.anyOf && !schema.$type
    const typed = isAttributesSchema(schema) && !!docUrl
    return [
      ...(typed && onNewTypedDocument
        ? [
            {
              key: 'schema-new-document',
              label: 'New Document',
              icon: <Plus className="size-4" />,
              onClick: () => onNewTypedDocument(docUrl),
            },
          ]
        : []),
      ...(typed && onNewTypedCollection
        ? [
            {
              key: 'schema-new-collection',
              label: 'New Collection',
              icon: <FolderPlus className="size-4" />,
              onClick: () => onNewTypedCollection(docUrl),
            },
          ]
        : []),
      ...(canCreate
        ? [
            {
              key: 'schema-extend',
              label: 'Extend Schema',
              icon: <Layers className="size-4" />,
              onClick: () => (onExtendSchema ? onExtendSchema(cid) : navigate(extendSchemaRoute(cid))),
            },
            {
              key: 'schema-new-raw-value',
              label: 'New Raw Value',
              icon: <Braces className="size-4" />,
              onClick: () => navigate(newInstanceRoute(cid)),
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
  }, [cid, schema, docUrl, navigate, onExtendSchema, onNewTypedDocument, onNewTypedCollection])
}

/**
 * Header actions for a document that DEFINES a type (has a `schemaDefinition`).
 * For an attributes schema: **New Document** (a draft typed by this schema) and
 * **New Collection** (a draft whose children are typed by it), when the platform
 * supplies those flows. For a signed-blob schema — which describes a whole signed
 * object, never a page's attributes — a **Create** button opens the signing
 * editor. Without platform flows, Create opens the raw value editor, which
 * publishes the result as a content-addressed IPFS blob. Resolves the schema
 * from the `schemaDefinition` CID via the registry, so it works for both bundled
 * and user-published schemas. Renders nothing until the schema resolves.
 */
export function SchemaDocumentHeaderActions({
  metadata,
  docUrl,
  onNewTypedDocument,
  onNewTypedCollection,
}: {
  metadata: unknown
  /** This schema page's canonical `hm://` URL. */
  docUrl?: string
} & Pick<SchemaDocumentActions, 'onNewTypedDocument' | 'onNewTypedCollection'>) {
  const cid = schemaDefinitionCid(metadata)
  const {byCid} = useSchemaRegistry(cid ? [cid] : [])
  const bundledName = cid ? nameForCid(cid) : undefined
  const schema = cid ? byCid[cid] : undefined
  const [createOpen, setCreateOpen] = useState(false)
  if (!cid) return null
  const typeName = bundledName || 'Schema'
  const isInstantiable = !!schema && !schema.anyOf // a union has no single seed shape
  const typed = isAttributesSchema(schema) && !!docUrl && !!(onNewTypedDocument || onNewTypedCollection)

  if (typed) {
    return (
      <div className="flex items-center gap-1.5">
        {onNewTypedDocument && (
          <Tooltip content="A new document whose attributes follow this schema">
            <Button size="sm" onClick={() => onNewTypedDocument(docUrl)}>
              <Plus className="mr-1 size-4" /> New Document
            </Button>
          </Tooltip>
        )}
        {onNewTypedCollection && (
          <Tooltip content="A new document whose children's attributes follow this schema">
            <Button size="sm" variant="outline" onClick={() => onNewTypedCollection(docUrl)}>
              <FolderPlus className="mr-1 size-4" /> New Collection
            </Button>
          </Tooltip>
        )}
      </div>
    )
  }

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

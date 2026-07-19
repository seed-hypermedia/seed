import * as cbor from '@ipld/dag-cbor'
import {useUniversalClient} from '@shm/shared'
import {useCID} from '@shm/shared/models/entity'
import {createInspectIpfsNavRoute} from '@shm/shared/routes'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {ipfsUrlToRoute} from '@/omnibar-url'
import {useSchemaRegistry} from '@/models/blob-schema'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Textarea} from '@shm/ui/components/textarea'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {dagJsonToIpld, findSeedIndexerCollision, isDagJsonBytes, isDagJsonLink, parseCidString} from '@shm/ui/dag-json'
import {
  BLOB_META_SCHEMA,
  BLOB_META_SCHEMA_CID,
  instantiateSchema,
  isSchemaBlob,
  type SchemaRegistry,
} from '@shm/ui/blob-schema'
import {BlobSchemaProvider, useSchemaWarningCount, useSchemaWarnings} from '@shm/ui/blob-schema-context'
import {BlobSchemaEditor} from '@shm/ui/blob-schema-editor'
import {isPlainObject} from '@shm/ui/value-editor'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {CBOR_VALUE_RULES, useValueHistory, ValueEditor, ValueEditorProvider} from '@shm/ui/value-editor'
import {Braces, Check, Copy, FileCode2, Link2, Search, TriangleAlert, UploadCloud} from 'lucide-react'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {useEffect, useMemo, useState} from 'react'

/** Multicodec code for DAG-CBOR, the only codec this editor can decode/encode. */
const DAG_CBOR_CODE = 0x71

// Module-level so its identity is stable across renders — BlobSchemaProvider
// memoizes validation on (schema, registry, value) identity.
const META_REGISTRY: SchemaRegistry = {[BLOB_META_SCHEMA_CID]: BLOB_META_SCHEMA}

/** Full-page GUI editor for raw DAG-CBOR IPFS blobs. */
export default function RawBlobPage() {
  const route = useNavRoute()
  if (route.key !== 'raw-blob') {
    throw new Error(`RawBlobPage: unsupported route ${route.key}`)
  }
  return (
    <div className="relative h-full max-h-full overflow-hidden rounded-lg border bg-white dark:bg-black">
      {route.cid ? (
        <ExistingBlobEditor key={route.cid} cid={route.cid} />
      ) : route.schemaCid ? (
        <NewInstanceEditor key={route.schemaCid} schemaCid={route.schemaCid} />
      ) : (
        <BlobEditor initialValue={{}} />
      )}
    </div>
  )
}

/** Loads and decodes an existing blob by CID, then hands off to the editor. */
function ExistingBlobEditor({cid}: {cid: string}) {
  const navigate = useNavigate()
  const codecCheck = useMemo(() => {
    try {
      return CID.parse(cid).code === DAG_CBOR_CODE ? 'cbor' : 'other'
    } catch {
      return 'invalid'
    }
  }, [cid])
  const blob = useCID(codecCheck === 'cbor' ? cid : undefined)

  if (codecCheck === 'invalid') {
    return <BlobFallback cid={cid} message="This is not a valid IPFS CID." />
  }
  if (codecCheck === 'other') {
    return (
      <BlobFallback cid={cid} message="This blob is not DAG-CBOR data, so it cannot be edited here.">
        <Button variant="secondary" onClick={() => navigate(createInspectIpfsNavRoute(cid))}>
          <Search className="size-4" />
          Open in Inspector
        </Button>
      </BlobFallback>
    )
  }
  if (blob.isLoading) {
    return <BlobSearching cid={cid} />
  }
  if (blob.isError || blob.data?.value === undefined) {
    return <BlobSearching cid={cid} notFoundYet onRetry={() => blob.refetch()} />
  }
  return <BlobEditor cid={cid} initialValue={blob.data.value} />
}

/**
 * "New instance" flow: loads the schema blob, materializes a starter value
 * shaped by it (defaults + required fields), links it via the reserved
 * `schema` key, and hands off to the editor. The meta-schema is built in, so
 * "New Schema" needs no fetch.
 */
function NewInstanceEditor({schemaCid}: {schemaCid: string}) {
  const isMeta = schemaCid === BLOB_META_SCHEMA_CID
  const fetched = useSchemaRegistry(isMeta ? undefined : schemaCid)
  const schema = isMeta ? BLOB_META_SCHEMA : fetched.rootSchema
  const registry: SchemaRegistry = isMeta ? META_REGISTRY : fetched.registry

  if (isMeta) {
    // "New Schema": most schemas describe documents, so start as an object —
    // the schema form opens straight into the fields table.
    return <BlobEditor initialValue={{schema: {'/': schemaCid}, type: 'object'}} />
  }
  if (!schema) {
    return <BlobSearching cid={schemaCid} notFoundYet={!fetched.isLoading} />
  }
  const starter = instantiateSchema(schema, registry)
  // A non-object root (e.g. type: "string") can't carry the `schema` key —
  // the starter value itself wins over the attachment convention.
  const initialValue = isPlainObject(starter)
    ? {...starter, schema: {'/': schemaCid}}
    : starter !== undefined
      ? starter
      : {schema: {'/': schemaCid}}
  return <BlobEditor initialValue={initialValue} />
}

/**
 * Shown while the daemon searches its local store and the IPFS network for
 * the blob. When a search times out, keeps retrying so the blob appears as
 * soon as it becomes available.
 */
function BlobSearching({cid, notFoundYet, onRetry}: {cid: string; notFoundYet?: boolean; onRetry?: () => void}) {
  useEffect(() => {
    if (!notFoundYet || !onRetry) return
    const interval = setInterval(onRetry, 10_000)
    return () => clearInterval(interval)
  }, [notFoundYet, onRetry])
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-16 text-center">
        <Spinner />
        <span className="text-muted-foreground w-full truncate font-mono text-xs">ipfs://{cid}</span>
        <p className="text-muted-foreground text-sm">
          {notFoundYet
            ? 'Not found yet — this blob is not available locally or from currently connected peers. Still searching…'
            : 'Searching your node and the IPFS network…'}
        </p>
        {notFoundYet && onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Search Again
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function BlobFallback({cid, message, children}: {cid: string; message: string; children?: React.ReactNode}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-12">
        <span className="text-muted-foreground truncate font-mono text-sm">ipfs://{cid}</span>
        <p className="text-muted-foreground text-sm">{message}</p>
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  )
}

/**
 * GUI-first blob editor. Publishing encodes the value as canonical DAG-CBOR,
 * computes the CIDv1 (sha2-256), stores it via PublishBlobs, and replaces the
 * route with the new CID. Blobs are immutable: editing a published blob and
 * publishing again creates a new blob with a new CID.
 *
 * When the value carries a `schema` IPLD link, the linked schema drives
 * advisory hints and warnings throughout the editor (never blocking). A blob
 * whose schema link targets the built-in meta-schema IS a schema; publishing
 * it also stores the meta-schema blob so the link always resolves.
 */
function BlobEditor({cid, initialValue}: {cid?: string; initialValue: unknown}) {
  const client = useUniversalClient()
  const navigate = useNavigate()
  const replace = useNavigate('replace')
  const [value, setValue] = useState<unknown>(initialValue)
  const [jsonMode, setJsonMode] = useState(false)
  const [attachMode, setAttachMode] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  // Schema blobs open in the purpose-built schema form; raw fields remain an
  // escape hatch for keywords the form doesn't surface.
  const [rawFieldsMode, setRawFieldsMode] = useState(false)

  const history = useValueHistory(value)
  const update = (newValue: unknown) => {
    history.record()
    setValue(newValue)
  }
  const handleUndo = () => {
    const snapshot = history.undo()
    if (snapshot) setValue(snapshot.value)
  }
  const handleRedo = () => {
    const snapshot = history.redo()
    if (snapshot) setValue(snapshot.value)
  }

  // Attached schema: a `schema` key holding a valid DAG-CBOR link. The
  // meta-schema is built into the app, so schemas-being-edited never wait on
  // a fetch (and work before the meta-schema blob is ever published).
  const attachedSchemaCid = useMemo(() => {
    if (!isPlainObject(value) || !isDagJsonLink(value.schema)) return undefined
    const parsed = parseCidString(value.schema['/'])
    return parsed?.code === DAG_CBOR_CODE ? value.schema['/'] : undefined
  }, [value])
  const isMetaAttached = attachedSchemaCid === BLOB_META_SCHEMA_CID
  const fetched = useSchemaRegistry(isMetaAttached ? undefined : attachedSchemaCid)
  const schema = isMetaAttached ? BLOB_META_SCHEMA : fetched.rootSchema
  const registry: SchemaRegistry = isMetaAttached ? META_REGISTRY : fetched.registry
  const valueIsSchema = isSchemaBlob(value)

  const isDirty = useMemo(() => JSON.stringify(value) !== JSON.stringify(initialValue), [value, initialValue])
  const canPublish = (!cid || isDirty) && !isPublishing

  const publish = async () => {
    setIsPublishing(true)
    try {
      // Convert DAG-JSON forms into real IPLD kinds: {"/": cid} links become
      // CID instances (tag 42) and {"/": {bytes}} becomes raw bytes.
      const data = cbor.encode(dagJsonToIpld(value))
      const digest = await sha256.digest(data)
      const newCid = CID.createV1(DAG_CBOR_CODE, digest).toString()
      const blobs: {cid: string; data: Uint8Array}[] = [{cid: newCid, data}]
      if (isMetaAttached) {
        // Publishing a schema: store the meta-schema alongside it so the
        // schema's own `schema` link resolves on any node that has this blob.
        blobs.push({cid: BLOB_META_SCHEMA_CID, data: cbor.encode(dagJsonToIpld(BLOB_META_SCHEMA))})
      }
      await client.request('PublishBlobs', {blobs})
      toast.success(`Published ipfs://${newCid}`)
      replace({key: 'raw-blob', cid: newCid})
    } catch (e) {
      // The daemon's indexers strict-decode any blob whose bytes look like a
      // signed Seed blob ("type" + known type name at any depth) and reject
      // the store when that decode fails — surface that instead of the
      // opaque error.
      let collision: string | null = null
      try {
        collision = findSeedIndexerCollision(cbor.encode(dagJsonToIpld(value)))
      } catch {
        // encoding itself failed; the original error already explains it
      }
      const message = e instanceof Error ? e.message : String(e)
      toast.error(
        collision
          ? `Failed to publish: this blob contains a "type" field followed by "${collision}", which the Seed daemon reserves for its signed ${collision} blobs. Rename or restructure that field. (${message})`
          : `Failed to publish blob: ${message}`,
      )
    } finally {
      setIsPublishing(false)
    }
  }

  const menuItems: MenuItemType[] = [
    {
      key: 'json-mode',
      label: jsonMode ? 'Edit as Fields' : 'Edit as JSON',
      icon: <Braces className="size-4" />,
      onClick: () => setJsonMode((mode) => !mode),
    },
  ]
  if (valueIsSchema && !jsonMode) {
    menuItems.push({
      key: 'schema-form-mode',
      label: rawFieldsMode ? 'Edit as Schema Form' : 'Edit as Raw Fields',
      icon: <FileCode2 className="size-4" />,
      onClick: () => setRawFieldsMode((mode) => !mode),
    })
  }
  // Attach requires a real map value: DAG-JSON link/bytes forms are leaf
  // kinds a `schema` key would corrupt. Hidden in JSON mode — the textarea
  // snapshots the value at open, so a concurrent attach would be silently
  // reverted by Apply.
  if (isPlainObject(value) && !isDagJsonLink(value) && !isDagJsonBytes(value) && !jsonMode) {
    menuItems.push({
      key: 'attach-schema',
      label: attachedSchemaCid ? 'Change Schema…' : 'Attach Schema…',
      icon: <FileCode2 className="size-4" />,
      onClick: () => setAttachMode(true),
    })
  }
  if (valueIsSchema && cid && !isDirty) {
    menuItems.push({
      key: 'new-instance',
      label: 'New Instance of this Schema',
      icon: <Copy className="size-4" />,
      onClick: () => navigate({key: 'raw-blob', schemaCid: cid}),
    })
  }
  if (cid) {
    menuItems.push(
      {
        key: 'copy-url',
        label: 'Copy ipfs:// URL',
        icon: <Copy className="size-4" />,
        onClick: () => {
          copyTextToClipboard(`ipfs://${cid}`)
          toast.success('Copied ipfs:// URL')
        },
      },
      {
        key: 'inspect',
        label: 'Open in Inspector',
        icon: <Search className="size-4" />,
        onClick: () => navigate(createInspectIpfsNavRoute(cid)),
      },
    )
  }
  // The editor is its own entry point for the building blocks: creating more
  // blobs and schemas is always available here (the document options menu
  // offers these only behind Developer Mode).
  menuItems.push(
    {
      key: 'new-raw-blob',
      label: 'New Blob',
      icon: <Braces className="size-4" />,
      onClick: () => navigate({key: 'raw-blob'}),
    },
    {
      key: 'new-schema',
      label: 'New Schema',
      icon: <FileCode2 className="size-4" />,
      onClick: () => navigate({key: 'raw-blob', schemaCid: BLOB_META_SCHEMA_CID}),
    },
  )

  return (
    <ValueEditorProvider
      onUndo={handleUndo}
      onRedo={handleRedo}
      openUrl={(url) => {
        const route = ipfsUrlToRoute(url)
        if (route) navigate(route)
      }}
    >
      <BlobSchemaProvider schema={schema} registry={registry} value={value}>
        <div className="absolute top-2 right-2 z-50 flex items-center gap-1 rounded-sm md:top-4 md:right-4">
          {canPublish && (
            <Button variant="default" size="sm" disabled={isPublishing} onClick={publish}>
              {isPublishing ? <Spinner className="size-4" /> : <UploadCloud className="size-4" />}
              Publish
            </Button>
          )}
          <OptionsDropdown menuItems={menuItems} align="end" side="bottom" />
        </div>
        <div className="h-full overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 pt-14 pb-24 md:pt-16">
            {cid ? (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <span className="truncate font-mono">ipfs://{cid}</span>
                {!isDirty && (
                  <span className="flex shrink-0 items-center gap-1">
                    <Check className="size-3" />
                    Published
                  </span>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                {valueIsSchema
                  ? 'New schema — publish to store it and create instances from it.'
                  : 'New blob — publish to encode as DAG-CBOR and store it on your IPFS node.'}
              </p>
            )}
            <SchemaStatusRow
              attachedSchemaCid={attachedSchemaCid}
              valueIsSchema={valueIsSchema}
              schemaLoaded={!!schema}
              schemaLoading={!isMetaAttached && !!attachedSchemaCid && fetched.isLoading}
              onOpenSchema={
                attachedSchemaCid && !isMetaAttached
                  ? () => navigate({key: 'raw-blob', cid: attachedSchemaCid})
                  : undefined
              }
            />
            {attachMode && (
              <AttachSchemaBar
                // A `schema` key holding anything but an attachment link is
                // the user's own data; replacing it needs their eyes open.
                replacesUserData={isPlainObject(value) && value.schema !== undefined && attachedSchemaCid === undefined}
                onCancel={() => setAttachMode(false)}
                onAttach={(schemaCid) => {
                  if (!isPlainObject(value)) return
                  update({...value, schema: {'/': schemaCid}})
                  setAttachMode(false)
                }}
              />
            )}
            {jsonMode ? (
              <BlobJsonMode
                value={value}
                onApply={(next) => {
                  update(next)
                  setJsonMode(false)
                }}
                onCancel={() => setJsonMode(false)}
              />
            ) : valueIsSchema && !rawFieldsMode && isPlainObject(value) ? (
              <BlobSchemaEditor value={value} onValue={update} />
            ) : (
              <ValueEditor value={value} onValue={update} rules={CBOR_VALUE_RULES} />
            )}
          </div>
        </div>
      </BlobSchemaProvider>
    </ValueEditorProvider>
  )
}

/**
 * One quiet line about the attached schema: what it is, whether it loaded,
 * and how many advisory warnings the current value has. Warnings never block
 * editing or publishing.
 */
function SchemaStatusRow({
  attachedSchemaCid,
  valueIsSchema,
  schemaLoaded,
  schemaLoading,
  onOpenSchema,
}: {
  attachedSchemaCid: string | undefined
  valueIsSchema: boolean
  schemaLoaded: boolean
  schemaLoading: boolean
  onOpenSchema?: () => void
}) {
  const warningCount = useSchemaWarningCount()
  // Root-level warnings (missing required keys, root type mismatch…) have no
  // field row to badge, so they surface here.
  const rootWarnings = useSchemaWarnings([])
  if (!attachedSchemaCid) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground flex items-center gap-1">
        <FileCode2 className="size-3.5" />
        {valueIsSchema ? 'This blob is a schema' : 'Schema attached'}
      </span>
      {!valueIsSchema && (
        <button
          className={cn(
            'text-muted-foreground flex max-w-56 items-center gap-1 truncate font-mono',
            onOpenSchema && 'hover:underline',
          )}
          onClick={onOpenSchema}
          disabled={!onOpenSchema}
        >
          <Link2 className="size-3 shrink-0" />
          <span className="truncate">{attachedSchemaCid}</span>
        </button>
      )}
      {schemaLoading && (
        <span className="text-muted-foreground flex items-center gap-1">
          <Spinner className="size-3" />
          Loading schema…
        </span>
      )}
      {schemaLoaded && warningCount > 0 && (
        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
          <TriangleAlert className="size-3.5" />
          {warningCount} field{warningCount === 1 ? " doesn't" : "s don't"} match the schema — kept as-is
          {rootWarnings.length > 0 && <>: {rootWarnings.map((warning) => warning.message).join('; ')}</>}
        </span>
      )}
      {schemaLoaded && warningCount === 0 && !valueIsSchema && (
        <span className="text-muted-foreground flex items-center gap-1">
          <Check className="size-3" />
          Matches schema
        </span>
      )}
    </div>
  )
}

/** Inline bar for attaching a schema by CID or ipfs:// URL. */
function AttachSchemaBar({
  replacesUserData,
  onAttach,
  onCancel,
}: {
  /** The value already has a non-attachment `schema` field the attach would replace. */
  replacesUserData?: boolean
  onAttach: (cid: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    const cidText = text.trim().replace(/^ipfs:\/\//, '')
    const parsed = parseCidString(cidText)
    if (!parsed) {
      setError('Enter a valid CID or ipfs:// URL')
      return
    }
    if (parsed.code !== DAG_CBOR_CODE) {
      setError('Schemas are DAG-CBOR blobs — this CID has a different codec')
      return
    }
    onAttach(cidText)
  }

  return (
    <div className="border-border flex flex-col gap-2 rounded-md border border-dashed p-3">
      {replacesUserData && (
        <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
          <TriangleAlert className="size-3.5 shrink-0" />
          This blob already has a "schema" field with its own data — attaching will replace it (undo restores it).
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={text}
          placeholder="Schema CID or ipfs:// URL"
          className="min-w-64 flex-1 font-mono text-xs"
          autoFocus
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onCancel()
          }}
        />
        <Button size="sm" variant={replacesUserData ? 'destructive' : 'default'} onClick={submit}>
          <Check className="size-4" />
          {replacesUserData ? 'Replace "schema" field' : 'Attach'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

/** Explicit JSON escape hatch: edit the whole blob value as text, then apply. */
function BlobJsonMode({
  value,
  onApply,
  onCancel,
}: {
  value: unknown
  onApply: (value: unknown) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))

  const validation = useMemo(() => {
    try {
      return {value: JSON.parse(text) as unknown}
    } catch (e) {
      return {error: e instanceof Error ? e.message : 'Invalid JSON'}
    }
  }, [text])

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={text}
        rows={Math.max(12, Math.min(36, text.split('\n').length + 1))}
        spellCheck={false}
        autoFocus
        className={cn('font-mono text-sm', 'error' in validation && 'border-destructive')}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex min-h-8 items-center gap-2">
        <Button size="sm" disabled={!('value' in validation)} onClick={() => onApply((validation as any).value)}>
          <Check className="size-4" />
          Apply
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        {'error' in validation && <p className="text-destructive text-xs">{validation.error}</p>}
      </div>
    </div>
  )
}

import {createInspectIpfsNavRoute, NavRoute, useCID, useUniversalAppContext} from '@shm/shared'
import {getMetadataName} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import type {InspectIpfsEditField} from '@shm/shared/routes'
import {DocumentChange} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {useStream} from '@shm/shared/use-stream'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {code as DAG_CBOR_CODE} from '@shm/shared/cbor'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useOpenUrl, useRouteLink, useUniversalClient} from '@shm/shared/routing'
import {useNavigate} from '@shm/shared/utils/navigation'
import {Braces, Check, Copy, ExternalLink, FileCode2, FileEdit, FileText} from 'lucide-react'
import {base58btc} from 'multiformats/bases/base58'
import {CID} from 'multiformats/cid'
import {type ReactNode, useEffect, useMemo, useState} from 'react'
import {AttachSchemaBar, BlobJsonMode, RawDagJsonView, SchemaStatusRow} from './blob-editor-parts'
import {Button} from './button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from './components/dialog'
import {Textarea} from './components/textarea'
import {copyTextToClipboard} from './copy-to-clipboard'
import {base64ToBytes, isDagJsonBytes, isDagJsonLink, parseCidString} from './dag-json'
import {useFileProxyUrl, useImageUrl} from './get-file-url'
import {publishCborBlob, publishTextBlob} from './ipfs-publish'
import {blobBuilderMenuItems, META_SCHEMA_CID, NEW_BLOB_PATH, newInstanceRoute} from './onyx/blob-menu-items'
import {seedValue} from './onyx/onyx-data-editor'
import {emptyStructSchema} from './onyx/onyx-schema-editor'
import {SchemaAwareEditor} from './onyx/schema-aware-editor'
import {isOnyxSchema, ONYX_SCHEMAS, schemaCid} from './onyx/onyx-engine'
import {useResolvedSchema} from './onyx/onyx-schema-resolve'
import {SchemaPicker} from './onyx/schema-picker'
import {OnyxSchemaProvider} from './onyx/onyx-schema-context'
import {useOnyxSchemaRegistry} from './onyx/onyx-schema-registry-cid'
import {type MenuItemType, OptionsDropdown} from './options-dropdown'
import {Spinner} from './spinner'
import {toast} from './toast'
import {cn} from './utils'
import {
  CBOR_VALUE_RULES,
  isPlainObject,
  useValueHistory,
  ValueDisplay,
  ValueEditor,
  ValueEditorProvider,
} from './value-editor'

type IpfsKind = 'loading' | 'image' | 'cbor' | 'text'

/**
 * Probes whether an image URL loads. Returns `null` while testing, `true`/`false`
 * once known. More reliable than a content-type header the gateway may not set.
 */
function useIsLoadableImage(imageUrl: string): boolean | null {
  const [isImage, setIsImage] = useState<boolean | null>(imageUrl ? null : false)
  useEffect(() => {
    if (!imageUrl || typeof window === 'undefined') {
      setIsImage(false)
      return
    }
    setIsImage(null)
    let cancelled = false
    const img = new window.Image()
    img.onload = () => {
      if (!cancelled) setIsImage(true)
    }
    img.onerror = () => {
      if (!cancelled) setIsImage(false)
    }
    img.src = imageUrl
    return () => {
      cancelled = true
    }
  }, [imageUrl])
  return isImage
}

/** Fetches an IPFS file as text (for editing/viewing plain-text blobs). */
function useIpfsText(url: string): {text: string | null; loading: boolean} {
  const [state, setState] = useState<{text: string | null; loading: boolean}>({text: null, loading: !!url})
  useEffect(() => {
    if (!url) {
      setState({text: null, loading: false})
      return
    }
    let cancelled = false
    setState({text: null, loading: true})
    fetch(url)
      .then((r) => r.text())
      .then((text) => {
        if (!cancelled) setState({text, loading: false})
      })
      .catch(() => {
        if (!cancelled) setState({text: null, loading: false})
      })
    return () => {
      cancelled = true
    }
  }, [url])
  return state
}

/**
 * THE IPFS page: viewer and editor in one. `ipfsPath` is
 *   - `<cid>[/sub/path]` — view a published blob (image, text, or DAG-CBOR);
 *     "Edit…" turns a DAG-CBOR or text blob into a draft in place;
 *   - `new` — a blank DAG-CBOR draft;
 *   - `new/<schemaCid>` — a draft seeded by that schema, linked via `schema`
 *     (the bundled meta-schema CID means "New Schema").
 * Publishing encodes canonical DAG-CBOR, stores the blob, and replaces the route
 * with the new CID (blobs are immutable). A DAG-CBOR value with a `schema` link
 * — or that IS a schema — gets advisory validation and schema-driven inputs.
 * "View raw" / "Edit raw" strips the presentation back to dag-json text: plain
 * JSON with IPLD links and bytes in their `{"/": …}` envelopes.
 */
export function InspectIpfsPage({
  ipfsPath,
  editField,
  exitRoute,
  windowControls,
  trafficLightInset = false,
  gatewayUrl = DEFAULT_GATEWAY_URL,
}: {
  ipfsPath: string
  /** Edit this blob in the context of a document's metadata field: opens straight
   * into a draft; publishing also publishes the metadata change on the document
   * (no document draft involved). */
  editField?: InspectIpfsEditField
  exitRoute?: NavRoute | null
  /** Retained for API compatibility; hm:// / ipfs:// links route via the app openUrl. */
  getRouteForUrl?: (url: string) => NavRoute | string | null
  /** Desktop-only window controls (e.g. close button on non-macOS) shown at the far right. */
  windowControls?: ReactNode
  /** Reserve space at the left of the top bar for macOS traffic lights. */
  trafficLightInset?: boolean
  /** Gateway origin for the shareable `https://<gateway>/ipfs/<cid>` link. */
  gatewayUrl?: string
}) {
  const segments = ipfsPath.split('/').filter(Boolean)
  const isDraft = segments[0] === NEW_BLOB_PATH
  const seedSchemaCid = isDraft ? segments[1] : undefined
  const cid = isDraft ? undefined : segments[0]
  const pathSegments = isDraft ? [] : segments.slice(1)
  const hasSubpath = pathSegments.length > 0
  const ipfsData = useCID(cid)
  const client = useUniversalClient()
  const navigate = useNavigate()
  const replaceRoute = useNavigate('replace')
  const openUrl = useOpenUrl()

  // The CID's codec tells us definitively whether this is structured DAG-CBOR
  // (0x71) or a raw UnixFS file (dag-pb / raw) — an image or plain text.
  const codec = useMemo(() => {
    try {
      return CID.parse(cid!).code
    } catch {
      return null
    }
  }, [cid])
  const isDagCbor = codec === DAG_CBOR_CODE
  const isFile = codec != null && !isDagCbor

  const getImageUrl = useImageUrl()
  const imageUrl = !isDraft && isFile && !hasSubpath && cid ? getImageUrl(`ipfs://${cid}`) : ''
  const isImage = useIsLoadableImage(imageUrl)
  const getFileUrl = useFileProxyUrl()

  const rawValue = ipfsData.data?.value
  const viewValue = useMemo(
    () => (rawValue === undefined ? null : readInspectIpfsPath(rawValue, pathSegments)),
    [rawValue, pathSegments],
  )
  // Keep IPLD links/bytes in their DAG-JSON shape so ValueDisplay renders them
  // like the editor; only decode `signer` bytes to a readable hm:// principal.
  const preparedData = useMemo(() => (viewValue === null ? null : decodeSignerBytes(viewValue)), [viewValue])

  let kind: IpfsKind
  if (isDraft) {
    kind = 'cbor'
  } else if (hasSubpath || isDagCbor) {
    kind = ipfsData.isLoading ? 'loading' : 'cbor'
  } else if (isFile) {
    kind = isImage === null ? 'loading' : isImage ? 'image' : 'text'
  } else {
    kind = ipfsData.isLoading ? 'loading' : rawValue != null ? 'cbor' : 'text'
  }

  const textUrl = kind === 'text' && !hasSubpath && cid ? getFileUrl(`ipfs://${cid}`) : ''
  const {text: rawText, loading: textLoading} = useIpfsText(textUrl)

  // ── field context (document › field) ──
  const contextDocId = useMemo(() => (editField ? unpackHmId(editField.docUrl) : null), [editField?.docUrl])
  const contextResource = useResource(contextDocId)
  const contextDoc =
    contextResource.data?.type === 'document' ? (contextResource.data.document as Record<string, any>) : undefined
  const contextDocTitle = contextDoc ? getMetadataName(contextDoc.metadata) : undefined
  const {selectedIdentity} = useUniversalAppContext()
  const signerUid = useStream(selectedIdentity) ?? null
  const contextRoute: NavRoute | null = contextDocId ? {key: 'document', id: contextDocId} : null
  const [confirmOpen, setConfirmOpen] = useState(false)

  // ── draft / edit state ──
  const startsEditing = isDraft || !!editField
  const [mode, setMode] = useState<'view' | 'edit'>(startsEditing ? 'edit' : 'view')
  const [rawMode, setRawMode] = useState(false)
  const [editJson, setEditJson] = useState<unknown>(undefined)
  const [editText, setEditText] = useState<string | null>(null)
  const [attachMode, setAttachMode] = useState(false)
  const [publishing, setPublishing] = useState(false)
  useEffect(() => {
    setMode(startsEditing ? 'edit' : 'view')
    setRawMode(false)
    setEditJson(undefined)
    setEditText(null)
    setAttachMode(false)
    setPublishing(false)
  }, [ipfsPath, startsEditing])
  // In field context the published value IS the draft, once it loads.
  useEffect(() => {
    if (editField && editJson === undefined && rawValue !== undefined) setEditJson(rawValue)
  }, [editField, editJson, rawValue])

  // A new instance seeds from its schema (bundled ones resolve at once, others
  // are fetched) and links it via the reserved `schema` key. A new schema is
  // self-describing and carries no link. A blank draft is `{}`.
  const isMetaSeed = seedSchemaCid === META_SCHEMA_CID
  const seedRegistry = useOnyxSchemaRegistry(seedSchemaCid && !isMetaSeed ? [seedSchemaCid] : [])
  const seedSchema = isMetaSeed
    ? ONYX_SCHEMAS['onyx-schema']
    : seedSchemaCid
      ? seedRegistry.byCid[seedSchemaCid]
      : undefined
  useEffect(() => {
    if (!isDraft || editJson !== undefined) return
    if (!seedSchemaCid) {
      setEditJson({})
      return
    }
    if (!seedSchema) return
    const starter = seedValue(seedSchema)
    if (isMetaSeed) setEditJson(emptyStructSchema())
    else if (isPlainObject(starter)) setEditJson({...starter, schema: {'/': seedSchemaCid}})
    else setEditJson(starter !== undefined ? starter : {schema: {'/': seedSchemaCid}})
  }, [isDraft, editJson, seedSchemaCid, seedSchema, isMetaSeed])

  // A blank draft offers a schema picker; choosing one restarts the draft as
  // `new/<schemaCid>` (bundled names resolve at once, pasted refs resolve first).
  const [pickedRef, setPickedRef] = useState<string | null>(null)
  const picked = useResolvedSchema(pickedRef)
  useEffect(() => {
    if (!pickedRef) return
    const target = pickedRef.startsWith('ipfs://')
      ? pickedRef.slice('ipfs://'.length)
      : schemaCid(pickedRef) ?? picked.cid
    if (target) replaceRoute(newInstanceRoute(target))
  }, [pickedRef, picked.cid, replaceRoute])

  const history = useValueHistory(editJson)
  const update = (next: unknown) => {
    history.record()
    setEditJson(next)
  }
  const undo = () => {
    const snap = history.undo()
    if (snap) setEditJson(snap.value)
  }
  const redo = () => {
    const snap = history.redo()
    if (snap) setEditJson(snap.value)
  }

  // "Edit…" edits in place: the published value becomes the draft.
  const canEdit = !isDraft && !hasSubpath && (kind === 'cbor' || kind === 'text')
  const startEdit = () => {
    if (kind === 'cbor') setEditJson(rawValue)
    else if (kind === 'text') setEditText(rawText ?? '')
    setRawMode(false)
    setMode('edit')
  }
  const cancelEdit = () => {
    setMode('view')
    setRawMode(false)
    setEditJson(undefined)
    setEditText(null)
    setAttachMode(false)
  }

  // ── schema advisory (edit: the draft; view: the published value) ──
  const advisoryTarget = mode === 'edit' ? editJson : hasSubpath ? undefined : rawValue
  const valueIsSchema = useMemo(() => isOnyxSchema(advisoryTarget), [advisoryTarget])
  const attachedSchemaCid = useMemo(() => {
    if (valueIsSchema || !isPlainObject(advisoryTarget) || !isDagJsonLink(advisoryTarget.schema)) return undefined
    return parseCidString(advisoryTarget.schema['/'])?.code === DAG_CBOR_CODE ? advisoryTarget.schema['/'] : undefined
  }, [advisoryTarget, valueIsSchema])
  const schemaRegistry = useOnyxSchemaRegistry(attachedSchemaCid ? [attachedSchemaCid] : [])
  const schema = valueIsSchema
    ? ONYX_SCHEMAS['onyx-schema']
    : attachedSchemaCid
      ? schemaRegistry.byCid[attachedSchemaCid]
      : undefined
  // The reserved `schema` attachment link is app plumbing, not user data — drop
  // it from advisory validation so a well-formed instance reads as matching.
  const advisoryValue = useMemo(() => {
    if (!attachedSchemaCid || !isPlainObject(advisoryTarget)) return advisoryTarget
    const {schema: _attachment, ...rest} = advisoryTarget
    return rest
  }, [advisoryTarget, attachedSchemaCid])

  const showSchemaPicker = isDraft && !seedSchemaCid && !attachedSchemaCid && !valueIsSchema

  const isDirty =
    mode === 'edit' && (isDraft || JSON.stringify(editJson) !== JSON.stringify(rawValue) || editText !== null)

  /** Field context: publish the blob, then a metadata change on the document pointing at it. */
  const publishInContext = async () => {
    if (!editField || !contextDocId || !contextDoc) return
    if (!client.publishDocument) throw new Error('This app cannot publish documents')
    if (!signerUid) throw new Error('Select an account to publish with')
    const newCid = await publishCborBlob(client, editJson)
    await client.publishDocument({
      account: contextDocId.uid,
      signerAccountUid: signerUid,
      path: hmIdPathToEntityQueryPath(contextDocId.path),
      changes: [
        new DocumentChange({op: {case: 'setMetadata', value: {key: editField.field, value: `ipfs://${newCid}`}}}),
      ] as any,
      baseVersion: contextDoc.version || '',
      genesis: contextDoc.genesis,
      generation: contextDoc.generationInfo?.generation,
    })
    toast.success(`Updated ${editField.field} of ${contextDocTitle ?? 'the document'}`)
    if (contextRoute) navigate(contextRoute)
  }

  const publish = async () => {
    setPublishing(true)
    try {
      if (editField) {
        await publishInContext()
        return
      }
      const newCid =
        kind === 'text' ? await publishTextBlob(client, editText ?? '') : await publishCborBlob(client, editJson)
      toast.success(`Published ipfs://${newCid}`)
      replaceRoute(createInspectIpfsNavRoute(newCid))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to publish')
    } finally {
      setPublishing(false)
    }
  }

  // Links inside the value: hm:// pills open the document; ipfs:// pills open that blob here.
  const openLinkedBlob = (linkCid: string) => openUrl(`hm://inspect/ipfs/${linkCid}`)
  const openHmUrl = (url: string) => openUrl(url)

  // ── the "…" menu ──
  const menuItems: MenuItemType[] = []
  if (mode === 'view') {
    if (kind === 'cbor')
      menuItems.push({
        key: 'raw',
        label: rawMode ? 'View fields' : 'View raw',
        icon: <Braces className="size-4" />,
        onClick: () => setRawMode((r) => !r),
      })
    if (valueIsSchema && cid && !hasSubpath)
      menuItems.push({
        key: 'new-instance',
        label: 'New Instance of this Schema',
        icon: <Copy className="size-4" />,
        onClick: () => navigate(newInstanceRoute(cid)),
      })
    if (cid)
      menuItems.push({
        key: 'copy-url',
        label: 'Copy ipfs:// URL',
        icon: <Copy className="size-4" />,
        onClick: () => {
          copyTextToClipboard(`ipfs://${cid}`)
          toast.success('Copied ipfs:// URL')
        },
      })
    if (cid)
      menuItems.push({
        key: 'copy-gateway',
        label: 'Copy gateway link',
        icon: <Copy className="size-4" />,
        onClick: () => {
          copyTextToClipboard(`${gatewayUrl.replace(/\/+$/, '')}/ipfs/${ipfsPath}`)
          toast.success('Copied gateway link')
        },
      })
  } else {
    if (kind === 'cbor')
      menuItems.push({
        key: 'raw',
        label: rawMode ? 'Edit as fields' : 'Edit raw',
        icon: <Braces className="size-4" />,
        onClick: () => setRawMode((r) => !r),
      })
    // Attach needs a real map value; hidden in raw mode (the textarea snapshots
    // the value at open, so a concurrent attach would be reverted by Apply).
    if (kind === 'cbor' && isPlainObject(editJson) && !isDagJsonLink(editJson) && !isDagJsonBytes(editJson) && !rawMode)
      menuItems.push({
        key: 'attach-schema',
        label: attachedSchemaCid ? 'Change Schema…' : 'Attach Schema…',
        icon: <FileCode2 className="size-4" />,
        onClick: () => setAttachMode(true),
      })
  }
  menuItems.push(...blobBuilderMenuItems(navigate))
  const exitLink = useRouteLink(mode === 'view' && exitRoute ? exitRoute : null)

  let body: ReactNode
  if (mode === 'edit' && kind === 'cbor') {
    body =
      editJson === undefined ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <ValueEditorProvider onUndo={undo} onRedo={redo} openUrl={openHmUrl} openFile={openLinkedBlob}>
          <OnyxSchemaProvider schema={schema} registry={{}} value={advisoryValue}>
            <div className="flex flex-col gap-4">
              {!cid && (
                <p className="text-muted-foreground text-xs" data-testid="draft-note">
                  {valueIsSchema
                    ? 'New schema — publish to store it and create instances from it.'
                    : 'New blob — publish to encode as DAG-CBOR and store it on your IPFS node.'}
                </p>
              )}
              {showSchemaPicker && (
                <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="new-blob-schema-picker">
                  <span className="text-muted-foreground">Schema</span>
                  <SchemaPicker value={pickedRef} onChange={setPickedRef} />
                  {pickedRef && !picked.schema && (
                    <span className="text-muted-foreground text-xs">
                      {picked.isLoading ? 'Resolving…' : 'schema not found'}
                    </span>
                  )}
                </div>
              )}
              <SchemaStatusRow
                attachedSchemaCid={attachedSchemaCid}
                valueIsSchema={valueIsSchema}
                schemaLoaded={!!schema}
                schemaLoading={!!attachedSchemaCid && schemaRegistry.isLoading && !schema}
                onOpenSchema={attachedSchemaCid ? () => navigate({key: 'schema', cid: attachedSchemaCid}) : undefined}
              />
              {attachMode && (
                <AttachSchemaBar
                  replacesUserData={
                    isPlainObject(editJson) && editJson.schema !== undefined && attachedSchemaCid === undefined
                  }
                  onCancel={() => setAttachMode(false)}
                  onAttach={(schemaBlobCid) => {
                    if (!isPlainObject(editJson)) return
                    update({...editJson, schema: {'/': schemaBlobCid}})
                    setAttachMode(false)
                  }}
                />
              )}
              {rawMode ? (
                <BlobJsonMode
                  value={editJson}
                  onApply={(next) => {
                    update(next)
                    setRawMode(false)
                  }}
                  onCancel={() => setRawMode(false)}
                />
              ) : valueIsSchema ? (
                // The blob IS a schema: the struct form (name, fields, kinds, targets,
                // signed-blob toggle) — "Edit raw" is the JSON escape hatch.
                <SchemaAwareEditor schema={ONYX_SCHEMAS['onyx-schema']!} value={editJson} onValue={update} />
              ) : (
                <ValueEditor value={editJson} onValue={update} rules={CBOR_VALUE_RULES} />
              )}
            </div>
          </OnyxSchemaProvider>
        </ValueEditorProvider>
      )
  } else if (mode === 'edit' && kind === 'text') {
    body = (
      <Textarea
        autoFocus
        value={editText ?? ''}
        onChange={(e) => setEditText(e.target.value)}
        spellCheck={false}
        className="min-h-[60vh] font-mono text-sm"
      />
    )
  } else if (kind === 'loading' || (kind === 'text' && textLoading)) {
    body = (
      <div className="flex items-center justify-center py-8">
        <Spinner />
      </div>
    )
  } else if (kind === 'image') {
    body = (
      <div className="flex justify-center">
        <img
          src={imageUrl}
          alt={`ipfs://${cid}`}
          className="max-h-[80vh] max-w-full rounded-md object-contain shadow-sm"
        />
      </div>
    )
  } else if (kind === 'text') {
    body =
      rawText == null ? (
        <div className="text-muted-foreground text-sm">No IPFS data found.</div>
      ) : (
        <pre className="bg-background overflow-x-auto rounded-md border p-4 font-mono text-sm whitespace-pre-wrap">
          {rawText}
        </pre>
      )
  } else if (preparedData === null || preparedData === undefined) {
    body = <div className="text-muted-foreground text-sm">No IPFS data found.</div>
  } else if (rawMode) {
    body = <RawDagJsonView value={viewValue} />
  } else {
    // Render the published blob with the editor's own value renderer so the view
    // matches the editor; schema status (attached / is-a-schema) reads the same.
    body = (
      <ValueEditorProvider openFile={openLinkedBlob} openUrl={openHmUrl}>
        <OnyxSchemaProvider schema={schema} registry={{}} value={advisoryValue}>
          <div className="flex flex-col gap-4">
            <SchemaStatusRow
              attachedSchemaCid={attachedSchemaCid}
              valueIsSchema={valueIsSchema}
              schemaLoaded={!!schema}
              schemaLoading={!!attachedSchemaCid && schemaRegistry.isLoading && !schema}
              onOpenSchema={attachedSchemaCid ? () => navigate({key: 'schema', cid: attachedSchemaCid}) : undefined}
            />
            <ValueDisplay value={preparedData} rules={CBOR_VALUE_RULES} />
          </div>
        </OnyxSchemaProvider>
      </ValueEditorProvider>
    )
  }

  const shortCid = cid ? `${cid.slice(0, 10)}…${cid.slice(-6)}` : null
  const title = editField
    ? 'Editing'
    : isDraft
      ? valueIsSchema
        ? 'New schema'
        : 'New blob'
      : mode === 'edit'
        ? 'Editing blob'
        : valueIsSchema
          ? 'Schema blob'
          : kind === 'image'
            ? 'Image'
            : kind === 'text'
              ? 'Text file'
              : 'IPFS blob'

  return (
    <div className="bg-background flex h-full max-h-full flex-col overflow-hidden">
      <BlobHeader
        title={title}
        subject={
          editField ? (
            <>
              <code className="bg-muted rounded px-1 text-xs">{editField.field}</code>
              <span className="text-muted-foreground">of</span>
              <button
                type="button"
                className="text-primary truncate font-medium hover:underline"
                data-testid="edit-field-doc-link"
                onClick={() => contextRoute && navigate(contextRoute)}
              >
                {contextDocTitle ?? editField.docUrl}
              </button>
            </>
          ) : null
        }
        cid={cid}
        shortCid={editField ? null : shortCid}
        status={mode !== 'edit' ? null : isDraft ? 'Unpublished draft' : isDirty ? 'Unpublished changes' : null}
        trafficLightInset={trafficLightInset}
        windowControls={windowControls}
        actions={
          <>
            {mode === 'edit' ? (
              <>
                {cid && !editField && (
                  <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={publishing}>
                    Cancel
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => (editField ? setConfirmOpen(true) : publish())}
                  disabled={!(isDirty && !publishing && editJson !== undefined) || (!!editField && !contextDoc)}
                  data-testid="blob-publish"
                >
                  {publishing ? <Spinner className="size-4" /> : <Check className="size-4" />}
                  Publish
                </Button>
              </>
            ) : (
              <>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={startEdit} data-testid="blob-edit">
                    <FileEdit className="size-4" />
                    Edit
                  </Button>
                )}
                {exitRoute && (
                  <Button size="sm" variant="outline" asChild>
                    <a {...exitLink} data-testid="blob-open-resource">
                      <ExternalLink className="size-4" />
                      Open Resource
                    </a>
                  </Button>
                )}
              </>
            )}
            {menuItems.length > 0 && <OptionsDropdown menuItems={menuItems} align="end" side="bottom" />}
          </>
        }
      />
      <div className="flex-1 overflow-y-auto bg-zinc-100 dark:bg-zinc-900">
        <div className="mx-auto w-full px-4 py-4" style={{maxWidth: 960}}>
          <div className="flex flex-col gap-4">{body}</div>
          {editField && (
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Update {contextDocTitle ?? 'the document'}?</DialogTitle>
                </DialogHeader>
                <p className="text-sm">
                  This publishes the edited object as a new IPFS blob and sets{' '}
                  <code className="bg-muted rounded px-1">metadata.{editField.field}</code> of{' '}
                  <span className="font-medium">{contextDocTitle ?? editField.docUrl}</span> to the new CID — a new
                  version of the document, published directly. The document's draft (if any) is not involved.
                </p>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={publishing}>
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      await publish()
                      setConfirmOpen(false)
                    }}
                    disabled={publishing}
                    data-testid="confirm-update-document"
                  >
                    {publishing ? <Spinner className="size-4" /> : <Check className="size-4" />}
                    Publish & update {editField.field}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The page header, in the app's regular top-bar style (the same bar documents
 * use): what this is and its CID on the left, actions on the right. In the
 * desktop's chromeless blob window it doubles as the draggable title bar.
 */
function BlobHeader({
  title,
  subject,
  cid,
  shortCid,
  status,
  actions,
  trafficLightInset,
  windowControls,
}: {
  title: string
  /** What is being edited, right after the title (e.g. the field and its document). */
  subject?: ReactNode
  cid?: string
  shortCid: string | null
  /** A state badge: "Unpublished draft" for a new blob, "Unpublished changes" once a published blob is edited. */
  status: string | null
  actions: ReactNode
  trafficLightInset?: boolean
  windowControls?: ReactNode
}) {
  return (
    <div
      data-document-top-bar=""
      className={cn(
        'window-drag border-border dark:bg-background flex h-12 w-full shrink-0 items-center gap-2 border-b bg-white px-4',
      )}
      style={trafficLightInset ? {paddingLeft: 78} : undefined}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        <FileText className="text-muted-foreground size-4 shrink-0" />
        <span className="shrink-0 font-medium">{title}</span>
        {subject}
        {status && (
          <span
            className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs font-medium"
            data-testid="blob-status"
          >
            {status}
          </span>
        )}
        {shortCid && (
          <span className="text-muted-foreground min-w-0 truncate font-mono text-xs" title={`ipfs://${cid}`}>
            {shortCid}
          </span>
        )}
      </div>
      <div className="no-window-drag flex shrink-0 items-center gap-1">{actions}</div>
      {windowControls}
    </div>
  )
}

/**
 * Decode DAG-CBOR `signer` byte fields into a readable `hm://<principal>` string
 * while leaving IPLD links (`{"/": cid}`) and other bytes in their DAG-JSON shape
 * so ValueDisplay can render them like the editor does.
 */
function decodeSignerBytes(data: unknown, parentKey?: string): unknown {
  if (parentKey === 'signer' && isDagJsonBytes(data)) {
    try {
      return `hm://${base58btc.encode(base64ToBytes(data['/'].bytes))}`
    } catch {
      return data
    }
  }
  if (Array.isArray(data)) {
    return data.map((item) => decodeSignerBytes(item))
  }
  if (isPlainObject(data) && !isDagJsonBytes(data) && !('/' in data)) {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, decodeSignerBytes(value, key)]))
  }
  return data
}

function readInspectIpfsPath(data: unknown, pathSegments: string[]): unknown {
  if (!pathSegments.length) return data

  return pathSegments.reduce<unknown>((currentValue, segment) => {
    if (Array.isArray(currentValue)) {
      const index = Number(segment)
      return Number.isInteger(index) ? currentValue[index] : undefined
    }
    if (typeof currentValue === 'object' && currentValue !== null) {
      return (currentValue as Record<string, unknown>)[segment]
    }
    return undefined
  }, data)
}

/**
 * What building-block actions the inspector offers for a blob: whether it can
 * be edited (a DAG-CBOR blob viewed at its root), whether the value is itself a
 * schema (→ "New Instance"), and whether it carries an attached schema link.
 * Pure so it can be unit-tested without rendering. Uses the RAW value.
 */
export function inspectorBlobActions(
  cid: string | undefined,
  rawValue: unknown,
  isTopLevel: boolean,
): {canEdit: boolean; valueIsSchema: boolean; hasAttachedSchema: boolean; attachedSchemaCid: string | undefined} {
  const isDagCbor = !!cid && parseCidString(cid)?.code === DAG_CBOR_CODE
  const valueIsSchema = isTopLevel && isOnyxSchema(rawValue)
  const schemaLink =
    isTopLevel && !valueIsSchema && !!rawValue && typeof rawValue === 'object'
      ? (rawValue as Record<string, unknown>).schema
      : undefined
  const attachedSchemaCid =
    isDagJsonLink(schemaLink) && parseCidString(schemaLink['/'])?.code === DAG_CBOR_CODE ? schemaLink['/'] : undefined
  return {
    canEdit: isTopLevel && !!isDagCbor,
    valueIsSchema,
    hasAttachedSchema: !!attachedSchemaCid,
    attachedSchemaCid,
  }
}

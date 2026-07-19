import {createInspectIpfsNavRoute, NavRoute, useCID} from '@shm/shared'
import {code as DAG_CBOR_CODE} from '@shm/shared/cbor'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useOpenUrl, useRouteLink, useUniversalClient} from '@shm/shared/routing'
import {useNavigate} from '@shm/shared/utils/navigation'
import {Check, FileEdit, MoreHorizontal, X} from 'lucide-react'
import {base58btc} from 'multiformats/bases/base58'
import {CID} from 'multiformats/cid'
import {type ReactNode, useEffect, useMemo, useState} from 'react'
import {Button} from './button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from './components/dropdown-menu'
import {Textarea} from './components/textarea'
import {isSchemaBlob} from './blob-schema'
import {base64ToBytes, isDagJsonBytes, isDagJsonLink, parseCidString} from './dag-json'
import {useFileProxyUrl, useImageUrl} from './get-file-url'
import {publishCborBlob, publishTextBlob} from './ipfs-publish'
import {Spinner} from './spinner'
import {toast} from './toast'
import {OmnibarUrl} from './url-omnibar'
import {CBOR_VALUE_RULES, isPlainObject, ValueDisplay, ValueEditor, ValueEditorProvider} from './value-editor'

type IpfsKind = 'loading' | 'image' | 'cbor' | 'text'

/** Sentinel `ipfsPath` that opens the viewer in "author a new object" mode. */
const NEW_IPFS_BLOB_PATH = 'new'

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
 * Dedicated IPFS file viewer/editor. Shows the read-only `ipfs://` URL in a
 * slim top bar with a copy action and a "…" menu. For DAG-CBOR blobs and plain
 * text files, the menu offers Edit — which turns the view into an unpublished
 * draft (the CID disappears) and lets you Publish a new blob with a new CID.
 */
export function InspectIpfsPage({
  ipfsPath,
  exitRoute,
  windowControls,
  trafficLightInset = false,
  gatewayUrl = DEFAULT_GATEWAY_URL,
}: {
  ipfsPath: string
  exitRoute?: NavRoute | null
  /** Retained for API compatibility; hm:// / ipfs:// links now route via the app openUrl. */
  getRouteForUrl?: (url: string) => NavRoute | string | null
  /** Desktop-only window controls (e.g. close button on non-macOS) shown at the far right. */
  windowControls?: ReactNode
  /** Reserve space at the left of the top bar for macOS traffic lights. */
  trafficLightInset?: boolean
  /** Gateway origin for the shareable `https://<gateway>/ipfs/<cid>` link. */
  gatewayUrl?: string
}) {
  const segments = ipfsPath.split('/').filter(Boolean)
  // `new` opens a draft: `new` alone is a blank object; `new/<cid>` forks an
  // existing blob into a draft (so "Edit" leaves the original window alone).
  const isDraft = segments[0] === NEW_IPFS_BLOB_PATH
  const forkCid = isDraft ? segments[1] : undefined
  const cid = isDraft ? undefined : segments[0]
  const pathSegments = isDraft ? [] : segments.slice(1)
  const hasSubpath = pathSegments.length > 0
  // The blob we fetch — to display (view) or to prefill the draft (fork).
  const contentCid = isDraft ? forkCid : cid
  const ipfsData = useCID(contentCid)
  const client = useUniversalClient()
  const replaceRoute = useNavigate('replace')
  const openUrl = useOpenUrl()

  // The CID's codec tells us definitively whether this is structured DAG-CBOR
  // (0x71) or a raw UnixFS file (dag-pb / raw) — an image or plain text.
  const codec = useMemo(() => {
    try {
      return CID.parse(contentCid!).code
    } catch {
      return null
    }
  }, [contentCid])
  const isDagCbor = codec === DAG_CBOR_CODE
  const isFile = codec != null && !isDagCbor

  const getImageUrl = useImageUrl()
  const imageUrl = !isDraft && isFile && !hasSubpath && contentCid ? getImageUrl(`ipfs://${contentCid}`) : ''
  const isImage = useIsLoadableImage(imageUrl)

  // Proxy URL (/hm/api/file/<cid>) on web so text fetches don't hit a localhost
  // daemon URL; falls back to the direct daemon URL on desktop.
  const getFileUrl = useFileProxyUrl()

  const preparedData = useMemo(() => {
    if (ipfsData.data?.value === undefined) return null
    // Keep IPLD links/bytes in their DAG-JSON shape so ValueDisplay renders them
    // like the editor; only decode `signer` bytes to a readable hm:// principal.
    return readInspectIpfsPath(decodeSignerBytes(ipfsData.data.value), pathSegments)
  }, [ipfsData.data?.value, pathSegments])

  // Resolve what kind of content this is.
  let kind: IpfsKind
  if (isDraft && !forkCid) {
    kind = 'cbor' // brand-new empty object
  } else if (hasSubpath || isDagCbor) {
    kind = ipfsData.isLoading ? 'loading' : 'cbor'
  } else if (isFile) {
    kind = isImage === null ? 'loading' : isImage ? 'image' : 'text'
  } else {
    kind = ipfsData.isLoading ? 'loading' : ipfsData.data?.value != null ? 'cbor' : 'text'
  }

  const textUrl = kind === 'text' && !hasSubpath && contentCid ? getFileUrl(`ipfs://${contentCid}`) : ''
  const {text: rawText, loading: textLoading} = useIpfsText(textUrl)

  // "Edit" is offered on an editable view (not already a draft, not a sub-path).
  const canEdit = !isDraft && !hasSubpath && (kind === 'cbor' || kind === 'text')

  // Edit/draft state. A draft window opens straight into edit mode; a fork
  // prefills from the source blob once it loads.
  const [mode, setMode] = useState<'view' | 'edit'>(isDraft ? 'edit' : 'view')
  const [editJson, setEditJson] = useState<unknown>(isDraft && !forkCid ? {} : undefined)
  const [editText, setEditText] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  useEffect(() => {
    setMode(isDraft ? 'edit' : 'view')
    setEditJson(isDraft && !forkCid ? {} : undefined)
    setEditText(null)
    setPublishing(false)
  }, [ipfsPath, isDraft, forkCid])

  // Fork: seed the draft from the source blob once it has loaded (only if the
  // user hasn't started editing yet).
  useEffect(() => {
    if (!isDraft || !forkCid) return
    if (kind === 'cbor' && ipfsData.data?.value !== undefined) {
      setEditJson((cur: unknown) => (cur === undefined ? ipfsData.data!.value : cur))
    } else if (kind === 'text' && rawText != null) {
      setEditText((cur) => (cur === null ? rawText : cur))
    }
  }, [isDraft, forkCid, kind, ipfsData.data?.value, rawText])

  // "Edit" forks the blob into a draft in a NEW window, leaving this one alone.
  const editInNewWindow = () => {
    if (cid) openUrl(`hm://inspect/ipfs/${NEW_IPFS_BLOB_PATH}/${cid}`, true)
  }

  // Open a linked IPFS blob (from a native IPLD link) in its own new window.
  const openLinkedBlob = (linkCid: string) => openUrl(`hm://inspect/ipfs/${linkCid}`, true)
  // Open an hm:// reference (e.g. a decoded signer) in a new window.
  const openInNewWindow = (url: string) => openUrl(url, true)

  const publish = async () => {
    setPublishing(true)
    try {
      const newCid =
        kind === 'text' ? await publishTextBlob(client, editText ?? '') : await publishCborBlob(client, editJson)
      toast.success('Published a new blob')
      setMode('view')
      replaceRoute(createInspectIpfsNavRoute(newCid))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to publish')
    } finally {
      setPublishing(false)
    }
  }

  const gatewayLink = `${gatewayUrl.replace(/\/+$/, '')}/ipfs/${ipfsPath}`
  const exitLinkProps = useRouteLink(exitRoute || null)

  let body: ReactNode
  if (mode === 'edit' && kind === 'cbor') {
    // A fork is still loading its source until editJson is seeded.
    body =
      editJson === undefined ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <ValueEditorProvider openFile={openLinkedBlob}>
          <ValueEditor value={editJson} onValue={setEditJson} rules={CBOR_VALUE_RULES} />
        </ValueEditorProvider>
      )
  } else if (mode === 'edit' && kind === 'text') {
    body =
      editText === null && forkCid ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : (
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
  } else {
    // Render the published blob with the editor's own value renderer so the view
    // matches the editor (native IPLD links show as tags, opening in a new window).
    body = (
      <ValueEditorProvider openFile={openLinkedBlob} openUrl={openInNewWindow}>
        <ValueDisplay value={preparedData} rules={CBOR_VALUE_RULES} />
      </ValueEditorProvider>
    )
  }

  return (
    <div className="bg-background flex h-full max-h-full flex-col overflow-hidden">
      <IpfsTopBar
        restingUrl={`ipfs://${ipfsPath}`}
        gatewayLink={gatewayLink}
        editing={mode === 'edit'}
        canEdit={canEdit}
        publishing={publishing}
        onEdit={editInNewWindow}
        onPublish={publish}
        exitRoute={exitRoute}
        exitLinkProps={exitLinkProps}
        windowControls={windowControls}
        trafficLightInset={trafficLightInset}
      />
      <div className="flex-1 overflow-y-auto bg-zinc-100">
        <div className="mx-auto w-full px-4 py-4" style={{maxWidth: 960}}>
          <div className="flex flex-col gap-4">{body}</div>
        </div>
      </div>
    </div>
  )
}

/** The slim, non-editable top bar: omnibar-style URL + copy + "…" menu, or draft controls. */
function IpfsTopBar({
  restingUrl,
  gatewayLink,
  editing,
  canEdit,
  publishing,
  onEdit,
  onPublish,
  exitRoute,
  exitLinkProps,
  windowControls,
  trafficLightInset,
}: {
  restingUrl: string
  gatewayLink: string
  editing: boolean
  canEdit: boolean
  publishing: boolean
  onEdit: () => void
  onPublish: () => void
  exitRoute?: NavRoute | null
  exitLinkProps: ReturnType<typeof useRouteLink>
  windowControls?: ReactNode
  trafficLightInset?: boolean
}) {
  // Only surface the "…" menu when it would contain at least one action.
  const hasMenu = canEdit || !!exitRoute
  const menu = hasMenu ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="iconSm" aria-label="More actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit && (
          <DropdownMenuItem onSelect={onEdit}>
            <FileEdit className="size-4" />
            Edit...
          </DropdownMenuItem>
        )}
        {exitRoute && (
          <DropdownMenuItem asChild>
            <a {...exitLinkProps}>
              <X className="size-4" />
              Open Resource
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined

  return (
    <div
      className="window-drag border-border bg-background flex h-11 shrink-0 items-center gap-2 border-b px-3"
      style={trafficLightInset ? {paddingLeft: 78} : undefined}
    >
      {editing ? (
        <>
          <span className="bg-muted text-muted-foreground no-window-drag rounded px-2 py-0.5 text-xs font-medium">
            Unpublished draft
          </span>
          <div className="flex-1" />
          <div className="no-window-drag flex items-center gap-2">
            <Button size="sm" onClick={onPublish} disabled={publishing}>
              {publishing ? <Spinner className="size-4" /> : <Check className="size-4" />}
              Publish
            </Button>
          </div>
        </>
      ) : (
        <OmnibarUrl restingUrl={restingUrl} copyUrl={gatewayLink} rightActions={menu} />
      )}
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
 * open in the schema/blob editor (a DAG-CBOR blob viewed at its root), whether
 * the value is itself a schema (→ "New Instance"), and whether it carries an
 * attached schema link. Pure so it can be unit-tested without rendering, and
 * reused by the standalone explorer app. Uses the RAW value, before
 * cleanInspectIpfsData rewrites `{"/":cid}` links to `ipfs://` strings.
 */
export function inspectorBlobActions(
  cid: string | undefined,
  rawValue: unknown,
  isTopLevel: boolean,
): {canEdit: boolean; valueIsSchema: boolean; hasAttachedSchema: boolean; attachedSchemaCid: string | undefined} {
  const isDagCbor = !!cid && parseCidString(cid)?.code === DAG_CBOR_CODE
  const valueIsSchema = isTopLevel && isSchemaBlob(rawValue)
  // A non-schema instance's `schema` link, when it's a DAG-CBOR CID we could
  // fetch and validate against. (A schema blob's own `schema` link points at the
  // meta-schema — that's `valueIsSchema`, handled separately, not validated here.)
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

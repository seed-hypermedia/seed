import * as cbor from '@ipld/dag-cbor'
import {useUniversalClient} from '@shm/shared'
import {useCID} from '@shm/shared/models/entity'
import {createInspectIpfsNavRoute} from '@shm/shared/routes'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {ipfsUrlToRoute} from '@/omnibar-url'
import {Button} from '@shm/ui/button'
import {Textarea} from '@shm/ui/components/textarea'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {dagJsonToIpld} from '@shm/ui/dag-json'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {CBOR_VALUE_RULES, useValueHistory, ValueEditor, ValueEditorProvider} from '@shm/ui/value-editor'
import {Braces, Check, Copy, Search, UploadCloud} from 'lucide-react'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {useEffect, useMemo, useState} from 'react'

/** Multicodec code for DAG-CBOR, the only codec this editor can decode/encode. */
const DAG_CBOR_CODE = 0x71

/** Full-page GUI editor for raw DAG-CBOR IPFS blobs. */
export default function RawBlobPage() {
  const route = useNavRoute()
  if (route.key !== 'raw-blob') {
    throw new Error(`RawBlobPage: unsupported route ${route.key}`)
  }
  return (
    <div className="relative h-full max-h-full overflow-hidden rounded-lg border bg-white dark:bg-black">
      {route.cid ? <ExistingBlobEditor key={route.cid} cid={route.cid} /> : <BlobEditor initialValue={{}} />}
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
 */
function BlobEditor({cid, initialValue}: {cid?: string; initialValue: unknown}) {
  const client = useUniversalClient()
  const navigate = useNavigate()
  const replace = useNavigate('replace')
  const [value, setValue] = useState<unknown>(initialValue)
  const [jsonMode, setJsonMode] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)

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
      await client.request('PublishBlobs', {blobs: [{cid: newCid, data}]})
      toast.success(`Published ipfs://${newCid}`)
      replace({key: 'raw-blob', cid: newCid})
    } catch (e) {
      toast.error(`Failed to publish blob: ${e instanceof Error ? e.message : String(e)}`)
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

  return (
    <ValueEditorProvider
      onUndo={handleUndo}
      onRedo={handleRedo}
      openUrl={(url) => {
        const route = ipfsUrlToRoute(url)
        if (route) navigate(route)
      }}
    >
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
              New blob — publish to encode as DAG-CBOR and store it on your IPFS node.
            </p>
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
          ) : (
            <ValueEditor value={value} onValue={update} rules={CBOR_VALUE_RULES} />
          )}
        </div>
      </div>
    </ValueEditorProvider>
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

import * as cbor from '@ipld/dag-cbor'
import {useUniversalClient} from '@shm/shared'
import {useCID} from '@shm/shared/models/entity'
import {createInspectIpfsNavRoute} from '@shm/shared/routes'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {Textarea} from '@shm/ui/components/textarea'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {Check, Copy, Search, UploadCloud, WrapText} from 'lucide-react'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {useMemo, useState} from 'react'

/** Multicodec code for DAG-CBOR, the only codec this editor can decode/encode. */
const DAG_CBOR_CODE = 0x71

/** Full-page JSON editor for raw DAG-CBOR IPFS blobs. */
export default function RawBlobPage() {
  const route = useNavRoute()
  if (route.key !== 'raw-blob') {
    throw new Error(`RawBlobPage: unsupported route ${route.key}`)
  }
  return (
    <div className="flex h-full flex-col overflow-y-auto rounded-lg border bg-white dark:bg-black">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-8">
        {route.cid ? <ExistingBlobEditor key={route.cid} cid={route.cid} /> : <BlobEditor initialText={'{\n  \n}'} />}
      </div>
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
    return <BlobNotice cid={cid} message="This is not a valid IPFS CID." />
  }
  if (codecCheck === 'other') {
    return (
      <>
        <BlobNotice cid={cid} message="This blob is not DAG-CBOR data, so it cannot be edited as JSON." />
        <div>
          <Button variant="secondary" onClick={() => navigate(createInspectIpfsNavRoute(cid))}>
            <Search className="size-4" />
            Open in Inspector
          </Button>
        </div>
      </>
    )
  }
  if (blob.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  }
  if (blob.isError || blob.data?.value === undefined) {
    return <BlobNotice cid={cid} message="This blob could not be loaded or decoded from the local IPFS store." />
  }
  return <BlobEditor cid={cid} initialText={JSON.stringify(blob.data.value, null, 2)} />
}

function BlobNotice({cid, message}: {cid: string; message: string}) {
  return (
    <>
      <BlobHeader cid={cid} />
      <p className="text-muted-foreground text-sm">{message}</p>
    </>
  )
}

function BlobHeader({cid}: {cid?: string}) {
  const url = cid ? `ipfs://${cid}` : null
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-2xl font-bold">Blob Editor</h2>
      {url ? (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground truncate font-mono text-sm">{url}</span>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Copy ipfs URL"
            onClick={() => {
              copyTextToClipboard(url)
              toast.success('Copied ipfs:// URL')
            }}
          >
            <Copy className="size-3.5" />
          </Button>
        </div>
      ) : (
        <span className="text-muted-foreground text-sm">
          Unpublished — publish to encode this JSON as DAG-CBOR and store it on your IPFS node.
        </span>
      )}
    </div>
  )
}

/**
 * The JSON editor. Publishing encodes the value as canonical DAG-CBOR,
 * computes the CIDv1 (sha2-256), stores it via PublishBlobs, and replaces the
 * route with the new CID. Blobs are immutable: editing a published blob and
 * publishing again creates a new blob with a new CID.
 */
function BlobEditor({cid, initialText}: {cid?: string; initialText: string}) {
  const client = useUniversalClient()
  const replace = useNavigate('replace')
  const [text, setText] = useState(initialText)
  const [isPublishing, setIsPublishing] = useState(false)

  const validation = useMemo(() => {
    try {
      return {value: JSON.parse(text) as unknown}
    } catch (e) {
      return {error: e instanceof Error ? e.message : 'Invalid JSON'}
    }
  }, [text])

  const isDirty = text !== initialText
  const canPublish = 'value' in validation && (!cid || isDirty) && !isPublishing

  const publish = async () => {
    if (!('value' in validation)) return
    setIsPublishing(true)
    try {
      const data = cbor.encode(validation.value)
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

  const format = () => {
    if ('value' in validation) setText(JSON.stringify(validation.value, null, 2))
  }

  return (
    <>
      <BlobHeader cid={cid} />
      <Textarea
        value={text}
        rows={Math.max(12, Math.min(36, text.split('\n').length + 1))}
        spellCheck={false}
        autoFocus={!cid}
        className={cn('font-mono text-sm', 'error' in validation && 'border-destructive')}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex min-h-8 items-center gap-2">
        <Button variant="default" size="sm" disabled={!canPublish} onClick={publish}>
          {isPublishing ? <Spinner className="size-4" /> : <UploadCloud className="size-4" />}
          Publish to IPFS
        </Button>
        <Button variant="ghost" size="sm" disabled={!('value' in validation)} onClick={format}>
          <WrapText className="size-4" />
          Format
        </Button>
        {cid && isDirty && (
          <Button variant="ghost" size="sm" onClick={() => setText(initialText)}>
            Reset
          </Button>
        )}
        {'error' in validation ? (
          <p className="text-destructive text-xs">{validation.error}</p>
        ) : cid && !isDirty ? (
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <Check className="size-3" />
            Published — edits create a new blob with a new CID
          </p>
        ) : null}
      </div>
    </>
  )
}

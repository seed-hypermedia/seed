// "Create a signed blob": the form for a signed-blob type (built-in or
// user-defined), signing with the current account. The envelope (signer, sig,
// ts) and a pinned `type` tag are never typed — they're shown as what WILL be
// filled at signing time, and filled by signBlob() on publish.
import {useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {useStream} from '@shm/shared/use-stream'
import {useNavigate} from '@shm/shared/utils/navigation'
import {KeyRound, ShieldCheck} from 'lucide-react'
import {useState} from 'react'
import {Button} from '../button'
import {toast} from '../toast'
import {OnyxDataEditor, seedValue} from './onyx-data-editor'
import {validate, type OnyxSchema} from './onyx-engine'
import {publishSignedBlob, signedBlobTypeTag, stripSignedBlobEnvelope} from './signed-blob'

/** The account that will sign, and its signer, when the platform can sign. */
export function useSigningAccount(): {
  accountUid: string | null
  signer: ReturnType<NonNullable<ReturnType<typeof useUniversalClient>['getSigner']>> | null
} {
  const client = useUniversalClient()
  const {selectedIdentity} = useUniversalAppContext()
  const accountUid = useStream(selectedIdentity) ?? null
  const signer = accountUid && client.getSigner ? client.getSigner(accountUid) : null
  return {accountUid, signer}
}

export function SignedBlobCreator({schema, typeName}: {schema: OnyxSchema; typeName: string}) {
  const client = useUniversalClient()
  const navigate = useNavigate()
  const {accountUid, signer} = useSigningAccount()
  const bodySchema = stripSignedBlobEnvelope(schema)
  const typeTag = signedBlobTypeTag(schema)
  const [value, setValue] = useState<unknown>(() => seedValue(bodySchema))
  const [publishing, setPublishing] = useState(false)
  const [published, setPublished] = useState<{cid: string; ts: number} | null>(null)
  const errors = validate(bodySchema, value)
  const canSign = !!signer && !!accountUid

  const publish = async () => {
    if (!signer || !value || typeof value !== 'object') return
    setPublishing(true)
    try {
      const result = await publishSignedBlob(client, signer, value as Record<string, unknown>, {typeTag})
      setPublished({cid: result.cid, ts: result.ts})
      toast.success(`Signed and published a new ${typeName}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to publish')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="signed-blob-creator">
      <div className="bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-2 text-xs">
        <span className="inline-flex items-center gap-1 font-medium">
          <ShieldCheck className="size-3.5" /> Signed blob
        </span>
        {typeTag && (
          <span>
            type <code className="bg-muted rounded px-1">{typeTag}</code>
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <KeyRound className="size-3.5" /> signer{' '}
          {accountUid ? (
            <code className="bg-muted rounded px-1" data-testid="signed-blob-signer">
              {accountUid.slice(0, 10)}…
            </code>
          ) : (
            <span className="text-destructive">no account selected</span>
          )}
        </span>
        <span className="text-muted-foreground">ts and sig are set when you sign</span>
      </div>
      {!canSign && (
        <p className="text-destructive text-sm">
          Signing needs an account this app can sign for — select one (desktop) to create signed blobs.
        </p>
      )}
      <OnyxDataEditor schema={bodySchema} value={value} onValue={setValue} />
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span className={errors.length ? 'text-destructive text-sm' : 'text-sm text-green-600'}>
          {errors.length ? `${errors.length} issue${errors.length > 1 ? 's' : ''} to resolve` : '✓ valid'}
        </span>
        <Button
          size="sm"
          onClick={publish}
          disabled={publishing || !canSign || errors.length > 0}
          data-testid="signed-blob-publish"
        >
          {publishing ? 'Signing…' : 'Sign & publish'}
        </Button>
      </div>
      {published && (
        <div className="rounded-md border border-green-500/40 bg-green-500/5 p-2 text-xs">
          <div className="font-mono">Published: ipfs://{published.cid}</div>
          <button
            type="button"
            className="text-primary mt-1 underline"
            onClick={() => navigate({key: 'inspect-ipfs', ipfsPath: published.cid})}
          >
            Inspect the signed blob
          </button>
        </div>
      )}
    </div>
  )
}

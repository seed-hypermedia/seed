import * as authSession from '@/auth-session'
import {
  AUTH_STATE_ACTIVE_VAULT_URL,
  AUTH_STATE_DELEGATION_RETURN_URL,
  AUTH_STATE_DELEGATION_VAULT_URL,
  deleteAuthState,
  getAuthState,
  setAuthState,
  writeLocalKeys,
} from '@/local-db'
import {processPendingIntent} from '@/pending-intent'
import {webUniversalClient} from '@/universal-client'
import {useNavigate} from '@remix-run/react'
import {createSeedClient} from '@seed-hypermedia/client'
import {useUniversalAppContext} from '@shm/shared'
import * as blobs from '@shm/shared/blobs'
import {WEB_IDENTITY_ORIGIN} from '@shm/shared/constants'
import {Button} from '@shm/ui/button'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {XCircle} from 'lucide-react'
import {useEffect, useState} from 'react'

export default function AuthCallbackRoute() {
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const {origin, originHomeId} = useUniversalAppContext()

  useEffect(() => {
    async function handleAuth() {
      const vaultUrl = (await getAuthState(AUTH_STATE_DELEGATION_VAULT_URL)) || `${origin}/vault/delegate`
      const returnUrl = (await getAuthState(AUTH_STATE_DELEGATION_RETURN_URL)) || '/'

      try {
        const result = await authSession.handleCallback({vaultUrl})
        if (!result) {
          setError('No authentication data received.')
          return
        }

        // handleCallback already verified signatures, coherence, and built EncodedBlobs.

        // Build the session Signer for creating reverse blobs.
        const sessionSigner = new blobs.WebCryptoKeyPair(result.session.keyPair, result.session.publicKeyRaw)

        const accountPrincipal = blobs.principalFromString(result.accountPrincipal)
        const ts = Date.now()

        // Reverse Capability: session key delegates to vault account.
        const reverseCap = await blobs.createCapability(sessionSigner, accountPrincipal, 'AGENT', ts)

        // Reverse Profile: session key aliases to vault account.
        const reverseProf = await blobs.createProfileAlias(sessionSigner, accountPrincipal, ts)

        const publishBlobs = [
          {cid: result.capability.cid.toString(), data: result.capability.data},
          {cid: reverseCap.cid.toString(), data: reverseCap.data},
          {cid: reverseProf.cid.toString(), data: reverseProf.data},
        ]

        console.log('[auth-callback] Publishing delegation blobs via client.publish', {
          blobCids: publishBlobs.map((b) => b.cid),
          account: result.accountPrincipal,
        })

        // Dual-origin persistence.
        const uploadPromises: Promise<unknown>[] = []

        // 1. Current origin (must succeed).
        uploadPromises.push(
          webUniversalClient.publish({blobs: publishBlobs}).then((res) => {
            console.log('[auth-callback] Published delegation blobs to current origin', res)
            return res
          }),
        )

        // 2. Identity origin (failure is non-fatal).
        if (WEB_IDENTITY_ORIGIN && WEB_IDENTITY_ORIGIN !== origin) {
          uploadPromises.push(
            createSeedClient(WEB_IDENTITY_ORIGIN)
              .publish({blobs: publishBlobs})
              .then((res) => {
                console.log('[auth-callback] Published delegation blobs to identity origin', res)
                return res
              })
              .catch((e) => {
                console.warn('Identity origin save failed, continuing anyway', e)
              }),
          )
        }

        await Promise.all(uploadPromises)

        // Store the session key pair as the active local keys and mark as delegated.
        await writeLocalKeys(sessionSigner.keyPair)
        await setAuthState(AUTH_STATE_ACTIVE_VAULT_URL, vaultUrl)

        // Cleanup delegation markers.
        await deleteAuthState(AUTH_STATE_DELEGATION_VAULT_URL)
        await deleteAuthState(AUTH_STATE_DELEGATION_RETURN_URL)

        // Process any pending intent (comment or join) saved before vault redirect.
        const commentUrl = await processPendingIntent(originHomeId)

        toast.success('Signed in successfully')
        navigate(commentUrl || returnUrl, {replace: true})
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        authSession.clearSession(vaultUrl).catch(console.error)
        deleteAuthState(AUTH_STATE_DELEGATION_VAULT_URL).catch(console.error)
        deleteAuthState(AUTH_STATE_DELEGATION_RETURN_URL).catch(console.error)
      }
    }

    handleAuth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, navigate])

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      {error ? (
        <div className="bg-card text-card-foreground flex w-full max-w-sm flex-col items-center gap-6 rounded-xl border p-8 shadow-sm">
          <div className="flex size-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <XCircle className="size-6 text-red-600 dark:text-red-400" />
          </div>
          <div className="space-y-2 text-center">
            <SizableText size="lg" weight="bold">
              Authentication Failed
            </SizableText>
            <SizableText color="muted" size="sm">
              {error}
            </SizableText>
          </div>
          <div className="flex w-full flex-col gap-2">
            <Button onClick={() => navigate('/', {replace: true})} className="w-full">
              Return Home
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()} className="w-full">
              Try Again
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          <Spinner />
          <SizableText>Securing your identity session...</SizableText>
        </div>
      )}
    </div>
  )
}

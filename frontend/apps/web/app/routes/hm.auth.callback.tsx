import {cborEncode} from '@/api'
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
import {useNavigate} from '@remix-run/react'
import {useUniversalAppContext} from '@shm/shared'
import * as blobs from '@shm/shared/blobs'
import {WEB_IDENTITY_ORIGIN} from '@shm/shared/constants'
import {Button} from '@shm/ui/button'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useEffect, useState} from 'react'
import type {UploadDelegationPayload} from './hm.api.upload-delegation'

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

        const payload: UploadDelegationPayload = {
          vaultCapability: {
            cid: result.capability.cid,
            decoded: result.capability.decoded,
          },
          vaultProfile: {
            cid: result.profile.cid,
            decoded: result.profile.decoded,
          },
          reverseCapability: {
            cid: reverseCap.cid,
            decoded: reverseCap.decoded,
          },
          reverseProfile: {
            cid: reverseProf.cid,
            decoded: reverseProf.decoded,
          },
        }

        const cborBody = new Uint8Array(cborEncode(payload))

        // Dual-origin persistence.
        const uploadPromises = []

        // 1. Current origin (must succeed).
        uploadPromises.push(
          fetch('/hm/api/upload-delegation', {
            method: 'POST',
            body: cborBody,
            headers: {'Content-Type': 'application/cbor'},
          }).then((res) => {
            if (!res.ok) throw new Error('Failed to save delegation to current site')
          }),
        )

        // 2. Identity origin (failure is non-fatal).
        if (WEB_IDENTITY_ORIGIN && WEB_IDENTITY_ORIGIN !== origin) {
          uploadPromises.push(
            fetch(`${WEB_IDENTITY_ORIGIN}/hm/api/upload-delegation`, {
              method: 'POST',
              body: cborBody,
              headers: {'Content-Type': 'application/cbor'},
            })
              .then((res) => {
                if (!res.ok) throw new Error('Failed to save delegation to identity origin')
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
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <SizableText size="lg" weight="bold" className="text-red-500">
            Authentication Failed
          </SizableText>
          <SizableText color="muted">{error}</SizableText>
          <Button onClick={() => navigate('/', {replace: true})}>Return Home</Button>
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

import type {ModelProviderType} from './client'
import {
  useCancelProviderOAuth,
  useProviderOAuthStatus,
  useStartProviderOAuth,
  useSubmitProviderOAuthCode,
} from './models'
import {useOpenUrl} from './navigation'
import {getAgentsPlatform} from './platform'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {CheckCircle2, ExternalLink} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {PROVIDER_METADATA} from './provider-registry'

/**
 * Drives a subscription OAuth sign-in ("Sign in with ChatGPT") against the
 * agent server: starts the flow, opens the provider's authorization page in the
 * system browser, and polls for completion. The OAuth client redirects to
 * `localhost:1455` — this machine, not the (possibly remote) agent server — so
 * the desktop main process listens there, catches the redirect, and this
 * component forwards it to the server via `SubmitProviderOAuthCode`. A
 * paste-the-redirect-URL fallback covers the port being taken.
 *
 * Calls `onConnected` with the server-side credentials secret name once the
 * sign-in completes.
 */
export function SubscriptionSignIn({
  serverUrl,
  selectedAccountId,
  providerType,
  connectedSecretName,
  onConnected,
}: {
  serverUrl: string
  selectedAccountId: string | null | undefined
  providerType: ModelProviderType
  /** Set when credentials are already connected; renders the success state with a re-login option. */
  connectedSecretName?: string
  onConnected: (secretName: string) => void
}) {
  const startOAuth = useStartProviderOAuth(serverUrl, selectedAccountId)
  const submitCode = useSubmitProviderOAuthCode(serverUrl, selectedAccountId)
  const cancelOAuth = useCancelProviderOAuth(serverUrl, selectedAccountId)
  const [login, setLogin] = useState<{loginId: string; authUrl: string} | null>(null)
  const [pastedCode, setPastedCode] = useState('')
  const status = useProviderOAuthStatus(serverUrl, selectedAccountId, login?.loginId)
  const openUrl = useOpenUrl()
  const redirectCatcher = getAgentsPlatform().oauthRedirectCatcher
  const subscription = PROVIDER_METADATA[providerType].subscription

  const notifiedSecretRef = useRef<string | null>(null)
  useEffect(() => {
    const data = status.data
    if (!data || data.status !== 'completed' || !data.secretName) return
    if (notifiedSecretRef.current === data.loginId) return
    notifiedSecretRef.current = data.loginId
    // Fresh credentials also clear any needs-login badge in provider listings.
    invalidateQueries(['agents', 'providers'])
    onConnected(data.secretName)
  }, [status.data, onConnected])

  // While a sign-in is pending, poll the main process for the browser redirect
  // it caught on localhost:1455 and forward it to the agent server. The
  // submittedRef guards against re-submitting the same redirect across polls.
  const pending = Boolean(login) && (!status.data || status.data.status === 'pending')
  const submittedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!pending || !login || !redirectCatcher) return
    const interval = setInterval(async () => {
      try {
        const captured = await redirectCatcher.captured()
        if (!captured.url || submittedRef.current === captured.url) return
        submittedRef.current = captured.url
        await submitCode.mutateAsync({loginId: login.loginId, code: captured.url})
        void redirectCatcher.stop()
      } catch {
        // Poll again; persistent failures surface through the server-side status.
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [pending, login?.loginId])

  // The listener must not outlive the sign-in UI.
  useEffect(() => {
    if (pending) return
    void redirectCatcher?.stop()
  }, [pending])
  useEffect(() => () => void redirectCatcher?.stop(), [])

  if (!subscription) return null

  async function handleStart() {
    try {
      const started = await startOAuth.mutateAsync(providerType)
      setPastedCode('')
      submittedRef.current = null
      // Only accept the redirect belonging to this login; the state param ties them together.
      const state = new URL(started.authUrl).searchParams.get('state')
      await redirectCatcher?.start(state).catch(() => ({listening: false}))
      setLogin({loginId: started.loginId, authUrl: started.authUrl})
      openUrl(started.authUrl)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start the sign-in')
    }
  }

  async function handleSubmitCode() {
    if (!login) return
    try {
      await submitCode.mutateAsync({loginId: login.loginId, code: pastedCode})
      setPastedCode('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not submit the code')
    }
  }

  function handleCancel() {
    if (login) void cancelOAuth.mutateAsync(login.loginId).catch(() => {})
    setLogin(null)
  }

  const currentStatus = login ? status.data?.status : undefined

  if (currentStatus === 'completed' || (connectedSecretName && !login)) {
    return (
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-green-600" />
        <SizableText size="sm">Account connected.</SizableText>
        <Button type="button" variant="ghost" size="sm" onClick={() => void handleStart()}>
          Sign in again
        </Button>
      </div>
    )
  }

  if (currentStatus === 'pending') {
    return (
      <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <Spinner className="size-4" />
          <SizableText size="sm">Complete the sign-in in your browser…</SizableText>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => login && openUrl(login.authUrl)}>
          <ExternalLink className="size-4" />
          Reopen sign-in page
        </Button>
        <div className="flex flex-col gap-1">
          <SizableText size="sm" color="muted">
            Sign-in should finish here automatically. If your browser shows a “can’t connect” page instead, paste that
            page's full URL or the code here:
          </SizableText>
          <div className="flex gap-2">
            <Input
              value={pastedCode}
              onChange={(event) => setPastedCode(event.target.value)}
              placeholder="http://localhost:1455/auth/callback?code=…"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!pastedCode.trim() || submitCode.isLoading}
              onClick={() => void handleSubmitCode()}
            >
              Submit
            </Button>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={handleCancel}>
            Cancel sign-in
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <SizableText size="sm" color="muted">
        {subscription.description}
      </SizableText>
      {currentStatus === 'failed' ? (
        <SizableText size="sm" className="text-destructive">
          Sign-in failed: {status.data?.error ?? 'unknown error'}
        </SizableText>
      ) : null}
      <div>
        <Button type="button" disabled={startOAuth.isLoading} onClick={() => void handleStart()}>
          {startOAuth.isLoading ? <Spinner className="size-4" /> : null}
          {currentStatus === 'failed' ? 'Try again' : subscription.signInLabel}
        </Button>
      </div>
    </div>
  )
}

import {logout, redirectToVaultSignIn, useLocalKeyPair, useLocalKeyPairLoaded} from '@/auth'
import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {loadSiteHeaderData} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {getOptimizedImageUrl} from '@/providers'
import {parseRequest} from '@/request'
import {markInviteJoin} from '@/invite-join'
import {safeNextPath, signInUrl} from '@/require-sign-in'
import {ensureDaemonAuth} from '@/universal-client'
import {json, LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {useLoaderData, useSearchParams} from '@remix-run/react'
import {hostnameStripProtocol} from '@shm/shared'
import {WEB_IDENTITY_ORIGIN} from '@shm/shared/constants'
import {Button} from '@shm/ui/button'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {useEffect, useState} from 'react'

export const meta: MetaFunction<typeof loader> = ({data}) => {
  const homeIcon = data?.siteIcon ? getOptimizedImageUrl(extractIpfsUrlCid(data.siteIcon), 'S') : null
  return [
    {title: `Sign in to ${data?.siteName || 'this site'}`},
    {tagName: 'link', rel: 'icon', href: homeIcon || defaultSiteIcon, type: 'image/png'},
  ]
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const authToken = await getDaemonAuthToken(request)
  return withDaemonAuthToken(authToken, async () => {
    const {homeMetadata, origin} = await loadSiteHeaderData(parsedRequest)
    return json({
      siteName: homeMetadata?.name || hostnameStripProtocol(origin),
      siteIcon: homeMetadata?.icon || null,
    })
  })
}

export default function SignInPage() {
  const {siteName} = useLoaderData<typeof loader>()
  const [searchParams] = useSearchParams()
  const next = safeNextPath(searchParams.get('next'))
  // An invitation link (invite-only vault): the vault creates the account for
  // this email and completes the same delegation, so the person ends up here
  // signed in rather than parked in the vault.
  const invite = searchParams.get('invite')?.trim() || undefined
  const inviteEmail = searchParams.get('email')?.trim() || undefined
  const keyPair = useLocalKeyPair()
  const keyPairLoaded = useLocalKeyPairLoaded()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoStarted, setAutoStarted] = useState(false)

  // A browser that already holds a local identity only needs the daemon cookie
  // before the gate lets it through, so wait for that and then leave. A full
  // navigation (not a client transition) is what carries the cookie past the
  // document gate.
  useEffect(() => {
    if (!keyPairLoaded || !keyPair) return
    let cancelled = false
    ensureDaemonAuth()
      .then(() => {
        if (!cancelled) window.location.replace(next)
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Site session could not be established', e)
        const message = e instanceof Error ? e.message : String(e)
        setError(
          message.includes(' 403 ')
            ? 'This account is not a member of this site. Sign in with a member account.'
            : 'Your saved sign-in no longer works here. Please sign in again.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [keyPairLoaded, keyPair, next])

  async function signIn() {
    setBusy(true)
    setError(null)
    try {
      // A stale local identity that the daemon rejected must not be reused.
      if (keyPair) await logout()
      // An invited person becomes a member on arrival; the site header joins
      // the site for them once the delegation is back.
      if (invite) markInviteJoin()
      const origin = window.location.origin
      // Come back here rather than straight to `next`: this page waits for the
      // session cookie before the full navigation the proxy gate checks, so a
      // fast callback cannot race the cookie and land on a 401.
      await redirectToVaultSignIn({
        origin,
        siteName,
        vaultUrl: `${WEB_IDENTITY_ORIGIN || origin}/vault/delegate`,
        returnUrl: signInUrl(next),
        invite,
        email: inviteEmail,
      })
    } catch (e) {
      console.error('Failed to start sign-in', e)
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  // An invitation needs no button: go straight to the vault to create the account.
  useEffect(() => {
    if (!invite || autoStarted || !keyPairLoaded || keyPair) return
    setAutoStarted(true)
    void signIn()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite, autoStarted, keyPairLoaded, keyPair])

  const waitingOnSession = !keyPairLoaded || (!!keyPair && !error) || (!!invite && busy && !error)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="bg-card text-card-foreground flex w-full max-w-sm flex-col items-center gap-6 rounded-xl border p-8 shadow-sm">
        <div className="flex flex-col gap-2 text-center">
          <SizableText size="xl" weight="bold">
            {invite ? `Join ${siteName}` : `Sign in to ${siteName}`}
          </SizableText>
          <SizableText color="muted" size="sm">
            {invite
              ? `Setting up your account${inviteEmail ? ` for ${inviteEmail}` : ''}…`
              : 'This site is only available to signed-in members.'}
          </SizableText>
        </div>
        {error ? (
          <SizableText color="destructive" size="sm" className="text-center">
            {error}
          </SizableText>
        ) : null}
        {waitingOnSession ? (
          <Spinner />
        ) : (
          <Button onClick={signIn} loading={busy} disabled={busy} className="w-full">
            {invite ? 'Set up your account' : 'Sign in'}
          </Button>
        )}
      </div>
    </div>
  )
}

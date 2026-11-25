import {useLocalKeyPair, useLocalKeyPairLoaded} from '@/auth'
import {useHostSession, type HostedSite, type PendingSiteMove, type CodeStartResponse} from '@/models/host'
import {useSiteRegistration, useRemoveSite, updateMovedSitePublication} from '@/models/site'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {SEED_HOST_URL} from '@shm/shared/constants'
import {hostnameStripProtocol} from '@shm/shared/site-hostname'
import {getDocumentTitle} from '@shm/shared/content'
import {useUniversalAppContext} from '@shm/shared'
import {validateDomain} from '@shm/shared/utils/path'
import {useNavigate} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {CodeInput} from '@shm/ui/components/code-input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {SizableText} from '@shm/ui/text'
import {
  PublishSiteFlow,
  PublishDomainStatus,
  setupGuideRoute,
  PublishSiteSuccess,
  PublishStep,
  PublishError,
  publishDialogClassName,
} from '@shm/ui/publish-site'
import {PathInput} from '@shm/ui/path-input'
import {UploadCloud} from '@shm/ui/icons'
import {toast} from '@shm/ui/toast'
import {useEffect, useRef, useState} from 'react'

/** Hosting management appears only for sites returned by the signed-in owner's hosting account. */
function HostedSiteSettings({siteId, siteUrl}: {siteId: UnpackedHypermediaId; siteUrl: string}) {
  const host = useHostSession({includeSites: true})
  const [loginOpen, setLoginOpen] = useState(false)
  const [action, setAction] = useState<{type: 'rename' | 'transfer'; site: HostedSite} | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [movedUrl, setMovedUrl] = useState<string | null>(null)
  useEffect(() => {
    setAction(null)
    setMovedUrl(null)
    setError(null)
  }, [host.email, host.loggedIn])
  const pendingMoves = host.pendingSiteMoves?.filter((move) => move.siteUid === siteId.uid) || []
  const sites = host.loggedIn
    ? host.sites.data?.filter(
        (site) =>
          site.activeConfig?.registeredAccountUid === siteId.uid &&
          (site.url === siteUrl || (URL.canParse(siteUrl) && site.customDomains.includes(new URL(siteUrl).hostname))),
      )
    : []

  function openAction(type: 'rename' | 'transfer', site: HostedSite) {
    setAction({type, site})
    setName(site.name)
    setEmail('')
    setConfirmation('')
    setError(null)
    setMovedUrl(null)
  }

  async function submit() {
    if (!action || busy || confirmation !== action.site.name) return
    setBusy(true)
    setError(null)
    try {
      if (action.type === 'rename') {
        // Retain the successful move if publishing fails, so Retry only updates metadata.
        const pendingMove = pendingMoves.find((move) => move.id === action.site.id && move.newName === name)
        const newUrl =
          movedUrl ||
          (pendingMove
            ? await host.recoverSiteMove.mutateAsync(pendingMove)
            : (
                await host.renameSite.mutateAsync({
                  id: action.site.id,
                  currentName: action.site.name,
                  name,
                  siteUid: siteId.uid,
                  currentUrl: action.site.url,
                })
              ).url)
        setMovedUrl(newUrl)
        await updateMovedSitePublication(siteId, action.site.url, newUrl)
        await host.clearPendingSiteMove(action.site.id)
        toast.success('Site address updated')
      } else {
        const result = await host.transferSite.mutateAsync({
          id: action.site.id,
          currentName: action.site.name,
          email,
        })
        toast.success(`Hosting transferred to ${result.email}`)
      }
      setAction(null)
      setMovedUrl(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update hosting. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function repairMove(move: PendingSiteMove) {
    setBusy(true)
    setError(null)
    try {
      const newUrl = await host.recoverSiteMove.mutateAsync(move)
      await updateMovedSitePublication(siteId, move.oldUrl, newUrl)
      await host.clearPendingSiteMove(move.id)
      toast.success('Site address updated')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to finish the move. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!host.isSessionLoaded) return null
  return (
    <>
      {pendingMoves.map((move) => (
        <div className="border-border flex flex-col gap-2 rounded-lg border p-4" key={move.id}>
          <SizableText weight="medium">Finish site address change</SizableText>
          <SizableText size="sm" color="muted">
            The move from {move.oldName} to {move.newName} still needs to be completed.
          </SizableText>
          {host.loggedIn && host.email === move.email ? (
            <Button
              variant="outline"
              className="self-start"
              disabled={busy}
              loading={busy}
              onClick={() => void repairMove(move)}
            >
              Resume Address Change
            </Button>
          ) : (
            <SizableText size="sm" color="muted">
              Sign in as {move.email} to resume.
            </SizableText>
          )}
          {error && !action ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ))}
      {!host.loggedIn ? (
        <Button variant="outline" className="self-start" onClick={() => setLoginOpen(true)}>
          Sign in to Seed Hosting
        </Button>
      ) : null}
      {host.loggedIn && host.sites.isInitialLoading ? (
        <SizableText size="sm" color="muted">
          Loading hosting settings…
        </SizableText>
      ) : null}
      {host.loggedIn && host.sites.isError ? (
        <div className="flex flex-col gap-2">
          <SizableText size="sm" color="muted">
            Unable to load hosting settings.
          </SizableText>
          <Button variant="outline" className="self-start" onClick={() => host.sites.refetch()}>
            Retry Hosting Settings
          </Button>
        </div>
      ) : null}
      {sites?.map((site) => {
        const pendingMove = pendingMoves.some((move) => move.id === site.id)
        const paidService = site.services.some((service) => !service.serviceEnd)
        const dedicatedService = site.services.some(
          (service) => !service.serviceEnd && service.plan.dedicatedServerType,
        )
        return (
          <div className="border-border flex flex-col gap-3 rounded-lg border p-4" key={site.id}>
            <div className="flex flex-col gap-1">
              <SizableText weight="medium">Seed Hosting</SizableText>
              <SizableText size="sm" color="muted">
                {site.url}
              </SizableText>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={dedicatedService || pendingMove}
                onClick={() => openAction('rename', site)}
              >
                Change Site Address
              </Button>
              <Button
                variant="outline"
                disabled={paidService || pendingMove}
                onClick={() => openAction('transfer', site)}
              >
                Transfer Hosting
              </Button>
            </div>
            {paidService ? (
              <SizableText size="sm" color="muted">
                Stop the paid service in Seed Hosting before transferring.
                {dedicatedService ? ' Stop dedicated hosting before changing the address.' : ''}
              </SizableText>
            ) : null}
          </div>
        )
      })}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="max-h-[calc(100dvh-4rem)] w-full max-w-md">
          <HostingLogin onAuthenticated={() => setLoginOpen(false)} onBack={() => setLoginOpen(false)} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null)
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-4rem)] w-full max-w-md" showCloseButton={!busy}>
          {action ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <DialogHeader>
                <DialogTitle>{action.type === 'rename' ? 'Change Site Address' : 'Transfer Hosting'}</DialogTitle>
                <DialogDescription>
                  {action.type === 'rename'
                    ? 'The old hosting address will stop working. Your space and its content stay the same.'
                    : 'Move this site to another Seed Hosting account. This does not transfer ownership of the Seed space.'}
                </DialogDescription>
              </DialogHeader>
              {action.type === 'rename' ? (
                <>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    New subdomain
                    <Input
                      value={name}
                      disabled={busy || !!movedUrl || pendingMoves.some((move) => move.id === action.site.id)}
                      required
                      maxLength={63}
                      pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                      onChangeText={setName}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </label>
                  <SizableText size="sm" color="muted">
                    {action.site.url.replace(`//${action.site.name}.`, `//${name}.`)}
                  </SizableText>
                  {siteUrl !== action.site.url ? (
                    <SizableText size="sm" color="muted">
                      Your published domain stays at {siteUrl}.
                    </SizableText>
                  ) : null}
                </>
              ) : (
                <>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Recipient email
                    <Input
                      type="email"
                      value={email}
                      required
                      disabled={busy}
                      onChangeText={setEmail}
                      autoComplete="email"
                    />
                  </label>
                  <SizableText size="sm" color="muted">
                    The recipient must have signed in to Seed Hosting. You will lose hosting controls for this site.
                  </SizableText>
                </>
              )}
              {!movedUrl ? (
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Type {action.site.name} to confirm
                  <Input
                    value={confirmation}
                    required
                    disabled={busy}
                    onChangeText={setConfirmation}
                    autoComplete="off"
                  />
                </label>
              ) : (
                <SizableText size="sm">
                  The hosting address has changed. Finish updating the space publication below.
                </SizableText>
              )}
              {error ? (
                <p className="text-destructive text-sm" role="alert">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setAction(null)}>
                  {movedUrl ? 'Close' : 'Cancel'}
                </Button>
                <Button
                  type="submit"
                  variant={action.type === 'transfer' ? 'destructive' : 'default'}
                  loading={busy}
                  disabled={
                    busy ||
                    confirmation !== action.site.name ||
                    (action.type === 'rename' && !movedUrl && name === action.site.name)
                  }
                >
                  {movedUrl
                    ? 'Retry Publication Update'
                    : action.type === 'rename'
                      ? 'Change Address'
                      : 'Transfer Hosting'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function matchesPublishedSite(site: HostedSite, uid: string, siteUrl: string | undefined) {
  return (
    site.activeConfig?.registeredAccountUid === uid &&
    !!siteUrl &&
    (site.url === siteUrl || (URL.canParse(siteUrl) && site.customDomains.includes(new URL(siteUrl).hostname)))
  )
}

function ErrorMessage({error}: {error: unknown}) {
  return <PublishError error={error ? (error instanceof Error ? error.message : String(error)) : null} />
}

function HostingLogin({
  onAuthenticated,
  onBack,
  skipVaultLogin = false,
}: {
  onAuthenticated: () => void
  onBack: () => void
  skipVaultLogin?: boolean
}) {
  const host = useHostSession({onAuthenticated})
  const [email, setEmail] = useState(skipVaultLogin ? '' : host.vaultEmail || '')
  const [vaultPending, setVaultPending] = useState(!skipVaultLogin && host.canLoginWithVault)
  const vaultAttempted = useRef(false)
  useEffect(() => {
    if (skipVaultLogin || !host.isSessionLoaded || !host.canLoginWithVault || vaultAttempted.current || host.loggedIn)
      return
    vaultAttempted.current = true
    setVaultPending(true)
    // Per-call mutation callbacks can be detached by StrictMode's effect remount.
    void host.loginWithVaultAsync().then(
      () => setVaultPending(false),
      () => setVaultPending(false),
    )
  }, [skipVaultLogin, host.isSessionLoaded, host.canLoginWithVault, host.loggedIn, host.loginWithVaultAsync])
  const [pending, setPending] = useState<CodeStartResponse | null>(null)
  const [code, setCode] = useState('')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  async function sendCode() {
    host.verifyEmailCode.reset()
    setCode('')
    try {
      setPending(await host.startEmailCode.mutateAsync(pending?.email || email))
    } catch {
      /* Mutation exposes error. */
    }
  }
  function verify(value: string) {
    if (!pending || host.verifyEmailCode.isLoading || !/^\d{4}$/.test(value)) return
    host.verifyEmailCode.mutate({email: pending.email, binding: pending.binding, code: value})
  }
  if (vaultPending) {
    return (
      <PublishStep title="Hosting by Seed Hypermedia" onBack={onBack}>
        <SizableText>Signing in…</SizableText>
      </PublishStep>
    )
  }
  const resendWait = pending ? Math.max(0, Math.ceil((pending.resendAllowedTime - now) / 1000)) : 0
  return (
    <PublishStep
      title={pending ? 'Check Your Inbox' : 'Log in to Seed Hosting'}
      description={
        pending ? (
          <>
            We sent a 4-digit code to <strong>{pending.email}</strong>.
          </>
        ) : (
          'We will email you a code to log in.'
        )
      }
      onBack={() => {
        host.verifyEmailCode.reset()
        setCode('')
        if (pending) setPending(null)
        else onBack()
      }}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (pending) verify(code)
          else void sendCode()
        }}
      >
        {pending ? (
          <>
            <CodeInput
              length={4}
              value={code}
              onChange={setCode}
              onComplete={verify}
              disabled={host.verifyEmailCode.isLoading}
            />
            <p className="text-muted-foreground text-sm">
              {pending.expireTime <= now
                ? 'This code has expired. Request another code.'
                : 'Use the latest code from your email.'}
            </p>
          </>
        ) : (
          <label className="flex flex-col gap-2 text-sm font-medium">
            Email Address
            <Input
              type="email"
              placeholder="me@email.com"
              autoComplete="email"
              required
              value={email}
              onChangeText={setEmail}
              disabled={host.startEmailCode.isLoading}
            />
          </label>
        )}
        <ErrorMessage error={host.startEmailCode.error || host.verifyEmailCode.error} />
        <DialogFooter>
          {pending ? (
            <Button
              type="button"
              variant="ghost"
              disabled={host.startEmailCode.isLoading || resendWait > 0}
              onClick={() => void sendCode()}
            >
              {resendWait ? `Resend in ${resendWait}s` : 'Resend Code'}
            </Button>
          ) : null}
          <Button
            type="submit"
            loading={host.startEmailCode.isLoading || host.verifyEmailCode.isLoading}
            disabled={!!pending && (code.length !== 4 || pending.expireTime <= now)}
          >
            {pending ? 'Verify' : 'Send Code'}
          </Button>
        </DialogFooter>
      </form>
    </PublishStep>
  )
}

type CloseProtection = {preventClose: boolean; showCloseButton: boolean}

type HostingStep = 'free' | 'custom'

type HostingInput = {id: UnpackedHypermediaId; step?: 'seed-host-custom-domain' | 'seed-host-subdomain'}

/** Opens the browser hosting flow using the same shared dialog primitives as desktop. */
export function useWebHostingDialog() {
  const [input, setInput] = useState<HostingInput | null>(null)
  const [protection, setProtection] = useState<CloseProtection>({preventClose: false, showCloseButton: true})
  const close = () => {
    if (!protection.preventClose) setInput(null)
  }
  return {
    open: setInput,
    close,
    content: (
      <Dialog
        open={!!input}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <DialogContent className={publishDialogClassName} showCloseButton={protection.showCloseButton}>
          {input ? <WebHostingDialog input={input} onClose={close} setDialogCloseProtection={setProtection} /> : null}
        </DialogContent>
      </Dialog>
    ),
  }
}

/** Publishes an owned public space using the same hosting and self-hosting workflow as desktop. */
export function WebHostingDialog({
  input: {id, step},
  onClose,
  setDialogCloseProtection,
}: {
  input: HostingInput
  onClose: () => void
  setDialogCloseProtection?: (value: CloseProtection) => void
}) {
  const identity = useLocalKeyPair()
  const identityLoaded = useLocalKeyPairLoaded()
  const resource = useResource({...id, version: null, latest: true}, {subscribed: true})
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const host = useHostSession()
  const register = useSiteRegistration(id.uid)
  const {openUrl} = useUniversalAppContext()
  if (!identityLoaded || resource.isInitialLoading)
    return (
      <PublishStep title="Web Domain">
        <p role="status">Loading hosting settings…</p>
      </PublishStep>
    )
  if (!identity?.capabilityCid || identity.delegatedAccountUid !== id.uid)
    return (
      <PublishStep title="Web Domain">
        <p>Sign in as the space owner to change its web domain.</p>
      </PublishStep>
    )
  if (!document || document.visibility === 'PRIVATE')
    return (
      <PublishStep title="Publish Your Space First">
        <p>A public space is required before setting up its web domain.</p>
      </PublishStep>
    )
  return (
    <PublishSiteFlow
      key={`${id.uid}:${step ?? 'choose'}:${identity.id}:${identity.capabilityCid}`}
      hostDomain={host.hostInfo.data?.hostDomain || 'hyper.media'}
      documentTitle={getDocumentTitle(document)}
      initialStep={step}
      onClose={onClose}
      onOpenSetupGuide={() => openUrl(setupGuideRoute.id.id, true)}
      onRegister={(url) => register.mutateAsync({url})}
      setDialogCloseProtection={setDialogCloseProtection}
      renderHosting={({customDomain, onBack, onClose}) => (
        <WebHostedPublishing
          id={id}
          initialStep={customDomain && document.metadata.siteUrl ? 'custom' : 'free'}
          onBack={onBack}
          onClose={onClose}
          setDialogCloseProtection={setDialogCloseProtection}
        />
      )}
    />
  )
}

function WebHostedPublishing(props: {
  id: UnpackedHypermediaId
  initialStep: HostingStep
  onBack: () => void
  onClose: () => void
  setDialogCloseProtection?: (value: CloseProtection) => void
}) {
  const host = useHostSession()
  const [step, setStep] = useState<HostingStep>(props.initialStep)
  const [manualLogin, setManualLogin] = useState(false)
  // Keep the selected step through login; account changes discard values and registration secrets.
  return (
    <HostingDialogContent
      key={`${props.id.uid}:${host.loggedIn ? host.email : 'signed-out'}`}
      input={{id: props.id}}
      onBack={props.onBack}
      onClose={props.onClose}
      setDialogCloseProtection={props.setDialogCloseProtection}
      step={step}
      setStep={setStep}
      skipVaultLogin={manualLogin}
      onSwitchAccount={() => {
        setManualLogin(true)
        host.logout()
      }}
    />
  )
}

function HostingDialogContent({
  input: {id},
  onBack,
  onClose,
  setDialogCloseProtection,
  step,
  setStep,
  skipVaultLogin,
  onSwitchAccount,
}: {
  input: HostingInput
  onBack: () => void
  onClose: () => void
  setDialogCloseProtection?: (value: CloseProtection) => void
  step: HostingStep
  setStep: (step: HostingStep) => void
  skipVaultLogin: boolean
  onSwitchAccount: () => void
}) {
  const identity = useLocalKeyPair()
  const identityLoaded = useLocalKeyPairLoaded()
  const host = useHostSession({includeSites: true})
  const resource = useResource({...id, version: null, latest: true}, {subscribed: true})
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const siteUrl = document?.metadata.siteUrl
  const register = useSiteRegistration(id.uid)
  const [subdomain, setSubdomain] = useState('')
  const [hostname, setHostname] = useState('')
  const [setupUrl, setSetupUrl] = useState<string | null>(null)
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)
  const navigate = useNavigate()
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setDialogCloseProtection?.({preventClose: busy, showCloseButton: !busy})
    return () => setDialogCloseProtection?.({preventClose: false, showCloseButton: true})
  }, [busy, setDialogCloseProtection])
  const pendingDomain = host.pendingDomains?.find((pending) => pending.siteUid === id.uid)
  const ownedSite = host.loggedIn && host.sites.data?.find((site) => matchesPublishedSite(site, id.uid, siteUrl))
  async function publish() {
    if (busy) return
    const validation = validateDomain(subdomain, 'subdomain')
    if (validation || subdomain.length < 4) {
      setError(validation || 'Subdomain must be at least 4 characters long')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // A reload may interrupt registration after the hosting address was reserved.
      // Resume only an unregistered reservation owned by this hosting account.
      const reservation = host.sites.data?.find(
        (site) =>
          site.name === subdomain &&
          !site.activeConfig?.registeredAccountUid &&
          site.activeConfig?.availableRegistrationSecret,
      )
      let target = setupUrl
      if (!target && reservation?.activeConfig?.availableRegistrationSecret) {
        const resumeUrl = new URL('/hm/register', reservation.url)
        resumeUrl.searchParams.set('secret', reservation.activeConfig.availableRegistrationSecret)
        target = resumeUrl.toString()
      }
      target ||= (await host.createSite.mutateAsync({subdomain})).setupUrl
      setSetupUrl(target)
      const url = await register.mutateAsync({url: target})
      setPublishedUrl(url)
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }
  async function createDomain() {
    if (!siteUrl || !ownedSite || busy) return
    const validation = validateDomain(hostname)
    if (validation) {
      setError(validation)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const domain = await host.createDomain.mutateAsync({
        hostname,
        currentSiteUrl: siteUrl,
        hostingSiteUrl: ownedSite.url,
        id,
      })
      onClose()
      navigate({key: 'site-settings', id, tab: 'web-domain', domain: domain.hostname})
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }
  if (!identityLoaded || resource.isInitialLoading || !host.isSessionLoaded)
    return (
      <>
        <DialogTitle>Web Domain</DialogTitle>
        <p role="status">Loading hosting settings…</p>
      </>
    )
  if (!identity?.capabilityCid || identity.delegatedAccountUid !== id.uid)
    return (
      <>
        <DialogTitle>Web Domain</DialogTitle>
        <p>Sign in as the space owner to change its web domain.</p>
      </>
    )
  if (!document || document.visibility === 'PRIVATE')
    return (
      <>
        <DialogTitle>Publish Your Space First</DialogTitle>
        <p>A public space is required before setting up its web domain.</p>
      </>
    )
  if (!host.loggedIn) return <HostingLogin onAuthenticated={() => {}} onBack={onBack} skipVaultLogin={skipVaultLogin} />
  if (publishedUrl)
    return (
      <PublishSiteSuccess
        url={publishedUrl}
        onClose={onClose}
        onCustomDomain={() => {
          setPublishedUrl(null)
          setStep('custom')
        }}
      />
    )
  return (
    <PublishStep
      title={step === 'free' ? 'Choose Your Subdomain' : 'Set Up Custom Domain'}
      description={
        step === 'free'
          ? `The space will be available at your-name.${host.hostInfo.data?.hostDomain || 'hyper.media'}.`
          : 'Publish the space to a domain that you own. On the next step you will be asked to point its DNS to Seed hosting.'
      }
      onBack={
        busy
          ? undefined
          : () => {
              onBack()
              setError(null)
            }
      }
      footer={
        <SizableText size="xs" color="muted" className="mr-auto">
          Logged in to {hostnameStripProtocol(SEED_HOST_URL)} as {host.email}.{' '}
          <Button variant="link" size="xs" className="h-auto p-0 text-xs" disabled={busy} onClick={onSwitchAccount}>
            Switch account
          </Button>
        </SizableText>
      }
    >
      {host.hostInfo.data?.serviceErrorMessage ? <ErrorMessage error={host.hostInfo.data.serviceErrorMessage} /> : null}
      {step === 'free' ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void publish()
          }}
        >
          <label className="flex flex-col gap-2 text-sm font-medium">
            Subdomain
            <PathInput
              kind="subdomain"
              placeholder="my-space-name"
              value={subdomain}
              onValueChange={setSubdomain}
              minLength={4}
              maxLength={63}
              pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
              required
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy || !!setupUrl}
            />
          </label>
          {setupUrl && error ? (
            <p className="text-sm">Your hosting address is reserved. Retry to finish publishing your space.</p>
          ) : null}
          <DialogFooter>
            <Button type="submit" loading={busy}>
              <UploadCloud className="size-4" />
              {setupUrl ? 'Finish Publishing' : 'Publish Space'}
            </Button>
          </DialogFooter>
        </form>
      ) : null}
      {step === 'custom' ? (
        pendingDomain ? (
          <PendingDomainStatus id={id} siteUrl={siteUrl || ''} />
        ) : ownedSite ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void createDomain()
            }}
          >
            <label className="flex flex-col gap-2 text-sm font-medium">
              Domain Name
              <PathInput
                kind="domain"
                value={hostname}
                onValueChange={setHostname}
                placeholder="mydomain.com"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
              />
            </label>
            <DialogFooter>
              <Button type="submit" loading={busy}>
                Publish to Domain
                <UploadCloud className="size-4" />
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <p>
              {host.sites.isInitialLoading
                ? 'Loading your hosted sites…'
                : siteUrl
                  ? 'Sign in to the Seed Hosting account that owns this site to add a custom domain.'
                  : 'Create a free Seed address before connecting your domain.'}
            </p>
            {!siteUrl ? <Button onClick={() => setStep('free')}>Choose a Seed Address</Button> : null}
          </div>
        )
      ) : null}
      <ErrorMessage error={error} />
    </PublishStep>
  )
}

function PendingDomainStatus({
  id,
  siteUrl,
  hostname,
  fullPage = false,
}: {
  id: UnpackedHypermediaId
  siteUrl: string
  hostname?: string
  fullPage?: boolean
}) {
  const host = useHostSession()
  const navigate = useNavigate()
  const pending = host.pendingDomains?.find(
    (domain) => domain.siteUid === id.uid && (!hostname || domain.hostname === hostname),
  )
  const [error, setError] = useState<unknown>(null)
  if (!pending) return null
  const pollingError = host.domainStatus.error
  const selectedPollingError =
    pollingError &&
    typeof pollingError === 'object' &&
    'domainId' in pollingError &&
    pollingError.domainId !== pending.id
      ? null
      : pollingError
  const failure = error || pending.errorMessage || selectedPollingError
  return (
    <div className={fullPage ? 'flex flex-col gap-4' : 'border-border flex flex-col gap-4 rounded-lg border p-5'}>
      <PublishDomainStatus
        hostname={pending.hostname}
        siteUrl={pending.hostingSiteUrl || siteUrl}
        status={pending.status || 'checking'}
        checking={host.domainStatus.isFetching}
        error={failure ? (failure instanceof Error ? failure.message : String(failure)) : null}
        canceling={host.cancelPendingDomain.isLoading}
        onRetry={async () => {
          setError(null)
          try {
            await host.retryPendingDomains(pending.id)
          } catch (cause) {
            setError(cause)
          }
        }}
        onCancel={async () => {
          setError(null)
          try {
            await host.cancelPendingDomain.mutateAsync(pending.id)
          } catch (cause) {
            setError(cause)
          }
        }}
      />
      {fullPage ? (
        <p className="text-muted-foreground text-sm">
          This page checks progress every 20 seconds. Seed Hosting checks DNS every minute. DNS propagation depends on
          your provider.
        </p>
      ) : (
        <Button
          variant="outline"
          onClick={() => navigate({key: 'site-settings', id, tab: 'web-domain', domain: pending.hostname})}
        >
          Open Domain Setup
        </Button>
      )}
    </div>
  )
}

/** Durable, owner-gated custom-domain progress; reopening never creates a domain. */
export function WebDomainSetupPage({siteId, hostname}: {siteId: UnpackedHypermediaId; hostname: string}) {
  const identity = useLocalKeyPair()
  const identityLoaded = useLocalKeyPairLoaded()
  const resource = useResource(siteId, {subscribed: true})
  const host = useHostSession({includeSites: true})
  const navigate = useNavigate()
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginError, setLoginError] = useState<unknown>(null)
  const [switchingAccount, setSwitchingAccount] = useState(false)
  async function openLogin(clearSession: boolean) {
    if (switchingAccount) return
    setSwitchingAccount(true)
    setLoginError(null)
    try {
      if (clearSession) await host.logoutAsync()
      setLoginOpen(true)
    } catch (error) {
      setLoginError(error)
    } finally {
      setSwitchingAccount(false)
    }
  }
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const siteUrl = document?.metadata.siteUrl
  const pending = host.pendingDomains?.find((domain) => domain.siteUid === siteId.uid && domain.hostname === hostname)
  const ownedSite = host.sites.data?.find(
    (site) => site.activeConfig?.registeredAccountUid === siteId.uid && site.customDomains.includes(hostname),
  )
  const serverDomain = ownedSite?.domainDetails?.find((domain) => domain.hostname === hostname)
  const expired = [host.domainStatus.error, host.sites.error].some(
    (error) => !!error && typeof error === 'object' && 'status' in error && error.status === 401,
  )
  const owner = !!identity?.capabilityCid && identity.delegatedAccountUid === siteId.uid
  let content
  if (!identityLoaded || !host.isSessionLoaded || resource.isInitialLoading)
    content = <p role="status">Loading domain setup…</p>
  else if (!owner)
    content = <p>Sign in as the space owner to continue domain setup. Your setup address will stay here.</p>
  else if (!document || document.visibility === 'PRIVATE')
    content = <p>A public space is required to finish domain setup.</p>
  else if (!host.loggedIn || expired)
    content = (
      <div className="flex flex-col items-start gap-4">
        <p>Sign in to the Seed Hosting account that started this domain setup to resume checking its progress.</p>
        <Button loading={switchingAccount} onClick={() => void openLogin(expired)}>
          Sign in to Seed Hosting
        </Button>
      </div>
    )
  else if (pending)
    content = (
      <PendingDomainStatus
        key={`${host.email}:${pending.id}`}
        id={siteId}
        hostname={hostname}
        siteUrl={siteUrl || ''}
        fullPage
      />
    )
  else if (host.sites.isInitialLoading || host.sites.isFetching) content = <p role="status">Checking domain status…</p>
  else if (host.sites.error)
    content = (
      <div className="flex flex-col items-start gap-4">
        <ErrorMessage error={host.sites.error} />
        <Button onClick={() => void host.sites.refetch()}>Retry Domain Setup</Button>
      </div>
    )
  else if (ownedSite && serverDomain?.status === 'Active' && siteUrl === `https://${hostname}`)
    content = <PublishDomainStatus hostname={hostname} siteUrl={ownedSite.url} status="ready" />
  else if (ownedSite && serverDomain && siteUrl)
    content = (
      <div className="flex flex-col items-start gap-4">
        <PublishDomainStatus
          hostname={hostname}
          siteUrl={ownedSite.url}
          status={
            serverDomain.status === 'Active'
              ? 'publishing'
              : serverDomain.status === 'Initializing'
                ? 'initializing'
                : serverDomain.status === 'Error'
                  ? 'error'
                  : 'waiting-dns'
          }
        />
        <p>
          Resume this existing domain setup to finish updating this space’s published address. No new domain will be
          created.
        </p>
        <ErrorMessage error={host.resumeDomain.error} />
        <Button
          loading={host.resumeDomain.isLoading}
          onClick={() =>
            void host.resumeDomain
              .mutateAsync({hostingSiteId: ownedSite.id, hostname, currentSiteUrl: siteUrl, id: siteId})
              .catch(() => {})
          }
        >
          Resume Domain Setup
        </Button>
      </div>
    )
  else
    content = (
      <div className="flex flex-col gap-3">
        <p>
          {ownedSite
            ? 'This domain is active, but it is not the current published address of this space.'
            : 'No domain setup was found for this space in the signed-in hosting account. It may have been canceled or moved to another account.'}
        </p>
        <p>Return to Web Domain settings to review the space, or switch to the hosting account that started setup.</p>
        <Button
          variant="outline"
          className="self-start"
          loading={switchingAccount}
          onClick={() => void openLogin(true)}
        >
          Switch hosting account
        </Button>
      </div>
    )
  return (
    <section className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-8">
        <Button
          variant="ghost"
          className="self-start"
          onClick={() => navigate({key: 'site-settings', id: siteId, tab: 'web-domain'})}
        >
          Back to Web Domain Settings
        </Button>
        <div>
          <p className="text-muted-foreground text-sm">Custom domain setup</p>
          <h1 className="text-2xl font-bold break-all">{hostname}</h1>
        </div>
        {content}
        <ErrorMessage error={loginError} />
        {owner && host.loggedIn && !expired ? (
          <p className="text-muted-foreground text-sm">Seed Hosting: {host.email}</p>
        ) : null}
        <Dialog open={loginOpen && owner} onOpenChange={setLoginOpen}>
          <DialogContent className={publishDialogClassName}>
            <HostingLogin onAuthenticated={() => setLoginOpen(false)} onBack={() => setLoginOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>
    </section>
  )
}

/** Browser settings for publication and management of an owned Seed-hosted space. */
export function WebDomainSettings({siteId, page = false}: {siteId: UnpackedHypermediaId; page?: boolean}) {
  const title = page ? <h2 className="text-2xl font-bold">Web Domain</h2> : <DialogTitle>Web Domain</DialogTitle>
  const resource = useResource(siteId, {subscribed: true})
  const identity = useLocalKeyPair()
  const identityLoaded = useLocalKeyPairLoaded()
  const host = useHostSession({includeSites: true})
  const publish = useWebHostingDialog()
  const navigate = useNavigate()
  const remove = useRemoveSite(siteId)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const siteUrl = document?.metadata.siteUrl
  const pending = host.pendingDomains?.find((domain) => domain.siteUid === siteId.uid)
  if (!identityLoaded || resource.isInitialLoading)
    return (
      <>
        {title}
        <p role="status">Loading web domain…</p>
      </>
    )
  if (!document) return <p>This account doesn't have a space yet.</p>
  if (!identity?.capabilityCid || identity.delegatedAccountUid !== siteId.uid)
    return (
      <>
        {title}
        <p>Sign in as the space owner to change its web domain.</p>
      </>
    )
  return (
    <div className="flex flex-col gap-4">
      {title}
      {siteUrl ? (
        <>
          <p className="text-sm">Published at</p>
          <a className="text-primary break-all underline" href={siteUrl} target="_blank" rel="noreferrer">
            {siteUrl}
          </a>
          <HostedSiteSettings siteId={siteId} siteUrl={siteUrl} />
          {host.loggedIn &&
          host.sites.data?.some(
            (site) =>
              matchesPublishedSite(site, siteId.uid, siteUrl) && site.customDomains.includes(new URL(siteUrl).hostname),
          ) ? (
            <Button
              variant="outline"
              className="self-start"
              onClick={() =>
                navigate({key: 'site-settings', id: siteId, tab: 'web-domain', domain: new URL(siteUrl).hostname})
              }
            >
              View Domain Status
            </Button>
          ) : null}
          {host.loggedIn
            ? host.sites.data
                ?.filter((site) => site.activeConfig?.registeredAccountUid === siteId.uid)
                .flatMap((site) =>
                  (site.domainDetails || [])
                    .filter(
                      (domain) =>
                        `https://${domain.hostname}` !== siteUrl &&
                        !host.pendingDomains?.some((pending) => pending.id === domain.id),
                    )
                    .map((domain) => (
                      <Button
                        key={domain.id}
                        variant="outline"
                        className="self-start"
                        onClick={() =>
                          navigate({key: 'site-settings', id: siteId, tab: 'web-domain', domain: domain.hostname})
                        }
                      >
                        Resume Domain Setup: {domain.hostname}
                      </Button>
                    )),
                )
            : null}
          {pending ? (
            <PendingDomainStatus id={siteId} siteUrl={siteUrl} />
          ) : host.loggedIn && host.sites.data?.some((site) => matchesPublishedSite(site, siteId.uid, siteUrl)) ? (
            <Button
              className="self-start"
              variant="outline"
              onClick={() => publish.open({id: siteId, step: 'seed-host-custom-domain'})}
            >
              Publish Custom Domain
            </Button>
          ) : null}
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-sm">
              Removing the publication keeps your space on the Hypermedia network and does not cancel your hosting
              service.
            </p>
            <Button className="self-start" variant="destructive" onClick={() => setConfirmRemove(true)}>
              Remove Domain from Publication
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground">Publish this space to make it available to anyone with a browser.</p>
          <Button className="self-start" onClick={() => publish.open({id: siteId})}>
            Publish to Web Domain
          </Button>
        </>
      )}
      {host.loggedIn ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Seed Hosting: {host.email}</span>
          <Button
            variant="ghost"
            onClick={() => {
              void host.logout()
            }}
          >
            Log out of Hosting
          </Button>
        </div>
      ) : null}
      {publish.content}
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Domain from Publication?</DialogTitle>
            <DialogDescription>
              Your space remains on the Hypermedia network. This removes its published web address.
            </DialogDescription>
          </DialogHeader>
          <ErrorMessage error={remove.error} />
          <DialogFooter>
            <Button variant="ghost" disabled={remove.isLoading} onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={remove.isLoading}
              onClick={async () => {
                try {
                  await remove.mutateAsync()
                  setConfirmRemove(false)
                } catch {
                  /* Mutation exposes error. */
                }
              }}
            >
              Remove Domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import {useWebCanEdit} from '@/document-edit/use-web-can-edit'
import {useHostSession, type HostedSite, type PendingSiteMove, type CodeStartResponse} from '@/models/host'
import {useSiteRegistration, useRemoveSite, updateMovedSitePublication} from '@/models/site'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {validateDomain} from '@shm/shared/utils/path'
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
import {toast} from '@shm/ui/toast'
import {useEffect, useState} from 'react'

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
  return error ? (
    <p role="alert" className="text-destructive text-sm">
      {error instanceof Error ? error.message : String(error)}
    </p>
  ) : null
}

function HostingLogin({onAuthenticated, onBack}: {onAuthenticated: () => void; onBack: () => void}) {
  const host = useHostSession({onAuthenticated})
  const [email, setEmail] = useState('')
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
  const resendWait = pending ? Math.max(0, Math.ceil((pending.resendAllowedTime - now) / 1000)) : 0
  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{pending ? 'Check Your Inbox' : 'Log in to Seed Hosting'}</DialogTitle>
        <DialogDescription>
          {pending ? `We sent a 4-digit code to ${pending.email}.` : 'We will email you a code to log in.'}
        </DialogDescription>
      </DialogHeader>
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
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              host.verifyEmailCode.reset()
              setCode('')
              if (pending) setPending(null)
              else onBack()
            }}
          >
            Back
          </Button>
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
    </div>
  )
}

type CloseProtection = {preventClose: boolean; showCloseButton: boolean}

type HostingStep = 'choose' | 'free' | 'custom' | 'existing'

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
        <DialogContent
          className="max-h-[calc(100dvh-4rem)] w-full max-w-lg"
          showCloseButton={protection.showCloseButton}
        >
          {input ? <WebHostingDialog input={input} onClose={close} setDialogCloseProtection={setProtection} /> : null}
        </DialogContent>
      </Dialog>
    ),
  }
}

/** Publishes a public space to Seed Hosting, then optionally configures its custom domain. */
export function WebHostingDialog(props: {
  input: HostingInput
  onClose: () => void
  setDialogCloseProtection?: (value: CloseProtection) => void
}) {
  const host = useHostSession()
  const [step, setStep] = useState<HostingStep>(
    props.input.step === 'seed-host-custom-domain' ? 'custom' : props.input.step ? 'free' : 'choose',
  )
  useEffect(() => {
    setStep(props.input.step === 'seed-host-custom-domain' ? 'custom' : props.input.step ? 'free' : 'choose')
  }, [props.input.id.uid, props.input.step])
  // Keep navigation through login, while account changes discard form values and registration secrets.
  return (
    <HostingDialogContent
      key={`${props.input.id.uid}:${host.loggedIn ? host.email : 'signed-out'}`}
      {...props}
      step={step}
      setStep={setStep}
    />
  )
}

function HostingDialogContent({
  input: {id},
  onClose,
  setDialogCloseProtection,
  step,
  setStep,
}: {
  input: HostingInput
  onClose: () => void
  setDialogCloseProtection?: (value: CloseProtection) => void
  step: HostingStep
  setStep: (step: HostingStep) => void
}) {
  const permission = useWebCanEdit(id)
  const host = useHostSession({includeSites: true})
  const resource = useResource({...id, version: null, latest: true}, {subscribed: true})
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const siteUrl = document?.metadata.siteUrl
  const register = useSiteRegistration(id.uid)
  const [subdomain, setSubdomain] = useState('')
  const [hostname, setHostname] = useState('')
  const [setupUrl, setSetupUrl] = useState<string | null>(null)
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)
  const [requestedDomain, setRequestedDomain] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setDialogCloseProtection?.({preventClose: busy, showCloseButton: !busy})
    return () => setDialogCloseProtection?.({preventClose: false, showCloseButton: true})
  }, [busy, setDialogCloseProtection])
  const pendingDomain = host.pendingDomains?.find((pending) => pending.siteUid === id.uid)
  const ownedSite = host.loggedIn && host.sites.data?.find((site) => matchesPublishedSite(site, id.uid, siteUrl))
  useEffect(() => {
    if (requestedDomain && siteUrl === `https://${requestedDomain}` && !pendingDomain) setPublishedUrl(siteUrl)
  }, [requestedDomain, siteUrl, pendingDomain])
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
      const target = setupUrl || (await host.createSite.mutateAsync({subdomain})).setupUrl
      setSetupUrl(target)
      const url = await register.mutateAsync({url: target})
      setPublishedUrl(url)
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }
  async function connectExisting(site: HostedSite) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const url = new URL('/hm/register', site.url)
      const secret = site.activeConfig?.availableRegistrationSecret
      if (secret) url.searchParams.set('secret', secret)
      setPublishedUrl(await register.mutateAsync({url: url.toString()}))
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
      setRequestedDomain(domain.hostname)
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }
  if (permission.capabilitiesLoading || resource.isInitialLoading || !host.isSessionLoaded)
    return (
      <>
        <DialogTitle>Web Domain</DialogTitle>
        <p role="status">Loading hosting settings…</p>
      </>
    )
  if (!permission.canEdit || permission.signingAccountId !== id.uid)
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
  if (!host.loggedIn && step !== 'choose')
    return <HostingLogin onAuthenticated={() => {}} onBack={() => setStep('choose')} />
  if (publishedUrl)
    return (
      <div className="flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Your Space Is Published</DialogTitle>
          <DialogDescription>Anyone can visit your space at this address.</DialogDescription>
        </DialogHeader>
        <a href={publishedUrl} target="_blank" rel="noreferrer" className="text-primary break-all underline">
          {publishedUrl}
        </a>
        <DialogFooter>
          {!requestedDomain ? (
            <Button
              variant="outline"
              onClick={() => {
                setPublishedUrl(null)
                setStep('custom')
              }}
            >
              Set Up Custom Domain
            </Button>
          ) : null}
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </div>
    )
  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {step === 'choose'
            ? 'Publish to Web Domain'
            : step === 'free'
              ? 'Choose Your Subdomain'
              : step === 'existing'
                ? 'Connect an Existing Site'
                : 'Set Up Custom Domain'}
        </DialogTitle>
        <DialogDescription>
          {step === 'choose'
            ? 'Give your space a web address with Seed Hosting.'
            : step === 'free'
              ? `Your space will be available at your-name.${host.hostInfo.data?.hostDomain || 'seed.host'}.`
              : step === 'existing'
                ? 'Choose a site from your Seed Hosting account.'
                : 'Publish your space to a domain that you own.'}
        </DialogDescription>
      </DialogHeader>
      {host.hostInfo.data?.serviceErrorMessage ? <ErrorMessage error={host.hostInfo.data.serviceErrorMessage} /> : null}
      {step === 'choose' ? (
        <div className="flex flex-col gap-3">
          <Button onClick={() => setStep('free')}>Use a Free Seed Domain</Button>
          <Button variant="outline" onClick={() => setStep(siteUrl ? 'custom' : 'free')}>
            Use Your Own Domain
          </Button>
          <p className="text-muted-foreground text-sm">
            Custom domains start with a free Seed address, then connect your DNS.
          </p>
          <Button variant="outline" onClick={() => setStep('existing')}>
            Connect an Existing Site
          </Button>
        </div>
      ) : null}
      {step === 'existing' ? (
        <div className="flex flex-col gap-3">
          {host.sites.isInitialLoading ? <p role="status">Loading your sites…</p> : null}
          {host.sites.isError ? (
            <>
              <p role="alert">Unable to load your sites.</p>
              <Button variant="outline" onClick={() => host.sites.refetch()}>
                Retry
              </Button>
            </>
          ) : null}
          {siteUrl ? (
            <p className="text-muted-foreground text-sm">
              Connecting a site replaces your current published address, {siteUrl}.
            </p>
          ) : null}
          {host.sites.data
            ?.filter(
              (site) =>
                site.activeConfig?.registeredAccountUid === id.uid ||
                (!site.activeConfig?.registeredAccountUid && site.activeConfig?.availableRegistrationSecret),
            )
            .map((site) => (
              <Button key={site.id} variant="outline" disabled={busy} onClick={() => void connectExisting(site)}>
                Connect {site.name}
              </Button>
            ))}
          {!host.sites.isInitialLoading &&
          !host.sites.isError &&
          !host.sites.data?.some(
            (site) =>
              site.activeConfig?.registeredAccountUid === id.uid ||
              (!site.activeConfig?.registeredAccountUid && site.activeConfig?.availableRegistrationSecret),
          ) ? (
            <p>No available sites in this hosting account. Create a free Seed address to get started.</p>
          ) : null}
        </div>
      ) : null}
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
            <Input
              value={subdomain}
              onChangeText={setSubdomain}
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
          <Button type="submit" loading={busy}>
            {setupUrl ? 'Finish Publishing' : 'Publish Space'}
          </Button>
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
              <Input
                value={hostname}
                onChangeText={setHostname}
                placeholder="example.com"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
              />
            </label>
            <Button type="submit" loading={busy}>
              Publish to Domain
            </Button>
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
      <DialogFooter>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={
            step === 'choose'
              ? onClose
              : () => {
                  setStep('choose')
                  setError(null)
                }
          }
        >
          {step === 'choose' ? 'Cancel' : 'Back'}
        </Button>
        {host.loggedIn ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              void host.logout()
            }}
          >
            Log out of Hosting
          </Button>
        ) : null}
      </DialogFooter>
      {host.loggedIn ? (
        <p className="text-muted-foreground text-xs">Signed in to Seed Hosting as {host.email}.</p>
      ) : null}
    </div>
  )
}

function PendingDomainStatus({id, siteUrl}: {id: UnpackedHypermediaId; siteUrl: string}) {
  const host = useHostSession()
  const pending = host.pendingDomains?.find((domain) => domain.siteUid === id.uid)
  const [error, setError] = useState<unknown>(null)
  if (!pending) return null
  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border p-4">
      <SizableText weight="medium">Setting up {pending.hostname}</SizableText>
      {pending.status === 'waiting-dns' ? (
        <>
          <p>
            At your DNS provider, point <strong>{pending.hostname}</strong> to{' '}
            <strong>{(pending.hostingSiteUrl || siteUrl).replace(/^https?:\/\//, '').replace(/\/$/, '')}</strong>. Use a
            CNAME for a subdomain, or your provider’s ALIAS/ANAME option for a root domain.
          </p>
          <p className="text-muted-foreground text-sm">
            DNS updates may take a few minutes. Keep Seed open to finish publishing. You can close this dialog and
            return here to check progress.
          </p>
        </>
      ) : pending.status === 'error' ? (
        <p role="alert">
          {pending.errorMessage || 'Domain setup could not finish. Check your DNS settings and try again.'}
        </p>
      ) : (
        <p role="status">Connecting your domain and updating the space publication…</p>
      )}
      <ErrorMessage error={error || host.domainStatus.error} />
      {pending.status === 'error' || host.domainStatus.isError ? (
        <Button
          className="self-start"
          variant="outline"
          onClick={async () => {
            setError(null)
            try {
              await host.retryPendingDomains()
            } catch (cause) {
              setError(cause)
            }
          }}
        >
          Retry Domain Setup
        </Button>
      ) : null}
      <Button
        className="self-start"
        variant="outline"
        loading={host.cancelPendingDomain.isLoading}
        onClick={async () => {
          try {
            await host.cancelPendingDomain.mutateAsync(pending.id)
          } catch (cause) {
            setError(cause)
          }
        }}
      >
        Cancel Domain Setup
      </Button>
    </div>
  )
}

/** Browser settings for publication and management of an owned Seed-hosted space. */
export function WebDomainSettings({siteId}: {siteId: UnpackedHypermediaId}) {
  const resource = useResource(siteId, {subscribed: true})
  const permission = useWebCanEdit(siteId)
  const host = useHostSession({includeSites: true})
  const publish = useWebHostingDialog()
  const remove = useRemoveSite(siteId)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const siteUrl = document?.metadata.siteUrl
  const pending = host.pendingDomains?.find((domain) => domain.siteUid === siteId.uid)
  if (resource.isInitialLoading || permission.capabilitiesLoading)
    return (
      <>
        <DialogTitle>Web Domain</DialogTitle>
        <p role="status">Loading web domain…</p>
      </>
    )
  if (!document) return <p>This account doesn't have a space yet.</p>
  if (!permission.canEdit || permission.signingAccountId !== siteId.uid)
    return (
      <>
        <DialogTitle>Web Domain</DialogTitle>
        <p>Sign in as the space owner to change its web domain.</p>
      </>
    )
  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>Web Domain</DialogTitle>
      {siteUrl ? (
        <>
          <p className="text-sm">Published at</p>
          <a className="text-primary break-all underline" href={siteUrl} target="_blank" rel="noreferrer">
            {siteUrl}
          </a>
          <HostedSiteSettings siteId={siteId} siteUrl={siteUrl} />
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

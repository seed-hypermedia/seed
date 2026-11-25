import {useEffect, useId, useRef, useState, type PropsWithChildren, type ReactNode} from 'react'
import {AlertCircle, ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Globe, Loader2} from 'lucide-react'
import {Button} from './button'
import {Input} from './components/input'
import {Label} from './components/label'
import {DialogDescription, DialogFooter, DialogHeader, DialogTitle} from './components/dialog'
import {type IconComponent, PasteSetupUrl, SeedHost, SelfHost, UploadCloud} from './icons'
import {SizableText, Text} from './text'
import {useUniversalAppContext, hostnameStripProtocol, hmId, type DocumentRoute} from '@shm/shared'
import {copyTextToClipboard} from './copy-to-clipboard'
import {Tooltip} from './tooltip'
import {toast} from './toast'
import {CongratsGraphic, WebPublishedGraphic} from './publish-graphics'

/** Compact publishing dialog dimensions shared by desktop and web. */
export const publishDialogClassName = 'w-full max-w-md max-h-[calc(100dvh-4rem)]'

/** DNS instructions shared by the browser setup page and desktop publishing flow. */
export function DNSInstructions({hostname, siteUrl}: {hostname: string; siteUrl: string}) {
  const target = hostnameStripProtocol(siteUrl).replace(/\/$/, '')
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        At your DNS provider, point <strong>{hostname}</strong> to <strong>{target}</strong>. Use a CNAME for a
        subdomain, or your provider’s ALIAS/ANAME option for a root domain.
      </p>
      <p className="text-muted-foreground text-sm">
        DNS propagation depends on your provider. You can return to Web Domain in Space Settings to check progress and
        finish setup.
      </p>
    </div>
  )
}

/** Shared DNS, HTTPS, and publication progress; platform adapters own polling and persistence. */
export function PublishDomainStatus({
  hostname,
  siteUrl,
  status,
  checking = false,
  error,
  onRetry,
  onCancel,
  canceling = false,
}: {
  hostname: string
  siteUrl: string
  status: 'checking' | 'waiting-dns' | 'initializing' | 'publishing' | 'ready' | 'error'
  checking?: boolean
  error?: string | null
  onRetry?: () => void
  onCancel?: () => void
  canceling?: boolean
}) {
  const title = {
    checking: 'Checking domain status',
    'waiting-dns': 'Waiting for DNS',
    initializing: 'Setting up HTTPS',
    publishing: 'Updating your space',
    ready: 'Your domain is ready',
    error: 'Domain setup needs attention',
  }[status]
  const failed = status === 'error' || !!error
  const StatusIcon = failed ? AlertCircle : status === 'ready' ? Check : Loader2
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        <StatusIcon
          className={`size-5 shrink-0 ${
            !failed && status !== 'ready' ? 'animate-spin motion-reduce:animate-none' : ''
          }`}
        />
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          {checking && status !== 'checking' ? (
            <p className="text-muted-foreground text-sm">Checking for updates…</p>
          ) : null}
        </div>
      </div>
      {status === 'checking' || status === 'waiting-dns' || status === 'error' ? (
        <DNSInstructions hostname={hostname} siteUrl={siteUrl} />
      ) : status === 'initializing' ? (
        <p className="text-muted-foreground text-sm">
          DNS is connected. Seed is preparing the secure connection for your domain.
        </p>
      ) : status === 'publishing' ? (
        <p className="text-muted-foreground text-sm">
          The secure connection is ready. Updating your space’s web address…
        </p>
      ) : (
        <a className="text-primary break-all underline" href={`https://${hostname}`} target="_blank" rel="noreferrer">
          Open {hostname}
        </a>
      )}
      {failed ? (
        <PublishError error={error || 'Domain setup could not finish. Check your DNS settings and try again.'} />
      ) : null}
      {onRetry || onCancel ? (
        <div className="flex flex-wrap gap-2">
          {onRetry ? (
            <Button variant="outline" onClick={onRetry} disabled={checking || canceling}>
              {failed ? 'Retry Domain Setup' : 'Check Again'}
            </Button>
          ) : null}
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel} loading={canceling} disabled={checking}>
              Cancel Domain Setup
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** One step of a publishing dialog: a title with an optional back button, the step's content, and its actions. */
export function PublishStep({
  title,
  description,
  onBack,
  backDisabled,
  footer,
  children,
}: PropsWithChildren<{
  title: string
  description?: ReactNode
  onBack?: () => void
  backDisabled?: boolean
  footer?: ReactNode
}>) {
  return (
    <>
      <DialogHeader className="pr-6">
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button size="iconSm" variant="ghost" onClick={onBack} disabled={backDisabled} aria-label="Back">
              <ArrowLeft className="size-4" />
            </Button>
          ) : null}
          <DialogTitle>{title}</DialogTitle>
        </div>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      {children}
      {footer ? <DialogFooter className="items-center">{footer}</DialogFooter> : null}
    </>
  )
}

function PublishOptionButton({
  icon: Icon,
  onClick,
  label,
  description,
}: {
  icon: IconComponent
  onClick: () => void
  label: string
  description?: string
}) {
  return (
    <Button variant="outline" onClick={onClick} className="h-auto justify-start gap-3 px-3 py-3 text-left">
      <span className="text-muted-foreground flex size-6 shrink-0 items-center justify-center">
        <Icon size={24} color="currentColor" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <SizableText weight="medium">{label}</SizableText>
        {description ? (
          <SizableText size="xs" color="muted" className="whitespace-normal">
            {description}
          </SizableText>
        ) : null}
      </div>
    </Button>
  )
}

/** Choose the public address type before selecting the hosting service. */
export function PublishDomainChoice({
  hostDomain,
  onFreeDomain,
  onCustomDomain,
}: {
  hostDomain: string
  onFreeDomain: () => void
  onCustomDomain: () => void
}) {
  return (
    <PublishStep title="Publish to the Web" description="Where should this space be available?">
      <div className="flex flex-col gap-2">
        <PublishOptionButton
          icon={SeedHost}
          onClick={onFreeDomain}
          label={`Free ${hostDomain} domain`}
          description="A subdomain of your choice, hosted by Seed Hypermedia."
        />
        <PublishOptionButton
          icon={Globe}
          onClick={onCustomDomain}
          label="Custom domain"
          description="A domain that you own."
        />
      </div>
    </PublishStep>
  )
}

/** Choose a hosting workflow; each platform supplies only the options it supports. */
export function PublishHostingChoice({
  onBack,
  onSeedHosting,
  onSelfHost,
  onSetupUrl,
}: {
  onBack: () => void
  onSeedHosting: () => void
  onSelfHost?: () => void
  onSetupUrl?: () => void
}) {
  return (
    <PublishStep title="Custom Domain" description="How would you like to host the space?" onBack={onBack}>
      <div className="flex flex-col gap-2">
        <PublishOptionButton
          icon={SeedHost}
          onClick={onSeedHosting}
          label="Hosting by Seed Hypermedia"
          description="Free. Point your domain at it once the space is published."
        />
        {onSelfHost ? (
          <PublishOptionButton
            icon={SelfHost}
            onClick={onSelfHost}
            label="Self Host on Your Own Server"
            description="Run the Seed site software on a server that you manage."
          />
        ) : null}
        {onSetupUrl ? (
          <PublishOptionButton
            icon={PasteSetupUrl}
            onClick={onSetupUrl}
            label="Paste a Hosting Setup URL"
            description="Your server is already set up and printed its setup URL."
          />
        ) : null}
      </div>
    </PublishStep>
  )
}

/** Shared completion view after publishing a free site or connecting a custom domain. */
export function PublishSiteSuccess({
  url,
  onClose,
  onCustomDomain,
}: {
  url: string
  onClose: () => void
  onCustomDomain?: () => void
}) {
  return (
    <PublishStep
      title={onCustomDomain ? 'Published to the Web!' : `Published to ${hostnameStripProtocol(url)}!`}
      description={
        onCustomDomain
          ? 'Here is the link to your space. You can also publish it to a domain that you own.'
          : 'Here is the link for your space.'
      }
      footer={
        onCustomDomain ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              <Check className="size-4" />
              Close
            </Button>
            <Button variant="default" onClick={onCustomDomain}>
              Publish Custom Domain
              <ArrowRight className="size-4" />
            </Button>
          </>
        ) : (
          <Button variant="default" onClick={onClose}>
            <Check className="size-4" />
            Done
          </Button>
        )
      }
    >
      <div className="flex justify-center py-2">
        {onCustomDomain ? <WebPublishedGraphic className="h-24 w-auto" /> : <CongratsGraphic className="h-24 w-auto" />}
      </div>
      <PublishedUrl url={url} />
    </PublishStep>
  )
}

function PublishedUrl({url}: {url: string}) {
  const {openUrl} = useUniversalAppContext()
  const textRef = useRef<HTMLSpanElement>(null)
  return (
    <div className="border-border bg-muted flex items-center gap-1 overflow-hidden rounded-md border p-1 pl-3">
      <Text
        size="sm"
        weight="medium"
        className="min-w-0 flex-1 truncate"
        ref={textRef}
        onClick={() => {
          if (textRef.current) {
            const range = document.createRange()
            range.selectNode(textRef.current)
            window.getSelection()?.removeAllRanges()
            window.getSelection()?.addRange(range)
          }
        }}
      >
        {url}
      </Text>
      <Tooltip content="Copy URL">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Copy URL"
          onClick={() => {
            copyTextToClipboard(url)
            toast(`Copied ${url} URL`)
          }}
        >
          <Copy className="size-4" />
        </Button>
      </Tooltip>
      <Button variant="default" size="sm" onClick={() => openUrl(url)}>
        Open
        <ExternalLink className="size-4" />
      </Button>
    </div>
  )
}

/** Inline publishing failure, shared across desktop and browser steps. */
export function PublishError({error}: {error: string | null}) {
  if (!error) return null
  return (
    <div role="alert" className="border-destructive flex items-center gap-3 rounded-md border p-3">
      <AlertCircle className="text-destructive size-5 shrink-0" />
      <SizableText size="sm" className="text-destructive">
        {error}
      </SizableText>
    </div>
  )
}

/** Shared self-hosting setup documentation destination. */
export const setupGuideRoute: DocumentRoute = {
  key: 'document',
  id: hmId('z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS', {path: ['resources', 'self-host-seed']}),
}

/** Platform adapters keep networking and authentication outside the common publishing workflow. */
export type PublishSiteFlowProps = {
  hostDomain: string
  documentTitle: string
  initialStep?: 'seed-host-custom-domain' | 'seed-host-subdomain'
  onClose: () => void
  onOpenSetupGuide: () => void
  onRegister: (url: string) => Promise<string>
  setDialogCloseProtection?: (value: {preventClose: boolean; showCloseButton: boolean}) => void
  renderHosting: (args: {customDomain: boolean; onBack: () => void; onClose: () => void}) => ReactNode
}

/** Desktop and web share domain choice, self-host instructions, setup registration, and completion. */
export function PublishSiteFlow({
  hostDomain,
  documentTitle,
  initialStep,
  onClose,
  onOpenSetupGuide,
  onRegister,
  setDialogCloseProtection,
  renderHosting,
}: PublishSiteFlowProps) {
  const [mode, setMode] = useState<'domain' | 'hosting' | 'self-host' | 'setup-url' | 'seed-free' | 'seed-custom'>(
    initialStep === 'seed-host-custom-domain'
      ? 'seed-custom'
      : initialStep === 'seed-host-subdomain'
        ? 'seed-free'
        : 'domain',
  )
  const [setupUrl, setSetupUrl] = useState('')
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const inputId = useId()
  useEffect(() => {
    setDialogCloseProtection?.({preventClose: busy, showCloseButton: !busy})
    return () => setDialogCloseProtection?.({preventClose: false, showCloseButton: true})
  }, [busy, setDialogCloseProtection])

  function goBack() {
    if (!inFlight.current) setMode('hosting')
  }
  async function register() {
    if (inFlight.current) return
    const value = setupUrl.trim()
    try {
      const parsed = new URL(value)
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error()
    } catch {
      setError('Enter a valid hosting setup URL starting with https:// or http://.')
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const url = await onRegister(value)
      setPublishedUrl(url)
      setSetupUrl('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to publish this space. Please try again.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  if (publishedUrl) return <PublishSiteSuccess url={publishedUrl} onClose={onClose} />
  if (mode === 'seed-free' || mode === 'seed-custom') {
    return renderHosting({
      customDomain: mode === 'seed-custom',
      onBack: () => setMode(mode === 'seed-free' ? 'domain' : 'hosting'),
      onClose,
    })
  }
  if (mode === 'self-host')
    return (
      <PublishStep
        title="Host on Your Own Server"
        description="You will need your own server and domain. Follow the guide to get started, and return when the setup script has printed the setup URL."
        onBack={goBack}
        footer={
          <>
            <Button variant="outline" onClick={onOpenSetupGuide}>
              <ExternalLink className="size-4" />
              Open Setup Guide
            </Button>
            <Button variant="default" onClick={() => setMode('setup-url')}>
              My Setup URL is Ready
              <ArrowRight className="size-4" />
            </Button>
          </>
        }
      />
    )
  if (mode === 'setup-url')
    return (
      <PublishStep
        title={`Publish "${documentTitle}"`}
        onBack={goBack}
        backDisabled={busy}
        description={
          <>
            The{' '}
            <Button variant="link" size="xs" className="h-auto p-0 text-sm" disabled={busy} onClick={onOpenSetupGuide}>
              server setup
            </Button>{' '}
            outputs a setup URL for you to paste here.
          </>
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void register()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>Space Setup URL</Label>
            <Input
              id={inputId}
              type="url"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              required
              disabled={busy}
              value={setupUrl}
              onChange={(event) => setSetupUrl(event.target.value)}
              placeholder="https://mysite.com/hm/register?..."
            />
          </div>
          <PublishError error={error} />
          <DialogFooter>
            <Button variant="default" type="submit" disabled={busy || !setupUrl.trim()} loading={busy}>
              <UploadCloud className="size-4" />
              Publish Space
            </Button>
          </DialogFooter>
        </form>
      </PublishStep>
    )
  if (mode === 'hosting')
    return (
      <PublishHostingChoice
        onBack={() => setMode('domain')}
        onSeedHosting={() => setMode('seed-custom')}
        onSelfHost={() => setMode('self-host')}
        onSetupUrl={() => setMode('setup-url')}
      />
    )
  return (
    <PublishDomainChoice
      hostDomain={hostDomain}
      onFreeDomain={() => setMode('seed-free')}
      onCustomDomain={() => setMode('hosting')}
    />
  )
}

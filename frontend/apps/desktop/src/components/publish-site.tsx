import {fetchResource} from '@/models/entities'
import {CodeStartResponse, HostInfoResponse, useHostSession} from '@/models/host'
import {useRemoveSite, useSiteRegistration} from '@/models/site'
import {useNavigate} from '@/utils/useNavigate'
import {zodResolver} from '@hookform/resolvers/zod'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {DocumentRoute, hmId, hostnameStripProtocol, useUniversalAppContext} from '@shm/shared'
import {SEED_HOST_URL, VERSION} from '@shm/shared/constants'
import {getDocumentTitle} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {IconComponent, PasteSetupUrl, SeedHost, SelfHost, UploadCloud} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {SizableText, Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {AlertCircle, ArrowLeft, ArrowRight, Check, Copy, ExternalLink, Globe} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {SubmitHandler, useForm} from 'react-hook-form'
import {z} from 'zod'

import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'
import {ExpiryHint} from '@shm/ui/components/change-email-dialog'
import {CodeInput} from '@shm/ui/components/code-input'
import {DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@shm/ui/components/dialog'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {CongratsGraphic, WebPublishedGraphic} from './publish-graphics'

// The publishing dialogs are compact, sized by their content.
const publishDialogClassName = 'w-full max-w-md max-h-[calc(100dvh-4rem)]'

export function usePublishSite() {
  return useAppDialog(PublishSiteDialog, {className: publishDialogClassName})
}

export function useRemoveSiteDialog() {
  return useAppDialog(RemoveSiteDialog, {isAlert: true})
}

function RemoveSiteDialog({onClose, input}: {onClose: () => void; input: UnpackedHypermediaId}) {
  const removeSite = useRemoveSite(input)
  return (
    <div className="flex flex-col gap-4 rounded-lg p-4">
      <AlertDialogTitle>Remove Space</AlertDialogTitle>
      <AlertDialogDescription>
        Remove this space URL from the entity? Your space will still exist until you delete the server.
      </AlertDialogDescription>

      <div className="flex justify-end gap-3">
        <AlertDialogCancel asChild>
          <Button
            variant="ghost"
            onClick={() => {
              onClose()
            }}
          >
            Cancel
          </Button>
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          onClick={() => {
            removeSite.mutate()
            onClose()
          }}
        >
          Remove Space
        </AlertDialogAction>
      </div>
    </div>
  )
}

const publishSiteSchema = z.object({
  url: z.string(),
})
type PublishSiteFields = z.infer<typeof publishSiteSchema>

/** One step of a publishing dialog: a title with an optional back button, the step's content, and its actions. */
function PublishStep({
  title,
  description,
  onBack,
  footer,
  children,
}: React.PropsWithChildren<{
  title: string
  description?: React.ReactNode
  onBack?: () => void
  footer?: React.ReactNode
}>) {
  return (
    <>
      <DialogHeader className="pr-6">
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button size="iconSm" variant="ghost" onClick={onBack} aria-label="Back">
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

/** The publishing dialog: choose a domain, then the hosting for it. */
export function PublishSiteDialog({
  input,
  onClose,
}: {
  input: {
    id: UnpackedHypermediaId
    step?: 'seed-host-custom-domain' | undefined
  }
  onClose: () => void
}) {
  const {id, step: initialStep} = input
  const {hostInfo} = useHostSession()
  const [mode, setMode] = useState<
    'choose-domain' | 'choose-hosting' | 'input-url' | 'self-host' | 'seed-host' | 'seed-host-custom-domain'
  >(initialStep || 'choose-domain')
  if (mode === 'input-url') {
    return <PublishWithUrl id={id} onComplete={onClose} onBack={() => setMode('choose-hosting')} />
  }
  if (mode === 'self-host') {
    return <SelfHostContent onSetupUrl={() => setMode('input-url')} onBack={() => setMode('choose-hosting')} />
  }
  if (mode === 'seed-host') {
    return <SeedHostContent onClose={onClose} onBack={() => setMode('choose-domain')} id={id} />
  }
  if (mode === 'seed-host-custom-domain') {
    return <SeedHostRegisterCustomDomain id={id} onClose={onClose} />
  }
  if (mode === 'choose-hosting') {
    return (
      <PublishStep
        title="Custom Domain"
        description="How would you like to host the space?"
        onBack={() => setMode('choose-domain')}
      >
        <div className="flex flex-col gap-2">
          <PublishOptionButton
            icon={SeedHost}
            onClick={() => setMode('seed-host')}
            label="Hosting by Seed Hypermedia"
            description="Free. Point your domain at it once the space is published."
          />
          <PublishOptionButton
            icon={SelfHost}
            onClick={() => setMode('self-host')}
            label="Self Host on Your Own Server"
            description="Run the Seed site software on a server that you manage."
          />
          <PublishOptionButton
            icon={PasteSetupUrl}
            onClick={() => setMode('input-url')}
            label="Paste a Hosting Setup URL"
            description="Your server is already set up and printed its setup URL."
          />
        </div>
      </PublishStep>
    )
  }
  return (
    <PublishStep title="Publish to the Web" description="Where should this space be available?">
      <div className="flex flex-col gap-2">
        <PublishOptionButton
          icon={SeedHost}
          onClick={() => setMode('seed-host')}
          label={`Free ${hostInfo.data?.hostDomain || 'hyper.media'} domain`}
          description="A subdomain of your choice, hosted by Seed Hypermedia."
        />
        <PublishOptionButton
          icon={Globe}
          onClick={() => setMode('choose-hosting')}
          label="Custom domain"
          description="A domain that you own."
        />
      </div>
    </PublishStep>
  )
}

function versionToInt(version: string): number | null {
  const parts = version.split('.')
  if (parts.length !== 3) return null
  return parseInt(parts[0]) * 10_000 + parseInt(parts[1]) * 1000 + parseInt(parts[2])
}

function isAppVersionEqualOrAbove(version: string) {
  if (VERSION === '0.0.0') return true // for local dev
  if (VERSION === '0.0.0.local-dev') return true // for local dev
  if (VERSION.match('0.0.0.local')) return true // for local builds
  const expectedVersionInt = versionToInt(version)
  const currentVersionInt = versionToInt(VERSION)
  if (expectedVersionInt === null || currentVersionInt === null) return false
  return currentVersionInt >= expectedVersionInt
}

/** Says whether the hosting service can be used by this version of the app. */
function isHostAvailable(info: HostInfoResponse | null | undefined): boolean {
  if (!info || info.serviceErrorMessage) return false
  return !info.minimumAppVersion || isAppVersionEqualOrAbove(info.minimumAppVersion)
}

function SeedHostIntro({
  onBack,
  info,
  infoError,
  infoIsLoading,
}: {
  onBack: () => void
  info?: HostInfoResponse | null
  infoError?: unknown
  infoIsLoading: boolean
}) {
  let content = <CenteredSpinner />
  if (infoIsLoading || isHostAvailable(info)) {
    // Nothing to show: the next step opens as soon as the service is known to be available.
  } else if (infoError || info) {
    content = (
      <ErrorBox
        error={
          (infoError instanceof Error ? infoError.message : infoError ? String(infoError) : null) ||
          info?.serviceErrorMessage ||
          'The service has been updated. You must update to the latest version of the app.'
        }
      />
    )
  } else {
    content = (
      <div className="flex flex-col items-center gap-4 py-4">
        <SizableText color="muted" className="text-center">
          Unable to load hosting service information. Please check your internet connection and try again.
        </SizableText>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Retry
        </Button>
      </div>
    )
  }
  return (
    <PublishStep title="Hosting by Seed Hypermedia" onBack={onBack}>
      {content}
    </PublishStep>
  )
}

function CenteredSpinner() {
  return (
    <div className="flex items-center justify-center py-6">
      <Spinner />
    </div>
  )
}

const LoginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
})
type LoginFields = z.infer<typeof LoginSchema>
/** Shared email-code login for publishing and managing hosted sites. */
export function SeedHostLogin({onAuthenticated, onBack}: {onAuthenticated: () => void; onBack: () => void}) {
  const {startEmailCode, verifyEmailCode} = useHostSession({onAuthenticated})
  const [pending, setPending] = useState<CodeStartResponse | null>(null)
  const [code, setCode] = useState('')

  const {
    control,
    handleSubmit,
    formState: {errors},
  } = useForm<LoginFields>({
    resolver: zodResolver(LoginSchema),
  })
  async function sendCode(email: string) {
    verifyEmailCode.reset()
    setCode('')
    setPending(await startEmailCode.mutateAsync(email))
  }
  const onSubmit: SubmitHandler<LoginFields> = (data) => {
    sendCode(data.email).catch(() => {})
  }
  function verify(fullCode: string) {
    if (!pending || verifyEmailCode.isLoading || !/^\d{4}$/.test(fullCode)) return
    verifyEmailCode.mutate({email: pending.email, binding: pending.binding, code: fullCode})
  }
  const error = (startEmailCode.error || verifyEmailCode.error) as Error | null
  if (pending) {
    return (
      <PublishStep
        title="Check Your Inbox"
        description={
          <>
            We sent a 4-digit code to <strong>{pending.email}</strong>.
          </>
        }
        onBack={() => setPending(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            verify(code)
          }}
          className="flex flex-col gap-4"
        >
          <CodeInput length={4} value={code} onChange={setCode} onComplete={verify} />
          <ExpiryHint expireTimeMs={pending.expireTime} />
          <ErrorBox error={error?.message ?? null} />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={startEmailCode.isLoading}
              onClick={() => sendCode(pending.email).catch(() => {})}
            >
              {startEmailCode.isLoading ? 'Sending…' : 'Resend Code'}
            </Button>
            <Button
              variant="default"
              type="submit"
              disabled={code.length !== 4 || verifyEmailCode.isLoading}
              loading={verifyEmailCode.isLoading}
            >
              Verify
            </Button>
          </DialogFooter>
        </form>
      </PublishStep>
    )
  }
  return (
    <PublishStep title="Log in to Seed Hosting" description="We will email you a code to log in." onBack={onBack}>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField name="email" label="Email Address" errors={errors}>
          <FormInput disabled={startEmailCode.isLoading} control={control} name="email" placeholder="me@email.com" />
        </FormField>
        <ErrorBox error={error?.message ?? null} />
        <DialogFooter>
          <Button
            variant="default"
            disabled={startEmailCode.isLoading}
            type="submit"
            loading={startEmailCode.isLoading}
          >
            {startEmailCode.isLoading ? 'Sending…' : 'Send Code'}
          </Button>
        </DialogFooter>
      </form>
    </PublishStep>
  )
}

const RegisterSubdomainSchema = z.object({
  subdomain: z
    .string()
    .min(4, 'Subdomain must be at least 4 characters long')
    .refine((val) => !val.endsWith('-'), 'Subdomain cannot end with a dash'),
})
type RegisterSubdomainFields = z.infer<typeof RegisterSubdomainSchema>
function SeedHostRegisterSubdomain({
  onBack,
  onLogout,
  info,
  onPublished,
  id,
}: {
  onBack: () => void
  onLogout: () => void
  onPublished: (host: string) => void
  id: UnpackedHypermediaId
  info?: HostInfoResponse
}) {
  const {loggedIn, email, createSite, logout} = useHostSession({})
  const register = useSiteRegistration(id.uid)

  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<RegisterSubdomainFields>({
    resolver: zodResolver(RegisterSubdomainSchema),
    defaultValues: {
      subdomain: '',
    },
  })
  useEffect(() => {
    setFocus('subdomain')
  }, [setFocus])
  if (!loggedIn) return null
  function onSubmit({subdomain}: RegisterSubdomainFields) {
    createSite
      .mutateAsync({subdomain})
      .then(async ({setupUrl, host}) => {
        await register.mutateAsync({
          url: setupUrl,
        })
        return {host}
      })
      .then(({host}) => {
        onPublished(host)
      })
  }
  const isSubmitting = register.isLoading || createSite.isLoading

  // @ts-expect-error
  const errorText = register.error?.message || createSite.error?.message
  return (
    <PublishStep
      title="Choose Your Subdomain"
      description={`The space will be available at your-name.${info?.hostDomain}.`}
      onBack={onBack}
      footer={
        <SizableText size="xs" color="muted" className="mr-auto">
          Logged in to {hostnameStripProtocol(SEED_HOST_URL)} as {email}.{' '}
          <Button
            variant="link"
            size="xs"
            className="h-auto p-0 text-xs"
            onClick={() => {
              onLogout()
              logout()
            }}
          >
            Log out
          </Button>
        </SizableText>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField name="subdomain" label="Subdomain" errors={errors}>
          <FormInput
            control={control}
            name="subdomain"
            placeholder="my-space-name"
            transformInput={(text) =>
              text
                .replace(/[ _]/g, '-')
                .replace(/[^a-zA-Z0-9-]/g, '')
                .toLowerCase()
            }
          />
        </FormField>
        <ErrorBox error={errorText} />
        <DialogFooter>
          <Button variant="default" type="submit" disabled={isSubmitting} loading={isSubmitting}>
            <UploadCloud className="size-4" />
            Publish Space
          </Button>
        </DialogFooter>
      </form>
    </PublishStep>
  )
}

function ErrorBox({error}: {error: string | null}) {
  if (!error) return null
  return (
    <div className="border-destructive flex items-center gap-3 rounded-md border p-3">
      <AlertCircle className="text-destructive size-5 shrink-0" />
      <SizableText size="sm" className="text-destructive">
        {error}
      </SizableText>
    </div>
  )
}

function SeedHostSubdomainPublished({
  onClose,
  host,
  onCustomDomain,
}: {
  onClose: () => void
  host: string
  id: UnpackedHypermediaId
  onCustomDomain: () => void
}) {
  return (
    <PublishStep
      title="Published to the Web!"
      description="Here is the link to your space. You can also publish it to a domain that you own."
      footer={
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
      }
    >
      <div className="flex justify-center py-2">
        <WebPublishedGraphic className="h-24 w-auto" />
      </div>
      <PublishedUrl url={host} />
    </PublishStep>
  )
}

function PublishedUrl({url}: {url: string}) {
  const {openUrl} = useUniversalAppContext()
  const textRef = useRef<any>(null)
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

const activelyWatchedDomainIds = new Set<string>()

export function useSeedHostDialog() {
  const {open, content} = useAppDialog(SeedHostDomainPublishedDialog, {className: publishDialogClassName})
  const {pendingDomains} = useHostSession()
  const watchingDomainsInProgress = useRef<
    {
      domainId: string
      siteUid: string
      hostname: string
    }[]
  >([])
  useEffect(() => {
    if (!pendingDomains) return
    pendingDomains?.forEach((p) => {
      if (!watchingDomainsInProgress.current.find((d) => d.domainId === p.id)) {
        watchingDomainsInProgress.current.push({
          domainId: p.id,
          siteUid: p.siteUid,
          hostname: p.hostname,
        })
      }
    })
    watchingDomainsInProgress.current.forEach((watchingDomain) => {
      if (!pendingDomains.find((p) => p.id === watchingDomain.domainId)) {
        watchingDomainsInProgress.current = watchingDomainsInProgress.current.filter(
          (pendingDomain) => pendingDomain.domainId !== watchingDomain.domainId,
        )
        if (activelyWatchedDomainIds.has(watchingDomain.domainId)) {
          return
        }
        fetchResource(hmId(watchingDomain.siteUid))
          .then((entity: Awaited<ReturnType<typeof fetchResource>>) => {
            const siteDocument = entity?.type === 'document' ? entity.document : undefined
            const siteUrl = siteDocument?.metadata?.siteUrl
            if (siteUrl && siteUrl === `https://${watchingDomain.hostname}`) {
              open({
                id: hmId(watchingDomain.siteUid),
                host: watchingDomain.hostname,
              })
            }
          })
          .catch((e) => {
            console.error('Pending Domain released, failed to load entity', e)
          })
      }
    })
  }, [pendingDomains, open])
  return {content, open}
}

function SeedHostDomainPublishedDialog({
  input,
  onClose,
}: {
  input: {
    id: UnpackedHypermediaId
    host: string
  }
  onClose: () => void
}) {
  return <SeedHostDomainPublished onClose={onClose} host={input.host} id={input.id} />
}

function SeedHostDomainPublished({onClose, host}: {onClose: () => void; host: string; id: UnpackedHypermediaId}) {
  return (
    <PublishStep
      title={`Published to ${host}!`}
      description="Here is the link for your space."
      footer={
        <Button variant="default" onClick={onClose}>
          <Check className="size-4" />
          Done
        </Button>
      }
    >
      <div className="flex justify-center py-2">
        <CongratsGraphic className="h-24 w-auto" />
      </div>
      <PublishedUrl url={`https://${host}`} />
    </PublishStep>
  )
}

const RegisterCustomDomainSchema = z.object({
  domain: z
    .string()
    .min(3, 'Domain is required')
    .regex(/^(?!.*\.\.)(?!.*\.$)(?!^\.)[a-z0-9.-]+$/, 'Invalid domain format'),
})
type RegisterCustomDomainFields = z.infer<typeof RegisterCustomDomainSchema>
function SeedHostRegisterCustomDomain({
  onBack,
  id,
  onClose,
}: {
  onBack?: () => void
  id: UnpackedHypermediaId
  onClose: () => void
}) {
  const {createDomain} = useHostSession()
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<RegisterCustomDomainFields>({
    resolver: zodResolver(RegisterCustomDomainSchema),
  })
  const entity = useResource({...id, version: null, latest: true})
  const [localPendingDomain, setPendingDomain] = useState<{
    hostname: string
    domainId: string
  } | null>(null)
  const document = entity.data?.type === 'document' ? entity.data.document : undefined
  const siteUrl = document?.metadata?.siteUrl
  function onSubmit({domain}: RegisterCustomDomainFields) {
    if (!siteUrl) throw new Error('Space URL not found')
    createDomain
      .mutateAsync({
        hostname: domain,
        currentSiteUrl: siteUrl,
        id,
      })
      .then((d) => {
        setPendingDomain(d)
      })
  }
  const pendingDomain = useHostSession().pendingDomains?.find((pending) => pending.siteUid === id.uid)
  const pendingDomainId = localPendingDomain?.domainId
  useEffect(() => {
    if (pendingDomainId) {
      activelyWatchedDomainIds.add(pendingDomainId)
      return () => {
        activelyWatchedDomainIds.delete(pendingDomainId)
      }
    }
  }, [pendingDomainId])
  useEffect(() => {
    if (!pendingDomain && !localPendingDomain && siteUrl) {
      setFocus('domain')
    }
  }, [pendingDomain, localPendingDomain, siteUrl])
  if (pendingDomain) {
    let pendingStatus = null
    if (pendingDomain?.status === 'error') {
      pendingStatus = <ErrorBox error="Something went wrong. Please try domain setup again." />
    } else if (pendingDomain?.status === 'waiting-dns' && siteUrl) {
      pendingStatus = <DNSInstructions hostname={pendingDomain.hostname} siteUrl={siteUrl} />
    } else if (pendingDomain?.status === 'initializing') {
      pendingStatus = <SizableText color="muted">Initializing your domain…</SizableText>
    }
    return (
      <PublishStep
        title={`Setting up ${pendingDomain.hostname}`}
        description="You can close this dialog and keep using the app."
        footer={
          <Button variant="default" onClick={onClose}>
            Close
          </Button>
        }
      >
        {pendingStatus}
        <CenteredSpinner />
      </PublishStep>
    )
  }
  if (localPendingDomain && siteUrl === `https://${localPendingDomain.hostname}`) {
    return <SeedHostDomainPublished host={localPendingDomain.hostname} onClose={onClose} id={id} />
  }
  return (
    <PublishStep
      title={localPendingDomain ? `Setting up ${localPendingDomain.hostname}` : 'Set Up Custom Domain'}
      description={
        siteUrl
          ? 'Publish the space to a domain that you own. On the next step you will be asked to point its DNS to Seed hosting.'
          : undefined
      }
      onBack={onBack}
    >
      {siteUrl ? (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField name="domain" label="Domain Name" errors={errors}>
            <FormInput
              control={control}
              name="domain"
              placeholder="mydomain.com"
              transformInput={(text) => {
                if (text.match(/https?:\/\//)) {
                  text = text.replace(/https?:\/\//, '')
                }
                return text
                  .replace(/[ _]/g, '-')
                  .replace(/[^a-zA-Z0-9-\.]/g, '')
                  .toLowerCase()
              }}
            />
          </FormField>
          {createDomain.error ? (
            // @ts-expect-error
            <ErrorBox error={createDomain.error.message} />
          ) : null}
          <DialogFooter>
            <Button variant="default" type="submit" disabled={createDomain.isLoading} loading={createDomain.isLoading}>
              Publish to Domain
              <UploadCloud className="size-4" />
            </Button>
          </DialogFooter>
        </form>
      ) : (
        <SizableText color="muted">You need to publish your space first.</SizableText>
      )}
    </PublishStep>
  )
}

export function DNSInstructions({hostname, siteUrl}: {hostname: string; siteUrl: string}) {
  const isSubd = isSubdomain(hostname)
  return (
    <div className="flex flex-col gap-3">
      <SizableText>
        Set the <Text weight="bold">{hostname}</Text> {isSubd ? 'CNAME' : 'ALIAS'} record to{' '}
        <Text weight="bold">{hostnameStripProtocol(siteUrl)}</Text> at your DNS provider.
      </SizableText>
      <SizableText color="muted" size="sm">
        Once you update the DNS, it usually takes 10 minutes to propagate. Keep the app open until then.
      </SizableText>
    </div>
  )
}

function isSubdomain(hostname: string) {
  return hostname.split('.').length > 2
}

/** Steps of publishing a site to the Seed hosting service: login, subdomain, custom domain. */
export function SeedHostContent({
  onBack,
  onClose,
  id,
}: {
  onBack: () => void
  onClose: () => void
  id: UnpackedHypermediaId
}) {
  const {loggedIn, isSessionLoaded, hostInfo, loginWithVault} = useHostSession({})
  const [host, setHost] = useState<string | null>(null)
  const [mode, setMode] = useState<
    'intro' | 'vault-login' | 'login' | 'register-subdomain' | 'subdomain-published' | 'register-custom-domain'
  >('intro')
  const canStart = mode === 'intro' && isSessionLoaded && isHostAvailable(hostInfo.data)
  useEffect(() => {
    if (!canStart) return
    if (loggedIn) {
      setMode('register-subdomain')
      return
    }
    setMode('vault-login')
    loginWithVault(undefined, {
      onSuccess: () => setMode('register-subdomain'),
      onError: () => setMode('login'),
    })
  }, [canStart])
  if (mode === 'intro') {
    return (
      <SeedHostIntro
        onBack={onBack}
        info={hostInfo.data}
        infoError={hostInfo.error}
        infoIsLoading={hostInfo.isLoading}
      />
    )
  }
  if (mode === 'vault-login') {
    return (
      <PublishStep title="Hosting by Seed Hypermedia" onBack={onBack}>
        <CenteredSpinner />
      </PublishStep>
    )
  }
  if (mode === 'login') {
    return <SeedHostLogin onAuthenticated={() => setMode('register-subdomain')} onBack={onBack} />
  }
  if (mode === 'register-subdomain' && loggedIn) {
    return (
      <SeedHostRegisterSubdomain
        id={id}
        // @ts-expect-error
        info={hostInfo.data}
        onLogout={() => {
          setMode('login')
        }}
        onPublished={(host) => {
          setMode('subdomain-published')
          setHost(host)
        }}
        onBack={onBack}
      />
    )
  }
  if (mode === 'subdomain-published' && host && loggedIn) {
    return (
      <SeedHostSubdomainPublished
        onCustomDomain={() => setMode('register-custom-domain')}
        host={host}
        onClose={onClose}
        id={id}
      />
    )
  }
  if (mode === 'register-custom-domain' && loggedIn) {
    return (
      <SeedHostRegisterCustomDomain
        id={id}
        onBack={() => {
          if (host) setMode('subdomain-published')
          else onClose()
        }}
        onClose={onClose}
      />
    )
  }

  return null
}

function SelfHostContent({onSetupUrl, onBack}: {onSetupUrl: () => void; onBack: () => void}) {
  const spawn = useNavigate('spawn')
  return (
    <PublishStep
      title="Host on Your Own Server"
      description="You will need your own server and domain. Follow the guide to get started, and return when the setup script has printed the setup URL."
      onBack={onBack}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              spawn(setupGuideRoute)
            }}
          >
            <ExternalLink className="size-4" />
            Open Setup Guide
          </Button>
          <Button variant="default" onClick={onSetupUrl}>
            My Setup URL is Ready
            <ArrowRight className="size-4" />
          </Button>
        </>
      }
    />
  )
}

function PublishWithUrl({
  id,
  onComplete,
  onBack,
}: {
  id: UnpackedHypermediaId
  onComplete: () => void
  onBack?: () => void
}) {
  const entity = useResource(id)
  const document = entity.data?.type === 'document' ? entity.data.document : undefined
  const replace = useNavigate('replace')
  const register = useSiteRegistration(id.uid)
  const onSubmit: SubmitHandler<PublishSiteFields> = (data) => {
    register.mutateAsync({url: data.url}).then((publishedUrl) => {
      onComplete()
      toast.success(`Space published to ${publishedUrl}`)
      // make sure the user is seeing the latest version of the site that now includes the url
      replace({key: 'document', id: {...id, version: null, latest: true}})
    })
  }
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<PublishSiteFields>({
    resolver: zodResolver(publishSiteSchema),
    defaultValues: {
      url: '',
    },
  })
  useEffect(() => {
    const timer = setTimeout(() => {
      setFocus('url')
    }, 300)
    return () => clearTimeout(timer)
  }, [setFocus])
  const spawn = useNavigate('spawn')
  return (
    <PublishStep
      title={`Publish "${getDocumentTitle(document)}"`}
      description={
        <>
          The{' '}
          <Button
            variant="link"
            size="xs"
            className="h-auto p-0 text-sm"
            onClick={() => {
              spawn(setupGuideRoute)
            }}
          >
            server setup
          </Button>{' '}
          outputs a setup URL for you to paste here.
        </>
      }
      onBack={onBack}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <FormField name="url" label="Space Setup URL" errors={errors}>
          <FormInput control={control} name="url" placeholder="https://mysite.com/hm/register?..." />
        </FormField>
        {/* @ts-expect-error */}
        {register.error ? <ErrorBox error={register.error.message} /> : null}
        <DialogFooter>
          <Button variant="default" type="submit" disabled={register.isLoading} loading={register.isLoading}>
            <UploadCloud className="size-4" />
            Publish Space
          </Button>
        </DialogFooter>
      </form>
    </PublishStep>
  )
}

const setupGuideId = hmId('z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS', {
  path: ['resources', 'self-host-seed'],
})
const setupGuideRoute: DocumentRoute = {
  key: 'document',
  id: setupGuideId,
}

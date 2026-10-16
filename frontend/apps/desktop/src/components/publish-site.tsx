import {fetchResource} from '@/models/entities'
import {CodeStartResponse, HostInfoResponse, useHostSession} from '@/models/host'
import {useRemoveSite, useSiteRegistration} from '@/models/site'
import {useNavigate} from '@/utils/useNavigate'
import {zodResolver} from '@hookform/resolvers/zod'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, hostnameStripProtocol} from '@shm/shared'
import {SEED_HOST_URL, VERSION} from '@shm/shared/constants'
import {getDocumentTitle} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import {validateDomain} from '@shm/shared/utils/path'
import {Button} from '@shm/ui/button'
import {FormInput, FormPathInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {UploadCloud} from '@shm/ui/icons'
import {
  PublishSiteFlow,
  setupGuideRoute,
  PublishSiteSuccess,
  PublishError as ErrorBox,
  PublishStep,
  PublishDomainStatus,
  publishDialogClassName,
} from '@shm/ui/publish-site'
import {Spinner} from '@shm/ui/spinner'
import {SizableText, Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
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
import {DialogFooter} from '@shm/ui/components/dialog'
import {useAppDialog} from '@shm/ui/universal-dialog'

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

/** The publishing dialog: choose a domain, then the hosting for it. */
export function PublishSiteDialog({
  input,
  onClose,
  setDialogCloseProtection,
}: {
  input: {id: UnpackedHypermediaId; step?: 'seed-host-custom-domain' | 'seed-host-subdomain'}
  onClose: () => void
  setDialogCloseProtection?: (value: {preventClose: boolean; showCloseButton: boolean}) => void
}) {
  const {id, step: initialStep} = input
  const {hostInfo} = useHostSession()
  const entity = useResource(id)
  const document = entity.data?.type === 'document' ? entity.data.document : undefined
  const register = useSiteRegistration(id.uid)
  const spawn = useNavigate('spawn')
  return (
    <PublishSiteFlow
      key={`${id.id}:${initialStep || 'choose'}`}
      hostDomain={hostInfo.data?.hostDomain || 'hyper.media'}
      documentTitle={getDocumentTitle(document)}
      initialStep={initialStep}
      onClose={onClose}
      onOpenSetupGuide={() => spawn(setupGuideRoute)}
      onRegister={(url) => register.mutateAsync({url})}
      setDialogCloseProtection={setDialogCloseProtection}
      renderHosting={({customDomain, onBack, onClose}) =>
        customDomain && !!document?.metadata.siteUrl ? (
          <SeedHostRegisterCustomDomain id={id} onClose={onClose} onBack={onBack} />
        ) : (
          <SeedHostContent id={id} onClose={onClose} onBack={onBack} />
        )
      }
    />
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
export function SeedHostLogin({
  onAuthenticated,
  onBack,
  sessionExpired = false,
}: {
  onAuthenticated: () => void
  onBack: () => void
  sessionExpired?: boolean
}) {
  const {email, startEmailCode, verifyEmailCode} = useHostSession({onAuthenticated})
  const [pending, setPending] = useState<CodeStartResponse | null>(null)
  const [code, setCode] = useState('')

  const {
    control,
    handleSubmit,
    formState: {errors},
  } = useForm<LoginFields>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {email: email || ''},
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
    <PublishStep
      title="Log in to Seed Hosting"
      description={
        sessionExpired
          ? 'Your hosting session is no longer valid. Sign in again to continue publishing.'
          : 'We will email you a code to log in.'
      }
      onBack={onBack}
    >
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
    .superRefine((value, ctx) => {
      const error = validateDomain(value, 'subdomain')
      if (error) ctx.addIssue({code: z.ZodIssueCode.custom, message: error})
    }),
})
type RegisterSubdomainFields = z.infer<typeof RegisterSubdomainSchema>
function SeedHostRegisterSubdomain({
  onBack,
  onLogout,
  info,
  onPublished,
  id,
  subdomain,
  onSubdomainChange,
}: {
  onBack: () => void
  onLogout: () => void
  onPublished: (host: string) => void
  id: UnpackedHypermediaId
  info?: HostInfoResponse
  subdomain: string
  onSubdomainChange: (subdomain: string) => void
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
      subdomain,
    },
  })
  useEffect(() => {
    setFocus('subdomain')
  }, [setFocus])
  if (!loggedIn) return null
  function onSubmit({subdomain}: RegisterSubdomainFields) {
    onSubdomainChange(subdomain)
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
      // The mutation state renders failures; authentication failures open the login step.
      .catch(() => {})
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
          <FormPathInput control={control} name="subdomain" kind="subdomain" placeholder="my-space-name" />
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
  return <PublishSiteSuccess url={host} onClose={onClose} onCustomDomain={onCustomDomain} />
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
  return <PublishSiteSuccess url={`https://${host}`} onClose={onClose} />
}

const RegisterCustomDomainSchema = z.object({
  domain: z
    .string()
    .min(3, 'Domain is required')
    .superRefine((value, ctx) => {
      const error = validateDomain(value)
      if (error) ctx.addIssue({code: z.ZodIssueCode.custom, message: error})
    }),
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
        <PublishDomainStatus
          hostname={pendingDomain.hostname}
          siteUrl={siteUrl || ''}
          status={pendingDomain.status || 'checking'}
        />
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
            <FormPathInput control={control} name="domain" kind="domain" placeholder="mydomain.com" />
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
  const [subdomain, setSubdomain] = useState('')
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
  const sessionExpired =
    !loggedIn && (mode === 'register-subdomain' || mode === 'subdomain-published' || mode === 'register-custom-domain')
  if (mode === 'login' || sessionExpired) {
    return (
      <SeedHostLogin
        sessionExpired={sessionExpired}
        onAuthenticated={() => {
          if (mode === 'login') setMode('register-subdomain')
        }}
        onBack={onBack}
      />
    )
  }
  if (mode === 'register-subdomain' && loggedIn) {
    return (
      <SeedHostRegisterSubdomain
        id={id}
        subdomain={subdomain}
        onSubdomainChange={setSubdomain}
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

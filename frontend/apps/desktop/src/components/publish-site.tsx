import {useExperiments} from '@/models/experiments'
import {HostInfoResponse, useHostSession} from '@/models/host'
import {useRemoveSite, useSiteRegistration} from '@/models/site'
import {useNavigate} from '@/utils/useNavigate'
import {zodResolver} from '@hookform/resolvers/zod'
import {hmId, hostnameStripProtocol} from '@shm/shared'
import {SEED_HOST_URL, VERSION} from '@shm/shared/constants'
import {getDocumentTitle} from '@shm/shared/content'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {HoverCard} from '@shm/ui/hover-card'
import {
  IconComponent,
  PasteSetupUrl,
  SeedHost,
  SelfHost,
  UploadCloud,
} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {ArrowLeft, ArrowRight, Check, ExternalLink} from '@tamagui/lucide-icons'
import {useEffect, useState} from 'react'
import {SubmitHandler, useForm} from 'react-hook-form'
import {
  AlertDialog,
  Form,
  Heading,
  SizableText,
  styled,
  Theme,
  View,
  XStack,
  YStack,
} from 'tamagui'
import {z} from 'zod'
import {useAppDialog} from './dialog'

export function usePublishSite() {
  return useAppDialog(PublishSiteDialog, {
    contentProps: {
      maxWidth: null,
      maxHeight: null,
      height: 'content-fit',
      width: 'content-fit',
      overflow: 'hidden',
      padding: 0,
    },
  })
}

export function useRemoveSiteDialog() {
  return useAppDialog(RemoveSiteDialog, {isAlert: true})
}

function RemoveSiteDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: UnpackedHypermediaId
}) {
  const removeSite = useRemoveSite(input)
  return (
    <YStack gap="$4" padding="$4" borderRadius="$3">
      <AlertDialog.Title>Remove Site</AlertDialog.Title>
      <AlertDialog.Description>
        Remove this site URL from the entity? Your site will still exist until
        you delete the server.
      </AlertDialog.Description>

      <XStack gap="$3" justifyContent="flex-end">
        <AlertDialog.Cancel asChild>
          <Button
            onPress={() => {
              onClose()
            }}
            chromeless
          >
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <AlertDialog.Action asChild>
          <Button
            theme="red"
            onPress={() => {
              removeSite.mutate()
              onClose()
            }}
          >
            Remove Site
          </Button>
        </AlertDialog.Action>
      </XStack>
    </YStack>
  )
}

const publishSiteSchema = z.object({
  url: z.string(),
})
type PublishSiteFields = z.infer<typeof publishSiteSchema>

function PublishDialogContainer({
  children,
  heading,
  backButton,
}: React.PropsWithChildren<{heading?: string; backButton?: React.ReactNode}>) {
  return (
    <YStack
      gap="$4"
      padding="$4"
      maxWidth={1000}
      maxHeight={800}
      width="80vw"
      height="80vh"
      alignItems="center"
      position="relative"
    >
      {heading ? <Heading size="$2">{heading}</Heading> : null}
      {backButton ? (
        <View position="absolute" top={'$4'} left={'$4'}>
          {backButton}
        </View>
      ) : null}
      <YStack f={1} jc="center" ai="center">
        {children}
      </YStack>
    </YStack>
  )
}

function SeedHostContainer({
  children,
  heading,
  backButton,
}: React.PropsWithChildren<{heading?: string; backButton?: React.ReactNode}>) {
  return (
    <Theme name="dark_blue">
      <YStack
        gap="$4"
        padding="$4"
        maxWidth={1000}
        maxHeight={800}
        width="80vw"
        height="80vh"
        alignItems="center"
        backgroundColor="$background"
        position="relative"
      >
        {heading ? <Heading size="$2">{heading}</Heading> : null}
        {backButton ? (
          <View position="absolute" top={'$4'} left={'$4'}>
            {backButton}
          </View>
        ) : null}
        <YStack f={1} jc="center" ai="center">
          {children}
        </YStack>
      </YStack>
    </Theme>
  )
}

function PublishSiteDialog({
  input,
  onClose,
}: {
  input: {
    id: UnpackedHypermediaId
    step?: 'seed-host-custom-domain' | undefined
  }
  onClose: () => void
}) {
  const experiments = useExperiments()
  const {id, step: initialStep} = input
  const [mode, setMode] = useState<
    | 'input-url'
    | 'self-host'
    | 'seed-host'
    | 'seed-host-custom-domain'
    | 'domain-published'
    | null
  >(initialStep || null)
  const [host, setHost] = useState<string | null>(null)
  if (!experiments.data?.hosting) {
    return <PublishWithUrl id={id} onComplete={onClose} />
  }
  if (mode === 'input-url') {
    return (
      <PublishWithUrl
        id={id}
        onComplete={onClose}
        onBack={() => setMode(null)}
      />
    )
  }
  if (mode === 'self-host') {
    return (
      <SelfHostContent
        onSetupUrl={() => setMode('input-url')}
        onBack={() => setMode(null)}
      />
    )
  }
  if (mode === 'seed-host') {
    return (
      <SeedHostContent
        onClose={onClose}
        onBack={() => setMode(null)}
        id={id}
        onCompletePublish={(host) => {
          setHost(host)
          setMode('domain-published')
        }}
      />
    )
  }
  if (mode === 'seed-host-custom-domain') {
    return (
      <SeedHostRegisterCustomDomain
        id={id}
        onCompletePublish={(host) => {
          setHost(host)
          setMode('domain-published')
        }}
      />
    )
  }
  if (mode === 'domain-published' && host) {
    return <SeedHostDomainPublished host={host} onClose={onClose} id={id} />
  }
  return (
    <PublishDialogContainer heading="Set Up Web Domain">
      <YStack f={1} jc="center">
        <DialogInner>
          <SizableText>How would you like to publish to the web?</SizableText>
          <YStack
            backgroundColor="$color6"
            borderRadius="$3"
            padding="$2"
            gap="$2"
          >
            <PublishOptionButton
              icon={SeedHost}
              onPress={() => setMode('seed-host')}
              label="Free Hosting by Seed Hypermedia"
              color="#0081f1"
              height={60}
            />
            <PublishOptionButton
              icon={SelfHost}
              onPress={() => setMode('self-host')}
              label="Self Host on Your Own Server"
            />
            <PublishOptionButton
              icon={PasteSetupUrl}
              onPress={() => setMode('input-url')}
              label="Paste a Hosting Setup URL"
            />
          </YStack>
        </DialogInner>
      </YStack>
    </PublishDialogContainer>
  )
}

const DialogInner = styled(YStack, {
  maxWidth: 400,
  gap: '$2',
})

const BlueButton = styled(Button, {
  backgroundColor: '$blue11',
  hoverStyle: {
    backgroundColor: '$blue10',
  },
})

function PublishOptionButton({
  icon: Icon,
  onPress,
  label,
  color,
  height,
}: {
  icon: IconComponent
  onPress: () => void
  label: string
  color?: string
  height?: number
}) {
  return (
    <Button onPress={onPress} height={height}>
      <XStack f={1} ai="center" gap="$2">
        <Icon color={color} size={32} />
        <SizableText color={color}>{label}</SizableText>
      </XStack>
    </Button>
  )
}

function BackButton({onPress}: {onPress: () => void}) {
  return <Button onPress={onPress} icon={ArrowLeft} chromeless />
}

function SeedHostInfo({
  info,
  onSubmit,
}: {
  info: HostInfoResponse
  onSubmit: () => void
}) {
  return (
    <>
      <SizableText>
        BASIC GB STORAGE: {info.pricing?.base?.gbStorage}
      </SizableText>
      <XStack gap="$3">
        <Button onPress={onSubmit} backgroundColor="$blue9">
          Go Next
        </Button>
      </XStack>
    </>
  )
}

function versionToInt(version: string): number | null {
  const parts = version.split('.')
  if (parts.length !== 3) return null
  return (
    parseInt(parts[0]) * 10_000 + parseInt(parts[1]) * 1000 + parseInt(parts[2])
  )
}

function isAppVersionEqualOrAbove(version: string) {
  if (VERSION === '0.0.0.local-dev') return true // for local dev
  const expectedVersionInt = versionToInt(version)
  const currentVersionInt = versionToInt(VERSION)
  if (expectedVersionInt === null || currentVersionInt === null) return false
  return currentVersionInt >= expectedVersionInt
}

function SeedHostIntro({
  onSubmit,
  onBack,
  info,
  infoError,
  infoIsLoading,
}: {
  onSubmit: () => void
  onBack: () => void
  info?: HostInfoResponse
  infoError?: unknown
  infoIsLoading: boolean
}) {
  let content = infoIsLoading ? <Spinner /> : null
  const isInvalidVersion =
    info?.minimumAppVersion && !isAppVersionEqualOrAbove(info.minimumAppVersion)
  if (info && !info.serviceErrorMessage && !isInvalidVersion) {
    content = <SeedHostInfo info={info} onSubmit={onSubmit} />
  } else if (infoError || info?.serviceErrorMessage || isInvalidVersion) {
    const invalidVersionMessage = isInvalidVersion
      ? 'The service has been updated. You must update to the latest version of the app.'
      : null
    content = (
      <SizableText color="$red11">
        {infoError?.message ||
          info?.serviceErrorMessage ||
          invalidVersionMessage}
      </SizableText>
    )
  }
  return (
    <SeedHostContainer
      heading="Hosting by Seed Hypermedia"
      backButton={<BackButton onPress={onBack} />}
    >
      {content}
    </SeedHostContainer>
  )
}

const LoginSchema = z.object({
  email: z.string(),
})
type LoginFields = z.infer<typeof LoginSchema>
function SeedHostLogin({
  onAuthenticated,
  onBack,
}: {
  onAuthenticated: () => void
  onBack: () => void
}) {
  const {login, email, isSendingEmail, isPendingEmailValidation, error, reset} =
    useHostSession({onAuthenticated})

  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<LoginFields>({
    resolver: zodResolver(LoginSchema),
  })
  const onSubmit: SubmitHandler<LoginFields> = (data) => {
    login(data.email)
  }
  if (isPendingEmailValidation && email) {
    return (
      <SeedHostContainer
        heading="Login to Seed Hypermedia Hosting"
        backButton={<BackButton onPress={onBack} />}
      >
        <DialogInner>
          <Heading>Waiting for Email Validation</Heading>
          {error ? (
            <>
              <SizableText color="$red11">{error}</SizableText>
              <Button onPress={reset} />
            </>
          ) : (
            <>
              <SizableText>
                We sent a verification link to {email}. Click on it, and you
                will be logged in.
              </SizableText>
              <Spinner />
            </>
          )}
        </DialogInner>
      </SeedHostContainer>
    )
  }
  return (
    <SeedHostContainer
      heading="Login to Seed Hypermedia Hosting"
      backButton={<BackButton onPress={onBack} />}
    >
      <Form onSubmit={handleSubmit(onSubmit)} gap="$4">
        {isSendingEmail ? (
          <Spinner />
        ) : (
          <FormField name="email" label="Email" errors={errors}>
            <FormInput control={control} name="email" placeholder="Email" />
          </FormField>
        )}
        <Form.Trigger asChild>
          <Button theme="green" disabled={isSendingEmail}>
            {isSendingEmail ? 'Sending Email...' : 'Authenticate with Email'}
          </Button>
        </Form.Trigger>
      </Form>
    </SeedHostContainer>
  )
}

const RegisterSubdomainSchema = z.object({
  subdomain: z.string(),
})
type RegisterSubdomainFields = z.infer<typeof RegisterSubdomainSchema>
function SeedHostRegisterSubdomain({
  onBack,
  info,
  onPublished,
  id,
}: {
  onBack: () => void
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
  })
  if (!loggedIn) throw new Error('Not logged in')
  function onSubmit({subdomain}: RegisterSubdomainFields) {
    createSite
      .mutateAsync({subdomain})
      .then(async ({subdomain, registrationSecret, setupUrl, host}) => {
        const siteRegistration = await register.mutateAsync({
          url: setupUrl,
        })
        return {host}
      })
      .then(({host}) => {
        onPublished(host)
      })
  }
  return (
    <SeedHostContainer
      heading="Register Hyper.Media Subdomain"
      backButton={<BackButton onPress={onBack} />}
    >
      <XStack>
        <SizableText>Logged in as </SizableText>
        <HoverCard
          content={
            <YStack gap="$2" padding="$2">
              <SizableText>
                Logged into {SEED_HOST_URL} as {email}
              </SizableText>
              <Button
                onPress={() => {
                  onBack()
                  logout()
                }}
              >
                Log Out
              </Button>
            </YStack>
          }
        >
          <SizableText color="$blue11">{email}</SizableText>
        </HoverCard>
      </XStack>
      <Form onSubmit={handleSubmit(onSubmit)} gap="$4">
        <FormField
          name="subdomain"
          label={`Subdomain on ${info?.hostDomain}`}
          errors={errors}
        >
          <FormInput
            control={control}
            name="subdomain"
            placeholder="my-site-name"
            // appendix={info?.hostDomain}
          />
        </FormField>
        <XStack space="$3" justifyContent="flex-end" gap="$4">
          <Form.Trigger asChild>
            <Button icon={UploadCloud} theme="green">
              Publish Site
            </Button>
          </Form.Trigger>
        </XStack>
      </Form>
    </SeedHostContainer>
  )
}

function SeedHostSubdomainPublished({
  onClose,
  host,
  id,
  onCustomDomain,
}: {
  onClose: () => void
  host: string
  id: UnpackedHypermediaId
  onCustomDomain: () => void
}) {
  return (
    <SeedHostContainer heading="Site Published!">
      <SizableText>
        Your site is published to {host}. You can now publish your custom
        domain.
      </SizableText>
      <XStack gap="$3">
        <Button onPress={onClose} iconAfter={Check}>
          Close
        </Button>
        <BlueButton onPress={onCustomDomain} iconAfter={ArrowRight}>
          Publish Custom Domain
        </BlueButton>
      </XStack>
    </SeedHostContainer>
  )
}

function SeedHostDomainPublished({
  onClose,
  host,
  id,
}: {
  onClose: () => void
  host: string
  id: UnpackedHypermediaId
}) {
  return (
    <SeedHostContainer heading={`Now Published to ${host}!`}>
      <SizableText>Congrats!</SizableText>
      <XStack>
        <Button onPress={onClose}>Close</Button>
      </XStack>
    </SeedHostContainer>
  )
}

const RegisterCustomDomainSchema = z.object({
  domain: z.string(),
})
type RegisterCustomDomainFields = z.infer<typeof RegisterCustomDomainSchema>
function SeedHostRegisterCustomDomain({
  onBack,
  onCompletePublish,
  id,
}: {
  onBack?: () => void
  onCompletePublish: (domain: string) => void
  id: UnpackedHypermediaId
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
  const entity = useEntity(id)
  const [pendingDomainName, setPendingDomainName] = useState<string | null>(
    null,
  )
  const siteUrl = entity.data?.document?.metadata?.siteUrl
  function onSubmit({domain}: RegisterCustomDomainFields) {
    if (!siteUrl) throw new Error('Site URL not found')
    console.log('WILL REGISTER custom domain', domain)
    createDomain
      .mutateAsync({
        hostname: domain,
        currentSiteUrl: siteUrl,
        id,
      })
      .then(() => {
        setPendingDomainName(domain)
      })
  }
  const pendingDomain = useHostSession().pendingDomains?.find(
    (pending) => pending.siteUid === id.uid,
  )
  useEffect(() => {
    if (pendingDomainName && siteUrl === `https://${pendingDomainName}`) {
      onCompletePublish(pendingDomainName)
    }
  }, [siteUrl, pendingDomainName])
  if (pendingDomain || createDomain.isLoading) {
    let pendingStatus = null
    if (pendingDomain?.status === 'error') {
      pendingStatus = (
        <SizableText color="$red11">
          Something went wrong. Please try domain setup again.
        </SizableText>
      )
    } else if (pendingDomain?.status === 'waiting-dns') {
      pendingStatus = (
        <SizableText>
          Waiting for you to set up DNS. Point it to{' '}
          {hostnameStripProtocol(siteUrl)} (TODO: instructions here)
        </SizableText>
      )
    } else if (pendingDomain?.status === 'initializing') {
      pendingStatus = <SizableText>Initializing...</SizableText>
    }
    return (
      <SeedHostContainer heading="Set Up Custom Domain">
        <Spinner />
        {pendingStatus}
      </SeedHostContainer>
    )
  }
  return (
    <SeedHostContainer
      heading="Set Up Custom Domain"
      backButton={onBack ? <BackButton onPress={onBack} /> : null}
    >
      {siteUrl ? (
        <>
          <DialogInner>
            <SizableText>
              You can now publish to a custom domain that you already own. On
              the next step you will be asked to update your DNS settings to
              point to the Seed Host service.
            </SizableText>
          </DialogInner>
          <Form onSubmit={handleSubmit(onSubmit)} gap="$4">
            <FormField name="domain" label="Domain" errors={errors}>
              <FormInput
                control={control}
                name="domain"
                placeholder="example.com"
              />
            </FormField>
            <XStack space="$3" justifyContent="flex-end" gap="$4">
              <Form.Trigger asChild>
                <BlueButton iconAfter={UploadCloud}>
                  Publish to Domain
                </BlueButton>
              </Form.Trigger>
            </XStack>
          </Form>
        </>
      ) : (
        <SizableText>You need to publish your site first.</SizableText>
      )}
    </SeedHostContainer>
  )
}
function SeedHostContent({
  onBack,
  onClose,
  id,
  onCompletePublish,
}: {
  onBack: () => void
  onClose: () => void
  id: UnpackedHypermediaId
  onCompletePublish: (host: string) => void
}) {
  const {loggedIn, hostInfo} = useHostSession({})
  const [host, setHost] = useState<string | null>(null)
  const [mode, setMode] = useState<
    | 'intro'
    | 'login'
    | 'register-subdomain'
    | 'subdomain-published'
    | 'register-custom-domain'
  >('intro')
  console.log('hostInfo', hostInfo.data)
  console.log('mode', mode)
  if (mode === 'intro') {
    return (
      <SeedHostIntro
        onSubmit={() => setMode(loggedIn ? 'register-subdomain' : 'login')}
        onBack={onBack}
        info={hostInfo.data}
        infoError={hostInfo.error}
        infoIsLoading={hostInfo.isLoading}
      />
    )
  }
  if (mode === 'login') {
    return (
      <SeedHostLogin
        onAuthenticated={() => setMode('register-subdomain')}
        onBack={() => {
          setMode('intro')
        }}
      />
    )
  }
  if (mode === 'register-subdomain') {
    return (
      <SeedHostRegisterSubdomain
        id={id}
        info={hostInfo.data}
        onPublished={(host) => {
          setMode('subdomain-published')
          setHost(host)
        }}
        onBack={onBack}
      />
    )
  }
  if (mode === 'subdomain-published' && host) {
    return (
      <SeedHostSubdomainPublished
        onCustomDomain={() => setMode('register-custom-domain')}
        host={host}
        onClose={onClose}
        id={id}
      />
    )
  }
  if (mode === 'register-custom-domain') {
    return (
      <SeedHostRegisterCustomDomain
        id={id}
        onCompletePublish={onCompletePublish}
        onBack={() => {
          if (host) setMode('subdomain-published')
          else onClose()
        }}
      />
    )
  }

  return null
}

function SelfHostContent({
  onSetupUrl,
  onBack,
}: {
  onSetupUrl: () => void
  onBack: () => void
}) {
  const spawn = useNavigate('spawn')
  return (
    <PublishDialogContainer
      heading="Host on Your Own Server"
      backButton={<BackButton onPress={onBack} />}
    >
      <DialogInner>
        <SizableText>
          You will need your own server and domain. Follow this guide to get
          started, and return when the setup script has printed the setup URL.
        </SizableText>
        <XStack jc="center" marginVertical="$6">
          <Button
            backgroundColor="$brand6"
            hoverStyle={{backgroundColor: '$brand7'}}
            color="$color1"
            icon={ExternalLink}
            onPress={() => {
              spawn({
                key: 'document',
                id: hmId(
                  'd',
                  'z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS',
                  {
                    path: ['resources', 'self-host-seed'],
                  },
                ),
              })
            }}
          >
            Open Setup Guide
          </Button>
        </XStack>
        <Button onPress={onSetupUrl} iconAfter={ArrowRight} theme="green">
          My Setup URL is Ready
        </Button>
      </DialogInner>
    </PublishDialogContainer>
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
  const entity = useEntity(id)
  const replace = useNavigate('replace')
  const register = useSiteRegistration(id.uid)
  const onSubmit: SubmitHandler<PublishSiteFields> = (data) => {
    register.mutateAsync({url: data.url}).then((publishedUrl) => {
      onComplete()
      toast.success(`Site published to ${publishedUrl}`)
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
    setTimeout(() => {
      setFocus('url')
    }, 300) // wait for animation
  }, [setFocus])

  return (
    <PublishDialogContainer
      heading={`Publish "${getDocumentTitle(
        entity.data?.document,
      )}" with a Hosting Setup URL`}
      backButton={onBack ? <BackButton onPress={onBack} /> : null}
    >
      {register.error ? (
        <SizableText color="$red11">
          {register.error.message
            ? register.error.message
            : JSON.stringify(register.error)}
        </SizableText>
      ) : null}
      {/* <DialogDescription>description</DialogDescription> */}
      <Form onSubmit={handleSubmit(onSubmit)} gap="$4">
        <FormField name="url" label="Site Setup URL" errors={errors}>
          <FormInput
            control={control}
            name="url"
            placeholder="https://mysite.com/hm/register?..."
          />
        </FormField>
        <XStack space="$3" justifyContent="flex-end" gap="$4">
          {register.isLoading ? <Spinner /> : null}
          <Form.Trigger asChild>
            <Button icon={UploadCloud} theme="green">
              Publish Site
            </Button>
          </Form.Trigger>
        </XStack>
      </Form>
    </PublishDialogContainer>
  )
}

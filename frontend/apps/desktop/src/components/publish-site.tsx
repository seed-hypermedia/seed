import {useHostSession} from '@/models/host'
import {useRemoveSite, useSiteRegistration} from '@/models/site'
import {useNavigate} from '@/utils/useNavigate'
import {zodResolver} from '@hookform/resolvers/zod'
import {hmId} from '@shm/shared'
import {getDocumentTitle} from '@shm/shared/content'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {UploadCloud} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {ArrowLeft, Cloud} from '@tamagui/lucide-icons'
import {useEffect, useState} from 'react'
import {SubmitHandler, useForm} from 'react-hook-form'
import {AlertDialog, Form, Heading, SizableText, XStack, YStack} from 'tamagui'
import {z} from 'zod'
import {useAppDialog} from './dialog'

export function usePublishSite() {
  return useAppDialog(PublishSiteDialog)
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
  const {id, step: initialStep} = input
  const [mode, setMode] = useState<
    'input-url' | 'self-host' | 'seed-host' | 'seed-host-custom-domain' | null
  >(initialStep || null)
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
        onSetupUrl={() => setMode('seed-host')}
        onBack={() => setMode(null)}
      />
    )
  }
  if (mode === 'seed-host') {
    return (
      <SeedHostContent onClose={onClose} onBack={() => setMode(null)} id={id} />
    )
  }
  if (mode === 'seed-host-custom-domain') {
    return <SeedHostRegisterCustomDomain onBack={() => setMode(null)} id={id} />
  }
  return (
    <>
      <Heading>Set Up Web Domain</Heading>
      <Button icon={Cloud} onPress={() => setMode('self-host')}>
        Self Host
      </Button>
      <Button icon={Cloud} onPress={() => setMode('seed-host')}>
        Seed Host
      </Button>
      <Button icon={Cloud} onPress={() => setMode('input-url')}>
        Paste the Setup URL
      </Button>
    </>
  )
}

function BackButton({onPress}: {onPress: () => void}) {
  return <Button onPress={onPress} icon={ArrowLeft} chromeless />
}

function SeedHostIntro({
  onSubmit,
  onBack,
}: {
  onSubmit: () => void
  onBack: () => void
}) {
  return (
    <YStack position="relative">
      <BackButton onPress={onBack} />
      <Heading>Seed Host</Heading>
      <SizableText>blah blah pricing</SizableText>
      <XStack gap="$3">
        <Button onPress={onSubmit}>Go Next</Button>
      </XStack>
    </YStack>
  )
}

const LoginSchema = z.object({
  email: z.string(),
})
type LoginFields = z.infer<typeof LoginSchema>
function SeedHostLogin({onAuthenticated}: {onAuthenticated: () => void}) {
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
      <YStack>
        <Heading>Waiting for Email Validation</Heading>
        {error ? (
          <>
            <SizableText color="$red11">{error}</SizableText>
            <Button onPress={reset} />
          </>
        ) : (
          <SizableText>
            We sent a verification link to {email}. Click on it, and you will be
            logged in.
          </SizableText>
        )}
      </YStack>
    )
  }
  return (
    <YStack position="relative">
      <Heading>Login</Heading>
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
    </YStack>
  )
}

const RegisterSubdomainSchema = z.object({
  subdomain: z.string(),
})
type RegisterSubdomainFields = z.infer<typeof RegisterSubdomainSchema>
function SeedHostRegisterSubdomain({
  onBack,
  onPublished,
  id,
}: {
  onBack: () => void
  onPublished: (host: string) => void
  id: UnpackedHypermediaId
}) {
  const {loggedIn, email, createSite} = useHostSession({})
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
    <YStack position="relative">
      <Heading>Register Subdomain</Heading>
      <SizableText>Logged in as {email}</SizableText>
      <Form onSubmit={handleSubmit(onSubmit)} gap="$4">
        <FormField name="subdomain" label="Subdomain" errors={errors}>
          <FormInput
            control={control}
            name="subdomain"
            placeholder="Subdomain"
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
    </YStack>
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
    <YStack>
      <Heading>Site Published</Heading>
      <SizableText>
        Your site is published to {host}. You can now publish your custom
        domain.
      </SizableText>
      <XStack>
        <Button onPress={onClose}>Close</Button>
        <Button onPress={onCustomDomain}>Publish Custom Domain</Button>
      </XStack>
    </YStack>
  )
}
const RegisterCustomDomainSchema = z.object({
  domain: z.string(),
})
type RegisterCustomDomainFields = z.infer<typeof RegisterCustomDomainSchema>
function SeedHostRegisterCustomDomain({
  onBack,
  id,
}: {
  onBack: () => void
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
  const siteUrl = entity.data?.document?.metadata?.siteUrl
  function onSubmit({domain}: RegisterCustomDomainFields) {
    if (!siteUrl) throw new Error('Site URL not found')
    console.log('WILL REGISTER custom domain', domain)
    createDomain.mutateAsync({
      hostname: domain,
      currentSiteUrl: siteUrl,
    })
  }
  console.log({siteUrl, id})
  return (
    <YStack>
      <Heading>Register Custom Domain</Heading>
      {siteUrl ? (
        <>
          <SizableText>You can now publish your custom domain.</SizableText>
          <Form onSubmit={handleSubmit(onSubmit)} gap="$4">
            <FormField name="domain" label="Domain" errors={errors}>
              <FormInput control={control} name="domain" placeholder="Domain" />
            </FormField>
            <XStack space="$3" justifyContent="flex-end" gap="$4">
              <Form.Trigger asChild>
                <Button icon={UploadCloud} theme="green">
                  Publish Site
                </Button>
              </Form.Trigger>
            </XStack>
          </Form>
        </>
      ) : (
        <SizableText>You need to publish your site first.</SizableText>
      )}
    </YStack>
  )
}
function SeedHostContent({
  onBack,
  onClose,
  id,
}: {
  onBack: () => void
  onClose: () => void
  id: UnpackedHypermediaId
}) {
  const {loggedIn} = useHostSession({})
  const [host, setHost] = useState<string | null>(null)
  const [mode, setMode] = useState<
    | 'intro'
    | 'login'
    | 'register-subdomain'
    | 'subdomain-published'
    | 'register-custom-domain'
  >('intro')
  if (mode === 'intro') {
    return (
      <SeedHostIntro
        onSubmit={() => setMode(loggedIn ? 'register-subdomain' : 'login')}
        onBack={onBack}
      />
    )
  }
  if (mode === 'login') {
    return (
      <SeedHostLogin onAuthenticated={() => setMode('register-subdomain')} />
    )
  }
  if (mode === 'register-subdomain') {
    return (
      <SeedHostRegisterSubdomain
        id={id}
        onPublished={(host) => {
          setMode('subdomain-published')
          setHost(host)
        }}
        onBack={() => setMode('register-custom-domain')}
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
      <SeedHostRegisterCustomDomain id={id} onBack={() => setMode('intro')} />
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
    <YStack position="relative">
      <BackButton onPress={onBack} />
      <Heading>Self Host</Heading>
      <SizableText>
        You will need your own web server and domain. Follow this guide to get
        started, and return when you have the setup URL.
      </SizableText>
      <XStack>
        <Button
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
          Setup Guide
        </Button>
      </XStack>
      <XStack jc="flex-end">
        <Button onPress={onSetupUrl}>My Setup URL is Ready</Button>
      </XStack>
    </YStack>
  )
}

function PublishWithUrl({
  id,
  onComplete,
  onBack,
}: {
  id: UnpackedHypermediaId
  onComplete: () => void
  onBack: () => void
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
    <YStack>
      <BackButton onPress={onBack} />
      <Heading>
        Publish "{getDocumentTitle(entity.data?.document)}" to the web
      </Heading>
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
    </YStack>
  )
}

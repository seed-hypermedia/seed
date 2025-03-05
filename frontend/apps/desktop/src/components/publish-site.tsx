import {useRemoveSite, useSiteRegistration} from '@/models/site'
import {useNavigate} from '@/utils/useNavigate'
import {zodResolver} from '@hookform/resolvers/zod'
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
  input: UnpackedHypermediaId
  onClose: () => void
}) {
  const [mode, setMode] = useState<
    'input-url' | 'self-host' | 'seed-host' | null
  >(null)
  if (mode === 'input-url') {
    return (
      <PublishWithUrl
        id={input}
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
    return <SeedHostContent onBack={() => setMode(null)} />
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

function SeedHostContent({onBack}: {onBack: () => void}) {
  return (
    <YStack position="relative">
      <BackButton onPress={onBack} />
      <Heading>Seed Host</Heading>
      <SizableText>HELLO! </SizableText>
    </YStack>
  )
}
function SelfHostContent({
  onSetupUrl,
  onBack,
}: {
  onSetupUrl: () => void
  onBack: () => void
}) {
  return (
    <YStack position="relative">
      <BackButton onPress={onBack} />
      <Heading>Self Host</Heading>
      <SizableText>
        You will need your own web server and domain. Follow this guide to get
        started, and return when you have the setup URL.
      </SizableText>
      <XStack>
        <Button onPress={() => {}}>Setup Guide</Button>
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

import {useEntity} from '@/models/entities'
import {useRemoveSite, useSiteRegistration} from '@/models/site'
import {zodResolver} from '@hookform/resolvers/zod'
import {getDocumentTitle, UnpackedHypermediaId} from '@shm/shared'
import {AlertDialog, Button, Form, SizableText, XStack, YStack} from '@shm/ui'
import {Spinner} from '@shm/ui/src/spinner'
import {UploadCloud} from '@tamagui/lucide-icons'
import {useEffect} from 'react'
import {SubmitHandler, useForm} from 'react-hook-form'
import {z} from 'zod'
import {DialogTitle, useAppDialog} from './dialog'
import {FormInput} from './form-input'
import {FormField} from './forms'

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
  const entity = useEntity(input)
  const register = useSiteRegistration(input.uid)
  const onSubmit: SubmitHandler<PublishSiteFields> = (data) => {
    register.mutateAsync({url: data.url}).then(() => {
      onClose()
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
    <>
      <DialogTitle>
        Publish "{getDocumentTitle(entity.data?.document)}" to the web
      </DialogTitle>
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
    </>
  )
}

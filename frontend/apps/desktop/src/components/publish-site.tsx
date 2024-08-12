import {useEntity} from '@/models/entities'
import {useSiteRegistration} from '@/models/site'
import {useNavigate} from '@/utils/useNavigate'
import {zodResolver} from '@hookform/resolvers/zod'
import {getDocumentTitle, UnpackedHypermediaId} from '@shm/shared'
import {Button} from '@shm/ui'
import {Spinner} from '@shm/ui/src/spinner'
import {useEffect} from 'react'
import {SubmitHandler, useForm} from 'react-hook-form'
import {Form, SizableText, XStack} from 'tamagui'
import {z} from 'zod'
import {DialogTitle, useAppDialog} from './dialog'
import {FormInput} from './form-input'
import {FormField} from './forms'

export function usePublishSite() {
  return useAppDialog(PublishSiteDialog)
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
  const navigate = useNavigate()
  const entity = useEntity(input)
  const register = useSiteRegistration()
  const onSubmit: SubmitHandler<PublishSiteFields> = (data) => {
    register.mutateAsync({url: data.url, accountUid: input.uid}).then(() => {
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
        <SizableText theme="red">{JSON.stringify(register.error)}</SizableText>
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
        <XStack space="$3" justifyContent="flex-end">
          {register.isLoading ? <Spinner /> : null}
          <Form.Trigger asChild>
            <Button>Publish</Button>
          </Form.Trigger>
        </XStack>
      </Form>
    </>
  )
}

import {zodResolver} from '@hookform/resolvers/zod'
import {useTxString} from '@shm/shared/translation'
import {FormCheckbox, FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {Spinner} from '@shm/ui/spinner'
import {useEffect} from 'react'
import {Control, useController, useForm} from 'react-hook-form'
import {Form, XStack, YStack} from 'tamagui'
import {z} from 'zod'
import {Button} from './legacy/button'
import {SizableText} from './text'

const emailNotificationsSchema = z.object({
  email: z.string().email(),
  notifyAllMentions: z.boolean(),
  notifyAllReplies: z.boolean(),
})

export type UIEmailNotificationsFormSchema = z.infer<
  typeof emailNotificationsSchema
>

export function UIEmailNotificationsForm({
  onClose,
  onComplete,
  defaultValues,
  setEmailNotifications,
  isLoading,
}: {
  onClose: () => void
  onComplete: () => void
  defaultValues?: z.infer<typeof emailNotificationsSchema>
  setEmailNotifications: (
    input: UIEmailNotificationsFormSchema,
  ) => Promise<void>
  isLoading: boolean
}) {
  const tx = useTxString()
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<z.infer<typeof emailNotificationsSchema>>({
    resolver: zodResolver(emailNotificationsSchema),
    defaultValues: defaultValues || {
      email: '',
      notifyAllMentions: true,
      notifyAllReplies: true,
    },
  })
  function onSubmit(data: z.infer<typeof emailNotificationsSchema>) {
    console.log('data', data)
    setEmailNotifications(data).then(() => {
      // onClose()
      onComplete()
    })
  }
  useEffect(() => {
    setFocus('email')
  }, [setFocus])
  return (
    <Form onSubmit={handleSubmit(onSubmit)} gap="$4">
      <FormField
        name="email"
        label={tx('Notification Email')}
        errors={errors}
        paddingHorizontal={0}
      >
        <FormInput
          name="email"
          control={control}
          placeholder="me@example.com"
        />
      </FormField>
      <YStack gap="$3">
        <SizableText>{tx('Notify me when')}:</SizableText>
        <FormCheckbox
          name="notifyAllMentions"
          label={tx('Someone mentions me')}
          control={control}
        />
        <FormCheckbox
          name="notifyAllReplies"
          label={tx('Someone replies to me')}
          control={control}
        />
      </YStack>
      <EmptyNotifWarning control={control} />
      <XStack jc="flex-end" gap="$3" alignItems="center">
        <Spinner hide={!isLoading} />
        <Button
          // @ts-expect-error
          type="button" // Prevent form submission
          onPress={() => {
            onClose()
          }}
        >
          {tx('Cancel')}
        </Button>
        <Form.Trigger asChild>
          <Button bg="$brand5" color="white">
            {tx('Save Notification Settings')}
          </Button>
        </Form.Trigger>
      </XStack>
    </Form>
  )
}

function EmptyNotifWarning({
  control,
}: {
  control: Control<z.infer<typeof emailNotificationsSchema>>
}) {
  const tx = useTxString()
  const {field: notifyAllMentionsField} = useController({
    control,
    name: 'notifyAllMentions',
  })
  const {field: notifyAllRepliesField} = useController({
    control,
    name: 'notifyAllReplies',
  })
  if (notifyAllMentionsField.value || notifyAllRepliesField.value) return null
  return (
    <SizableText color="$red10">
      {tx('You will not receive any notifications.')}
    </SizableText>
  )
}

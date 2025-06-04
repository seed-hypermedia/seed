import {zodResolver} from '@hookform/resolvers/zod'
import {Button} from '@shm/ui/button'
import {FormCheckbox, FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {Spinner} from '@shm/ui/spinner'
import {useEffect} from 'react'
import {Control, useController, useForm} from 'react-hook-form'
import {Form, SizableText, XStack, YStack} from 'tamagui'
import {z} from 'zod'

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
        label="Notification Email"
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
        <SizableText>Notify me when:</SizableText>
        <FormCheckbox
          name="notifyAllMentions"
          label="Someone mentions me"
          control={control}
        />
        <FormCheckbox
          name="notifyAllReplies"
          label="Someone replies to me"
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
          Cancel
        </Button>
        <Form.Trigger asChild>
          <Button theme="blue">Save Notification Settings</Button>
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
      You will not receive any notifications.
    </SizableText>
  )
}

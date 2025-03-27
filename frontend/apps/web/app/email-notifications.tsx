import {zodResolver} from '@hookform/resolvers/zod'
import {Button} from '@shm/ui/button'
import {FormCheckbox, FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {DialogTitle} from '@shm/ui/universal-dialog'
import {useEffect} from 'react'
import {Control, useController, useForm} from 'react-hook-form'
import {Form, SizableText, Spinner, XStack, YStack} from 'tamagui'
import {z} from 'zod'
import {
  useEmailNotifications,
  useSetEmailNotifications,
} from './email-notifications-models'

const emailNotificationsSchema = z.object({
  email: z.string().email(),
  notifyAllMentions: z.boolean(),
  notifyAllReplies: z.boolean(),
})

export function EmailNotificationsForm({
  onClose,
  onComplete,
  defaultValues,
}: {
  onClose: () => void
  onComplete: () => void
  defaultValues?: z.infer<typeof emailNotificationsSchema>
}) {
  const {mutateAsync: setEmailNotifications, isLoading} =
    useSetEmailNotifications()
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
      <XStack jc="flex-end" gap="$3">
        <Spinner opacity={isLoading ? 1 : 0} />
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

export function NotifSettingsDialog({onClose}: {onClose: () => void}) {
  const {data: emailNotifications, isLoading: isEmailNotificationsLoading} =
    useEmailNotifications()
  console.log('emailNotifications', emailNotifications)
  if (isEmailNotificationsLoading) return <Spinner /> // todo: make it look better
  return (
    <YStack gap="$4">
      <DialogTitle>Email Notification Settings</DialogTitle>
      <EmailNotificationsForm
        onClose={onClose}
        onComplete={onClose}
        defaultValues={emailNotifications?.account}
      />
    </YStack>
  )
}

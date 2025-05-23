import {UIEmailNotificationsForm} from '@shm/ui/email-notifications'
import {DialogTitle} from '@shm/ui/universal-dialog'
import {Control, useController} from 'react-hook-form'
import {SizableText, Spinner, YStack} from 'tamagui'
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
  const {mutateAsync, isLoading} = useSetEmailNotifications()
  return (
    <UIEmailNotificationsForm
      setEmailNotifications={mutateAsync}
      isLoading={isLoading}
      onClose={onClose}
      onComplete={onComplete}
      defaultValues={defaultValues}
    />
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

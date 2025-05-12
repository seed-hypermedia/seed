import {DialogTitle} from '@/components/dialog'
import {
  useEmailNotifications,
  useSetEmailNotifications,
} from '@/models/email-notifications'
import {UIEmailNotificationsForm} from '@shm/ui/email-notifications'
import {Spinner, YStack} from 'tamagui'

export function NotifSettingsDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {accountUid: string; title: string}
}) {
  const {data: emailNotifications, isLoading: isEmailNotificationsLoading} =
    useEmailNotifications(input.accountUid)
  const setEmailNotifications = useSetEmailNotifications(input.accountUid)
  if (isEmailNotificationsLoading) return <Spinner /> // todo: make it look better
  return (
    <YStack gap="$4">
      <DialogTitle>{input.title || 'Email Notification Settings'}</DialogTitle>
      <UIEmailNotificationsForm
        onClose={onClose}
        onComplete={onClose}
        defaultValues={emailNotifications?.account}
        setEmailNotifications={setEmailNotifications.mutateAsync}
        isLoading={setEmailNotifications.isLoading}
      />
    </YStack>
  )
}

import {DialogTitle} from '@/components/dialog'
import {
  useEmailNotifications,
  useSetEmailNotifications,
} from '@/models/email-notifications'
import {useTx} from '@shm/shared/translation'
import {UIEmailNotificationsForm} from '@shm/ui/email-notifications'
import {Spinner} from '@shm/ui/spinner'
import {YStack} from 'tamagui'

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
  const tx = useTx()
  if (isEmailNotificationsLoading)
    return (
      <div className="flex justify-center items-center">
        <Spinner />
      </div>
    ) // todo: make it look better
  return (
    <YStack gap="$4">
      <DialogTitle>
        {input.title || tx('Email Notification Settings')}
      </DialogTitle>
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

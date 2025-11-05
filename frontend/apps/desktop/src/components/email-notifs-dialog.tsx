import {
  useEmailNotifications,
  useSetEmailNotifications,
} from '@/models/email-notifications'
import {useTx} from '@shm/shared/translation'
import {DialogTitle} from '@shm/ui/components/dialog'
import {UIEmailNotificationsForm} from '@shm/ui/email-notifications'
import {Spinner} from '@shm/ui/spinner'

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
  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>
        {input.title || tx('Email Notification Settings')}
      </DialogTitle>
      {
        isEmailNotificationsLoading ? (
          <div className="flex items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <UIEmailNotificationsForm
            onClose={onClose}
            onComplete={onClose}
            defaultValues={emailNotifications?.account}
            setEmailNotifications={setEmailNotifications.mutateAsync}
            isLoading={setEmailNotifications.isLoading}
          />
        ) // todo: make it look better
      }
    </div>
  )
}

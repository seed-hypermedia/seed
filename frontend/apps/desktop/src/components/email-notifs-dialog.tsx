import {useSubscribeToNotifications} from '@shm/shared/models/email-notifications'
import {useTx} from '@shm/shared/translation'
import {DialogTitle} from '@shm/ui/components/dialog'
import {
  UIEmailNotificationsForm,
  UIEmailNotificationsFormSchema,
} from '@shm/ui/email-notifications'
import {toast} from 'sonner'

export function NotifSettingsDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {accountUid: string; title: string; notifyServiceHost: string}
}) {
  const {mutateAsync, isPending} = useSubscribeToNotifications({
    onError: (error) => {
      toast.error(error.message)
    },
  })
  const tx = useTx()

  const setEmailNotifications = async (
    formData: UIEmailNotificationsFormSchema,
  ) => {
    if (isPending) return
    await mutateAsync({
      notifyServiceHost: input.notifyServiceHost,
      action: 'subscribe',
      email: formData.email,
      accountId: input.accountUid,
      notifyAllMentions: formData.notifyAllMentions,
      notifyAllReplies: formData.notifyAllReplies,
      notifyOwnedDocChange: formData.notifyOwnedDocChange,
      notifySiteDiscussions: formData.notifySiteDiscussions,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <DialogTitle>
        {input.title || tx('Email Notification Settings')}
      </DialogTitle>

      <UIEmailNotificationsForm
        onClose={onClose}
        onComplete={(email) => onClose()}
        setEmailNotifications={setEmailNotifications}
        isPending={isPending}
      />
    </div>
  )
}

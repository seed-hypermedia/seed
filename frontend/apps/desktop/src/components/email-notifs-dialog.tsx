import {useSubscribeToNotifications} from '@shm/shared/models/email-notifications'
import {DialogTitle} from '@shm/ui/components/dialog'
import {
  EmailNotificationsSuccess,
  UIEmailNotificationsForm,
  UIEmailNotificationsFormSchema,
} from '@shm/ui/email-notifications'
import {useState} from 'react'
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
  const [subscribedEmail, setSubscribedEmail] = useState<string | null>(null)
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
  if (subscribedEmail) {
    return (
      <>
        <DialogTitle>Subscription Complete!</DialogTitle>
        <EmailNotificationsSuccess email={subscribedEmail} onClose={onClose} />
      </>
    )
  }

  return (
    <>
      <DialogTitle>{input.title}</DialogTitle>
      <UIEmailNotificationsForm
        onClose={onClose}
        onComplete={(email) => {
          setSubscribedEmail(email)
        }}
        setEmailNotifications={setEmailNotifications}
        isPending={isPending}
      />
    </>
  )
}

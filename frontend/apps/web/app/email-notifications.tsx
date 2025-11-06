import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {useSubscribeToNotifications} from '@shm/shared/models/email-notifications'
import {useAccount} from '@shm/shared/models/entity'
import {
  UIEmailNotificationsForm,
  UIEmailNotificationsFormSchema,
} from '@shm/ui/email-notifications'
import {useLocalKeyPair} from './auth'

export function EmailNotificationsForm({
  onClose,
  onComplete,
}: {
  onClose: () => void
  onComplete: (email: string) => void
}) {
  const keyPair = useLocalKeyPair()
  const account = useAccount(keyPair?.id)
  const {mutateAsync, isPending} = useSubscribeToNotifications()

  const setEmailNotifications = async (
    formData: UIEmailNotificationsFormSchema,
  ) => {
    if (!account.data?.id.uid) return
    if (!NOTIFY_SERVICE_HOST)
      throw new Error('Email notifications service host is not configured')

    await mutateAsync({
      notifyServiceHost: NOTIFY_SERVICE_HOST,
      action: 'subscribe',
      email: formData.email,
      accountId: account.data.id.uid,
      notifyAllMentions: formData.notifyAllMentions,
      notifyAllReplies: formData.notifyAllReplies,
      notifyOwnedDocChange: formData.notifyOwnedDocChange,
      notifySiteDiscussions: formData.notifySiteDiscussions,
    })
  }

  return (
    <UIEmailNotificationsForm
      setEmailNotifications={setEmailNotifications}
      isLoading={isPending}
      onClose={onClose}
      onComplete={onComplete}
    />
  )
}

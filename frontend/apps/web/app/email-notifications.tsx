import {UIEmailNotificationsForm} from '@shm/ui/email-notifications'
import {Spinner} from '@shm/ui/spinner'
import {DialogTitle} from '@shm/ui/universal-dialog'

import {useTxString} from '@shm/shared/translation'
import {z} from 'zod'
import {
  useEmailNotifications,
  useSetEmailNotifications,
} from './email-notifications-models'

const emailNotificationsSchema = z.object({
  email: z.string().email(),
  notifyAllMentions: z.boolean(),
  notifyAllReplies: z.boolean(),
  notifyOwnedDocChange: z.boolean(),
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
  console.log('EmailNotificationsForm', isLoading)
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

export function NotifSettingsDialog({onClose}: {onClose: () => void}) {
  const {data: emailNotifications, isLoading: isEmailNotificationsLoading} =
    useEmailNotifications()
  const tx = useTxString()
  if (isEmailNotificationsLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    ) // todo: make it look better
  return (
    <div>
      <DialogTitle>{tx('Email Notification Settings')}</DialogTitle>
      <EmailNotificationsForm
        onClose={onClose}
        onComplete={onClose}
        defaultValues={emailNotifications?.account}
      />
    </div>
  )
}

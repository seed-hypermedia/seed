import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/frontend/components/ui/dialog'
import {getProfileAvatarImageSrc} from '@/frontend/profile'
import {useAppState} from '@/frontend/store'
import {AccountProfileForm} from '@shm/ui/components/account-profile-form'

/** Dialog for creating or editing a vault account profile. */
export function AccountProfileDialog({
  open,
  onOpenChange,
  title,
  descriptionText,
  submitLabel,
  loading,
  error,
  initialName = '',
  initialDescription = '',
  initialAvatar,
  notificationEmailOption,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  descriptionText: string
  submitLabel: string
  loading?: boolean
  error?: string
  initialName?: string
  initialDescription?: string
  initialAvatar?: string
  notificationEmailOption?: {
    label: string
    description: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }
  onSubmit: (values: {
    name: string
    description?: string
    avatarFile?: File
  }) => Promise<void> | Promise<boolean> | void | boolean
}) {
  const {backendHttpBaseUrl} = useAppState()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{descriptionText}</DialogDescription>
        </DialogHeader>

        <AccountProfileForm
          // Remount per open so the form resets to the latest initial values.
          key={open ? 'open' : 'closed'}
          initialName={initialName}
          initialDescription={initialDescription}
          initialImageUrl={getProfileAvatarImageSrc(backendHttpBaseUrl, initialAvatar)}
          submitLabel={submitLabel}
          loading={loading}
          error={error}
          notificationOption={notificationEmailOption}
          onCancel={() => onOpenChange(false)}
          onSubmit={({name, description, imageFile}) => onSubmit({name, description, avatarFile: imageFile})}
        />
      </DialogContent>
    </Dialog>
  )
}

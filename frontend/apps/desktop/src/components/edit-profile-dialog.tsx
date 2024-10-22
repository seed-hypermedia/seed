import {getFileUrl} from '@shm/shared'
import {Control, useController} from 'react-hook-form'
import {z} from 'zod'
import {useAppDialog} from './dialog'
import {IconForm} from './icon-form'

export function useEditProfileDialog() {
  // for some reason the dialog doesn't work if the input is falsy
  // input is not needed for this dialog, so we just use "true", lol
  return useAppDialog<string>(EditProfileDialog)
}

function EditProfileDialog({onClose}: {onClose: () => void}) {
  return null
}

const profileSchema = z.object({
  alias: z.string().min(1, {message: 'Profile alias is required'}),
  avatar: z.string().optional(),
})
type ProfileFields = z.infer<typeof profileSchema>

function AvatarInput({control}: {control: Control<ProfileFields>}) {
  const c = useController({control, name: 'avatar'})
  return (
    <IconForm
      onIconUpload={c.field.onChange}
      url={c.field.value ? getFileUrl(c.field.value) : undefined}
    />
  )
}

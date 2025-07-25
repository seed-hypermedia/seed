import {useAppDialog} from './dialog'

export function useEditProfileDialog() {
  // for some reason the dialog doesn't work if the input is falsy
  // input is not needed for this dialog, so we just use "true", lol
  return useAppDialog<string>(EditProfileDialog)
}

function EditProfileDialog({onClose}: {onClose: () => void}) {
  return null
}

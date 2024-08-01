import {fileUpload} from '@/utils/file-upload'
import {Stack, Tooltip, UIAvatar} from '@shm/ui'
import {ChangeEvent} from 'react'
import appError from '../errors'

export function AvatarForm({
  url,
  label,
  id,
  size = 140,
  onAvatarUpload,
}: {
  label?: string
  id?: string
  url?: string
  size?: number
  onAvatarUpload?: (avatar: string) => Awaited<void>
}) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    const file = fileList?.[0]
    if (!file) return
    if (!onAvatarUpload) return
    fileUpload(file)
      .then((data) => {
        onAvatarUpload(data)
      })
      .catch((error) => {
        appError(`Failed to upload avatar: ${e.message}`, {error})
      })
      .finally(() => {
        event.target.value = ''
      })
  }

  const avatarImage = (
    <UIAvatar label={label} id={id} size={size} url={url} color="$blue12" />
  )
  if (!onAvatarUpload) return avatarImage
  return (
    <Tooltip content="Click or Drag to Set Image">
      <Stack hoverStyle={{opacity: 0.7}} position="relative">
        <input
          type="file"
          onChange={handleFileChange}
          style={{
            opacity: 0,
            display: 'flex',
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 100,
            cursor: 'pointer',
          }}
        />
        {avatarImage}
      </Stack>
    </Tooltip>
  )
}

import {fileUpload} from '@/utils/file-upload'
import {SizableText, Stack, UIAvatar, XStack} from '@shm/ui'
import {ChangeEvent} from 'react'
import appError from '../errors'

export function AvatarForm({
  url,
  label,
  id,
  size = 140,
  onAvatarUpload,
  ...props
}: {
  label?: string
  id?: string
  url?: string
  size?: number
  onAvatarUpload?: (avatar: string) => Awaited<void>
}) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation()
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
    <Stack
      position="relative"
      {...props}
      group="thumbnail"
      w={size}
      h={size}
      borderRadius={size / 2}
      overflow="hidden"
    >
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
      <XStack
        bg="rgba(0,0,0,0.3)"
        position="absolute"
        zi={101}
        w="100%"
        $group-thumbnail-hover={{opacity: 1}}
        h="100%"
        opacity={0}
        ai="center"
        jc="center"
        pointerEvents="none"
      >
        <SizableText textAlign="center" size="$1" color="white">
          {url ? 'UPDATE' : 'ADD IMAGE'}
        </SizableText>
      </XStack>
      {avatarImage}
    </Stack>
  )
}

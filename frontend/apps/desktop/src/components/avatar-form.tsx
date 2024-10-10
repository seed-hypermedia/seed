import {fileUpload} from '@/utils/file-upload'
import {Button, SizableText, Stack, Tooltip, UIAvatar, XStack} from '@shm/ui'
import {X} from '@tamagui/lucide-icons'
import {ChangeEvent} from 'react'
import appError from '../errors'

export function ThumbnailForm({
  url,
  label,
  id,
  size = 140,
  onAvatarUpload,
  onRemoveThumbnail,
  emptyLabel,
  marginTop,
  borderRadius = size,
  ...props
}: {
  label?: string
  emptyLabel?: string
  id?: string
  url?: string
  size?: number
  marginTop?: number
  borderRadius?: number
  onAvatarUpload?: (avatar: string) => Awaited<void>
  onRemoveThumbnail?: () => void
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
    <UIAvatar
      label={label}
      id={id}
      size={size}
      url={url}
      color="$brand12"
      marginTop={marginTop}
      borderRadius={borderRadius}
    />
  )
  if (!onAvatarUpload) return avatarImage
  return (
    <XStack
      gap="$2"
      ai="flex-end"
      group="thumbnail"
      w="auto"
      alignSelf="flex-start"
    >
      <Stack
        marginTop={marginTop}
        position="relative"
        {...props}
        group="thumbnail"
        w={size}
        h={size}
        borderRadius={borderRadius}
        overflow="hidden"
        {...props}
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
          }}
        />
        {emptyLabel && !url ? (
          <XStack
            bg="rgba(0,0,0,0.3)"
            position="absolute"
            gap="$2"
            zi="$zIndex.5"
            w="100%"
            $group-thumbnail-hover={{opacity: 0}}
            h="100%"
            opacity={1}
            ai="center"
            jc="center"
            pointerEvents="none"
          >
            <SizableText textAlign="center" size="$1" color="white">
              {emptyLabel}
            </SizableText>
          </XStack>
        ) : null}
        <XStack
          bg="rgba(0,0,0,0.3)"
          position="absolute"
          gap="$2"
          zi="$zIndex.5"
          w="100%"
          $group-thumbnail-hover={{opacity: 1}}
          h="100%"
          opacity={0}
          ai="center"
          jc="center"
          pointerEvents="none"
        >
          <SizableText textAlign="center" size="$1" color="white">
            {url ? 'UPDATE' : emptyLabel || 'ADD IMAGE'}
          </SizableText>
        </XStack>
        {avatarImage}
      </Stack>
      {onRemoveThumbnail ? (
        <Tooltip content="Remove Thumbnail">
          <Button
            opacity={0}
            theme="red"
            $group-thumbnail-hover={{opacity: 1, pointerEvents: 'all'}}
            icon={X}
            size="$1"
            fontWeight="600"
            zi="$zIndex.5"
            onPress={(e: MouseEvent) => {
              e.preventDefault()
              e.stopPropagation()
              onRemoveThumbnail()
            }}
          />
        </Tooltip>
      ) : null}
    </XStack>
  )
}

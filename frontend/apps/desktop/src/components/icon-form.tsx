import {fileUpload} from '@/utils/file-upload'
import {Button, SizableText, Stack, Tooltip, UIAvatar, XStack} from '@shm/ui'
import {X} from '@tamagui/lucide-icons'
import {ChangeEvent} from 'react'
import appError from '../errors'

export function IconForm({
  url,
  label,
  id,
  size = 140,
  onIconUpload,
  onRemoveIcon,
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
  onIconUpload?: (avatar: string) => Awaited<void>
  onRemoveIcon?: () => void
}) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation()
    const fileList = event.target.files
    const file = fileList?.[0]
    if (!file) return
    if (!onIconUpload) return
    fileUpload(file)
      .then((data) => {
        onIconUpload(data)
      })
      .catch((error) => {
        appError(`Failed to upload icon: ${error.message}`, {error})
      })
      .finally(() => {
        event.target.value = ''
      })
  }

  const iconImage = (
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
  if (!onIconUpload) return iconImage
  return (
    <XStack gap="$2" ai="flex-end" group="icon" w="auto" alignSelf="flex-start">
      <Stack
        marginTop={marginTop}
        position="relative"
        {...props}
        group="icon"
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
            $group-icon-hover={{opacity: 0}}
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
          $group-icon-hover={{opacity: 1}}
          h="100%"
          opacity={0}
          ai="center"
          jc="center"
          pointerEvents="none"
        >
          <SizableText textAlign="center" size="$1" color="white">
            {url ? 'UPDATE' : emptyLabel || 'ADD ICON'}
          </SizableText>
        </XStack>
        {iconImage}
      </Stack>
      {onRemoveIcon ? (
        <Tooltip content="Remove Icon">
          <Button
            opacity={0}
            theme="red"
            $group-icon-hover={{opacity: 1, pointerEvents: 'all'}}
            icon={X}
            size="$1"
            fontWeight="600"
            zi="$zIndex.5"
            onPress={(e: MouseEvent) => {
              e.preventDefault()
              e.stopPropagation()
              onRemoveIcon()
            }}
          />
        </Tooltip>
      ) : null}
    </XStack>
  )
}

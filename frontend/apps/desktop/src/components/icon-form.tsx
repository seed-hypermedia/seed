import {fileUpload} from '@/utils/file-upload'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/legacy/button'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {X} from '@tamagui/lucide-icons'
import {ChangeEvent} from 'react'
import {GestureResponderEvent} from 'react-native'
import {Stack, XStack} from 'tamagui'
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
        className="IconFormmmmm"
        {...props}
        marginTop={marginTop}
        position="relative"
        group="icon"
        w={size}
        h={size}
        borderRadius={borderRadius}
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
            <SizableText size="xs" className="text-center text-white">
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
          <SizableText size="xs" className="text-center text-white">
            {url ? 'UPDATE' : emptyLabel || 'ADD ICON'}
          </SizableText>
        </XStack>
        {iconImage}
      </Stack>
      {onRemoveIcon && url ? (
        <Tooltip content="Remove Icon">
          <Button
            opacity={0}
            theme="red"
            $group-icon-hover={{opacity: 1, pointerEvents: 'all'}}
            icon={X}
            size="$1"
            fontWeight="600"
            zi="$zIndex.5"
            onPress={(e: GestureResponderEvent) => {
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

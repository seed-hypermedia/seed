import {fileUpload} from '@/utils/file-upload'
import {Button, Image, SizableText, Stack, Tooltip, View, XStack} from '@shm/ui'
import {X} from '@tamagui/lucide-icons'
import {ChangeEvent} from 'react'
import {GestureResponderEvent} from 'react-native'
import appError from '../errors'

export function ImageForm({
  url,
  label,
  id,
  onImageUpload,
  onRemove,
  emptyLabel,
  ...props
}: {
  label?: string
  emptyLabel?: string
  id?: string
  url?: string
  onImageUpload?: (avatar: string) => Awaited<void>
  onRemove?: () => void
}) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation()
    const fileList = event.target.files
    const file = fileList?.[0]
    if (!file) return
    if (!onImageUpload) return
    fileUpload(file)
      .then((data) => {
        onImageUpload(data)
      })
      .catch((error) => {
        appError(`Failed to upload icon: ${error.message}`, {error})
      })
      .finally(() => {
        event.target.value = ''
      })
  }

  const image = (
    <View backgroundColor="$color7" borderRadius="$4" flex={1}>
      <Image source={{uri: url}} />
    </View>
  )
  if (!onImageUpload) return image
  return (
    <XStack gap="$2" ai="flex-end" group="icon" w="auto" alignSelf="stretch">
      <Stack
        position="relative"
        {...props}
        group="icon"
        overflow="hidden"
        minHeight={60}
        alignSelf="stretch"
        flex={1}
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
          borderRadius="$4"
        >
          <SizableText textAlign="center" size="$1" color="white">
            {url ? 'UPDATE' : emptyLabel || 'ADD IMAGE'}
          </SizableText>
        </XStack>
        {image}
      </Stack>
      {onRemove && url ? (
        <Tooltip content="Remove Image">
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
              onRemove()
            }}
          />
        </Tooltip>
      ) : null}
    </XStack>
  )
}

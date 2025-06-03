import {fileUpload} from '@/utils/file-upload'
import {Button} from '@shm/ui/components/button'
import {X} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {ChangeEvent} from 'react'
import {GestureResponderEvent} from 'react-native'
import {SizableText, Stack, View, XStack} from 'tamagui'
import appError from '../errors'

export function ImageForm({
  url,
  label,
  id,
  onImageUpload,
  onRemove,
  emptyLabel,
  uploadOnChange = true,
  height,
  ...props
}: {
  label?: string
  emptyLabel?: string
  id?: string
  url?: string
  uploadOnChange?: boolean
  height?: number
  onImageUpload?: (avatar: string | File) => Awaited<void>
  onRemove?: () => void
}) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation()
    const fileList = event.target.files
    const file = fileList?.[0]
    if (!file) return
    if (!onImageUpload) return

    if (uploadOnChange) {
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
    } else {
      // Just call onImageUpload with the file directly to handle it at the parent level
      onImageUpload(file)
    }
  }

  const image = (
    <View
      backgroundColor="$color7"
      borderRadius="$4"
      flex={1}
      overflow="hidden"
    >
      <img
        src={url}
        key={url}
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
          top: 0,
          left: 0,
          objectFit: 'cover',
        }}
      />
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
        minHeight={height || 60}
        alignSelf="stretch"
        flex={1}
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
            bg="rgba(233,233,233,0.3)"
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
            <SizableText textAlign="center" size="$1">
              {emptyLabel}
            </SizableText>
          </XStack>
        ) : null}
        <XStack
          bg="rgba(198, 198, 198, 0.3)"
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
          <SizableText textAlign="center" size="$1">
            {url ? 'UPDATE' : emptyLabel || 'ADD IMAGE'}
          </SizableText>
        </XStack>
        {image}
      </Stack>
      {onRemove && url ? (
        <Tooltip content="Remove Image">
          <Button
            position="absolute"
            right={0}
            top={0}
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

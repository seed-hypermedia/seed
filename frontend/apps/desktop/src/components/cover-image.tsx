import {fileUpload} from '@/utils/file-upload'
import {Tooltip} from '@shm/ui/tooltip'
import {Trash} from '@tamagui/lucide-icons'
import {ChangeEvent} from 'react'
import {Button, Stack, XStack, YStack} from 'tamagui'
import appError from '../errors'

export function CoverImage({
  url,
  label,
  showOutline = true,
  show = true,
  onCoverUpload,
  onRemoveCover,
}: {
  label?: string
  url?: string
  showOutline?: boolean
  show: boolean
  onCoverUpload?: (avatar: string) => void
  onRemoveCover?: () => void
}) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files
    const file = fileList?.[0]
    if (!file || !onCoverUpload) return
    fileUpload(file)
      .then((data) => {
        onCoverUpload(data)
      })
      .catch((error) => {
        appError(`Failed to upload avatar: ${e.message}`, {error})
      })
      .finally(() => {
        event.target.value = ''
      })
  }

  const coverImage = (
    <XStack
      bg={url ? '$backgroundTransparent' : 'brand11'}
      height={show ? '25vh' : 0}
      opacity={show ? 1 : 0}
      width="100%"
      position="relative"
      animation="fast"
    >
      {url ? (
        <img
          src={url}
          title={label}
          style={{
            width: '100%',
            height: '100%',
            position: 'absolute',
            top: 0,
            left: 0,
            objectFit: 'cover',
          }}
        />
      ) : null}
    </XStack>
  )
  if (!onCoverUpload) return coverImage
  return (
    <Stack group="cover">
      {show ? (
        <YStack
          position="absolute"
          top={0}
          left={0}
          right={0}
          w="100%"
          zi="$zIndex.1"
        >
          {showOutline ? <YStack /> : null}
          <YStack paddingHorizontal="$2">
            <XStack
              opacity={0}
              jc="flex-end"
              paddingHorizontal="$4"
              paddingTop="$6"
              $group-cover-hover={{opacity: 1}}
              gap="$2"
            >
              <XStack position="relative">
                <XStack
                  tag="input"
                  type="file"
                  onChange={handleFileChange}
                  style={{
                    height: '100%',
                    opacity: 0,
                    display: 'flex',
                    position: 'absolute',
                    left: 0,
                    right: -12,
                    top: 0,
                    zIndex: 100,
                    background: 'red',
                  }}
                />
                <Button size="$2">{`${url ? 'CHANGE' : 'ADD'} COVER`}</Button>
              </XStack>
              <Tooltip content="Remove Cover image">
                <Button
                  icon={Trash}
                  size="$2"
                  onPress={onRemoveCover}
                  theme="red"
                />
              </Tooltip>
            </XStack>
          </YStack>
        </YStack>
      ) : null}
      {coverImage}
    </Stack>
  )
}

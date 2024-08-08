import {fileUpload} from '@/utils/file-upload'
import {Button, Container, Stack, Tooltip, XStack} from '@shm/ui'
import {X} from '@tamagui/lucide-icons'
import {ChangeEvent} from 'react'
import appError from '../errors'

export function CoverImage({
  url,
  label,
  id,
  onCoverUpload,
  onRemoveCover,
}: {
  label?: string
  id?: string
  url?: string
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
    <XStack bg="black" height="25vh" width="100%" position="relative">
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
      <Container p={0}>
        <XStack
          opacity={0}
          jc="end"
          paddingHorizontal={54}
          paddingVertical={20}
          position="absolute"
          top={0}
          left={0}
          right={0}
          w="100%"
          zi={10}
          $group-cover-hover={{opacity: 1}}
          gap="$2"
        >
          <XStack position="relative" bg="red" hoverStyle={{cursor: 'pointer'}}>
            <XStack
              tag="input"
              hoverStyle={{cursor: 'pointer'}}
              type="file"
              onChange={handleFileChange}
              style={{
                height: '100%',
                opacity: 0,
                display: 'flex',
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                zIndex: 12,
                cursor: 'pointer',
                background: 'red',
              }}
            />
            <Button size="$1" fontWeight="600" elevate elevation="$7">
              {`${url ? 'CHANGE' : 'ADD'} COVER`}
            </Button>
          </XStack>
          <Tooltip content="Remove Cover image">
            <Button
              bg="$red9"
              color="$color1"
              borderColor="$red9"
              hoverStyle={{
                bg: '$red10',
                color: '$color1',
                borderColor: '$red10',
              }}
              icon={X}
              size="$1"
              fontWeight="600"
              onPress={onRemoveCover}
            />
          </Tooltip>
        </XStack>
      </Container>
      {coverImage}
    </Stack>
  )
}

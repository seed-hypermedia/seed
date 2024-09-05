import {fileUpload} from '@/utils/file-upload'
import {
  Button,
  Container,
  getRandomColor,
  Stack,
  Tooltip,
  XStack,
} from '@shm/ui'
import {Trash} from '@tamagui/lucide-icons'
import {ChangeEvent, useMemo} from 'react'
import appError from '../errors'

export function CoverImage({
  url,
  label,
  id,
  show = true,
  onCoverUpload,
  onRemoveCover,
}: {
  label?: string
  id?: string
  url?: string
  show: boolean
  onCoverUpload?: (avatar: string) => void
  onRemoveCover?: () => void
}) {
  const coverBg = useMemo(() => {
    if (id) {
      return getRandomColor(id)
    }
  }, [id])

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
      bg={coverBg}
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
        <Container clearVerticalSpace>
          <XStack
            opacity={0}
            jc="end"
            paddingHorizontal="$4"
            paddingTop="$6"
            position="absolute"
            top={0}
            left={0}
            right={0}
            w="100%"
            zi={10}
            $group-cover-hover={{opacity: 1}}
            gap="$2"
          >
            <XStack position="relative" hoverStyle={{cursor: 'pointer'}}>
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
                  right: -12,
                  top: 0,
                  zIndex: 12,
                  cursor: 'pointer',
                  background: 'red',
                }}
              />
              <Button size="$2">{`${url ? 'CHANGE' : 'ADD'} COVER`}</Button>
            </XStack>
            <Tooltip content="Remove Cover image">
              <Button icon={Trash} size="$2" onPress={onRemoveCover} />
            </Tooltip>
          </XStack>
        </Container>
      ) : null}
      {coverImage}
    </Stack>
  )
}

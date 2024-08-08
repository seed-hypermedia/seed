import {fileUpload} from '@/utils/file-upload'
import {Stack, Tooltip, XStack} from '@shm/ui'
import {ChangeEvent} from 'react'
import appError from '../errors'

export function CoverImage({
  url,
  label,
  id,
  onCoverUpload,
}: {
  label?: string
  id?: string
  url?: string
  onCoverUpload?: (avatar: string) => Awaited<void>
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
    </XStack>
  )
  if (!onCoverUpload) return coverImage
  return (
    <Tooltip content="Click or Drag to Set Cover Image">
      <Stack hoverStyle={{opacity: 0.7}}>
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
        {coverImage}
      </Stack>
    </Tooltip>
  )
}

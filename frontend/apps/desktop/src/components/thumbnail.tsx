import {getFileUrl} from '@/utils/account-url'
import {useNavigate} from '@/utils/useNavigate'
import {getDocumentTitle, HMDocument, UnpackedHypermediaId} from '@shm/shared'
import {AlertCircle, Tooltip, UIAvatar} from '@shm/ui'
import {Button, FontSizeTokens, YStack} from 'tamagui'

export function Thumbnail({
  id,
  document,
  size,
}: {
  id: UnpackedHypermediaId
  document?: HMDocument | null
  size?: FontSizeTokens | number
}) {
  return (
    <UIAvatar
      size={size || 40}
      id={id.path?.at(-1) || id.uid.slice(2)}
      label={document?.metadata.name}
      url={getFileUrl(document?.metadata.thumbnail)}
    />
  )
}

export function LinkThumbnail({
  id,
  document,
  size,
  error,
}: {
  id: UnpackedHypermediaId
  document?: HMDocument | null
  size?: FontSizeTokens | number
  error?: boolean
}) {
  const navigate = useNavigate()
  let content = (
    <>
      <Thumbnail id={id} size={size} document={document} />
      {error ? <ErrorDot /> : null}
    </>
  )

  return (
    <Tooltip content={getDocumentTitle(document)}>
      <Button
        id="avatar"
        className="no-window-drag"
        size="$1"
        backgroundColor="transparent"
        hoverStyle={{backgroundColor: 'transparent'}}
        minWidth={20}
        minHeight={20}
        padding={0}
        onPress={(e) => {
          e.preventDefault()
          e.stopPropagation()
          navigate({key: 'document', id})
        }}
        position="relative"
        height={size}
      >
        {content}
      </Button>
    </Tooltip>
  )
}

export function ErrorDot() {
  return (
    <YStack
      backgroundColor={'#ff3333'}
      display="flex"
      position="absolute"
      top={-8}
      left={-8}
      padding={0}
      paddingLeft={-4}
      width={16}
      height={16}
      borderRadius={8}
    >
      <AlertCircle size={16} />
    </YStack>
  )
}

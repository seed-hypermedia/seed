import {
  formattedDate,
  HMAccountsMetadata,
  HMDocument,
  HMDocumentInfo,
  HMEntityContent,
  hmId,
  OptimizedImageSize,
  plainTextOfContent,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useImageUrl} from '@shm/ui/get-file-url'
import {View} from '@tamagui/core'
import {XStack, YStack, YStackProps} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import {useMemo} from 'react'
import {FacePile} from './face-pile'

export function BannerNewspaperCard({
  item,
  entity,
  accountsMetadata,
}: {
  item: HMDocumentInfo
  entity: HMEntityContent | null | undefined
  accountsMetadata: HMAccountsMetadata
}) {
  const id = hmId('d', item.account, {path: item.path})
  // const navigate = useNavigate()
  const linkProps = useRouteLink({key: 'document', id})

  if (!entity?.document) return null
  return (
    <View
      {...baseCardStyles}
      flexDirection="column"
      marginTop="$4"
      minHeight={200}
      $gtMd={{flexDirection: 'row', maxHeight: 300}}
      {...linkProps}
    >
      {entity.document.metadata.cover ? (
        <View height={200} width="100%" $gtMd={{width: '50%', height: 'auto'}}>
          <NewspaperCardImage document={entity.document} height="100%" />
        </View>
      ) : null}
      <YStack
        flex={1}
        width="100%"
        $gtMd={{width: '50%', height: 'auto'}}
        jc="space-between"
      >
        <NewspaperCardContent banner entity={entity} />
        <NewspaperCardFooter
          entity={entity}
          accountsMetadata={accountsMetadata}
        />
      </YStack>
    </View>
  )
}

function NewspaperCardImage({
  document,
  height = 120,
  imageOptimizedSize = 'L',
}: {
  document: HMDocument
  height?: number | string
  imageOptimizedSize?: OptimizedImageSize
}) {
  const coverImage = document.metadata.cover
  const imageUrl = useImageUrl()
  return (
    <View
      height={height}
      // minHeight={120}
      // maxHeight={200}
      backgroundColor="$brand11"
    >
      {coverImage ? (
        <img
          src={imageUrl(coverImage, imageOptimizedSize)}
          style={{minWidth: '100%', minHeight: '100%', objectFit: 'cover'}}
        />
      ) : null}
    </View>
  )
}

function NewspaperCardContent({
  entity,
  banner = false,
}: {
  entity: HMEntityContent | null | undefined
  banner?: boolean
}) {
  let textContent = useMemo(() => {
    return plainTextOfContent(entity?.document?.content)
  }, [entity?.document])
  return (
    <YStack padding={banner ? '$5' : '$3'} gap="$3" f={1}>
      <YStack overflow="hidden" maxHeight={(banner ? 30 : 23) * 3}>
        <SizableText size={banner ? '$8' : '$5'} fontWeight="bold">
          {entity?.document?.metadata?.name}
        </SizableText>
      </YStack>
      <YStack overflow="hidden" maxHeight={(banner ? 27 : 21) * 3}>
        <SizableText
          color="$color10"
          fontFamily="$editorBody"
          size={banner ? '$4' : '$2'}
        >
          {textContent}
        </SizableText>
      </YStack>
    </YStack>
  )
}

function NewspaperCardFooter({
  entity,
  accountsMetadata,
}: {
  entity: HMEntityContent | null | undefined
  accountsMetadata: HMAccountsMetadata
}) {
  return (
    <XStack
      jc="space-between"
      alignSelf="stretch"
      backgroundColor="$background"
      paddingHorizontal="$4"
      paddingVertical="$2"
      alignItems="center"
    >
      {entity?.document?.updateTime && (
        <SizableText size="$1">
          {formattedDate(entity?.document?.updateTime)}
        </SizableText>
      )}
      <XStack>
        <FacePile
          accounts={entity?.document?.authors || []}
          accountsMetadata={accountsMetadata}
        />
      </XStack>
    </XStack>
  )
}
const baseCardStyles: Parameters<typeof XStack>[0] = {
  borderRadius: '$4',
  backgroundColor: '$backgroundStrong',
  shadowColor: '$shadowColor',
  shadowOffset: {width: 0, height: 2},
  shadowRadius: 8,
  overflow: 'hidden',
  hoverStyle: {
    backgroundColor: '$blue2',
  },
}
export function NewspaperCard({
  id,
  entity,
  accountsMetadata,
  isWeb = false,
  ...props
}: Omit<YStackProps, 'id'> & {
  id: UnpackedHypermediaId
  entity: HMEntityContent | null | undefined
  accountsMetadata: HMAccountsMetadata
  isWeb?: boolean
}) {
  const linkProps = useRouteLink(id ? {key: 'document', id} : null)

  // const navigate = useNavigate()
  if (!entity?.document) return null
  const cardProps = !isWeb
    ? {
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: '100%',
        $gtSm: {flexBasis: '47.9%'},
        $gtMd: {flexBasis: '31.1%'},
      }
    : {}
  return (
    <YStack
      {...cardProps}
      {...baseCardStyles}
      // marginTop="$5"
      //   marginTop="$4"

      //   maxWidth={208}
      //   f={1}
      //   onPress={() => {
      //     //   navigate({key: 'document', id})
      //   }}
      {...linkProps}
      {...props}
    >
      <NewspaperCardImage document={entity.document} imageOptimizedSize="L" />
      <NewspaperCardContent entity={entity} />

      {!isWeb && (
        <NewspaperCardFooter
          entity={entity}
          accountsMetadata={accountsMetadata}
        />
      )}
    </YStack>
  )
}

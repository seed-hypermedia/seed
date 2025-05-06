import {
  formattedDateDayOnly,
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
import {useIsDark} from './use-is-dark'

export function BannerNewspaperCard({
  item,
  entity,
  accountsMetadata,
  onHoverIn,
  onHoverOut,
}: {
  item: HMDocumentInfo
  entity: HMEntityContent | null | undefined
  accountsMetadata: HMAccountsMetadata
  onHoverIn?: (id: UnpackedHypermediaId) => void
  onHoverOut?: (id: UnpackedHypermediaId) => void
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
      onHoverIn={onHoverIn ? () => onHoverIn?.(id) : undefined}
      onHoverOut={onHoverOut ? () => onHoverOut?.(id) : undefined}
      $gtMd={{flexDirection: 'row', maxHeight: 300}}
      {...linkProps}
      // this data attribute is used by the hypermedia highlight component
      data-docid={id.id}
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

export function NewspaperCard({
  docId,
  entity,
  accountsMetadata,
  isWeb = false,
  navigate = true,
  onHoverIn,
  onHoverOut,
  ...props
}: Omit<YStackProps, 'id'> & {
  docId: UnpackedHypermediaId
  entity: HMEntityContent | null | undefined
  accountsMetadata: HMAccountsMetadata
  isWeb?: boolean
  navigate?: boolean
  onHoverIn?: any
  onHoverOut?: any
}) {
  const linkProps = useRouteLink(docId ? {key: 'document', id: docId} : null)

  // const navigate = useNavigate()
  if (!entity?.document) return null
  const cardProps = !isWeb
    ? {
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: '100%' as any,
        $gtSm: {flexBasis: '47.9%' as any},
        $gtMd: {flexBasis: '31.1%' as any},
      }
    : {}
  return (
    <YStack
      {...cardProps}
      {...baseCardStyles}
      onMouseEnter={docId ? () => onHoverIn?.(docId) : undefined}
      onMouseLeave={docId ? () => onHoverOut?.(docId) : undefined}
      // marginTop="$5"
      //   marginTop="$4"

      //   maxWidth={208}
      //   f={1}
      //   onPress={() => {
      //     //   navigate({key: 'document', id})
      //   }}
      // this data attribute is used by the hypermedia highlight component
      data-docid={docId.id}
      {...(navigate ? linkProps : {})}
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
    <YStack
      padding={banner ? '$5' : '$3'}
      gap="$3"
      f={1}
      data-docid={entity?.id.id}
    >
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
  const isDark = useIsDark()
  return (
    <XStack
      jc="space-between"
      alignSelf="stretch"
      backgroundColor={isDark ? '$background' : '$backgroundStrong'}
      data-docid={entity?.id.id}
      paddingHorizontal="$4"
      paddingVertical="$2"
      alignItems="center"
    >
      {(entity?.document?.metadata?.displayPublishTime ||
        entity?.document?.updateTime) && (
        <SizableText
          size="$1"
          // color={
          //   entity?.document?.metadata?.displayPublishTime
          //     ? '$blue10'
          //     : undefined
          // }
        >
          {entity?.document?.metadata?.displayPublishTime
            ? formattedDateDayOnly(
                new Date(entity.document.metadata.displayPublishTime),
              )
            : formattedDateDayOnly(entity.document.updateTime)}
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
    backgroundColor: '$brand12',
  },
  transition: 'background-color 0.3s ease-in-out',
}

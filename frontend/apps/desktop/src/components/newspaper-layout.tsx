import {HMDocumentListItem, useListDirectory} from '@/models/documents'
import {useEntities} from '@/models/entities'
import {useNavigate} from '@/utils/useNavigate'
import {PlainMessage, Timestamp} from '@bufbuild/protobuf'
import {
  formattedDate,
  HMEntityContent,
  hmId,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared'
import {Container, Heading} from '@shm/ui'
import {AccountsMetadata, FacePile} from '@shm/ui/src/face-pile'
import {useMemo} from 'react'
import {SizableText, View, XStack, YStack} from 'tamagui'

export function NewspaperLayout({
  id,
  metadata,
}: {
  id: UnpackedHypermediaId
  metadata: HMMetadata
}) {
  const dir = useListDirectory(id)
  const docIds =
    dir.data?.map((entity) =>
      hmId('d', entity.account, {
        path: entity.path,
      }),
    ) || []
  const authorIds = (
    dir.data?.flatMap((entity) => entity.authors || []) || []
  ).map((authorId) => {
    return hmId('d', authorId)
  })
  const documents = useEntities([...docIds, ...authorIds])
  function getEntity(path: string[]) {
    return documents?.find(
      (document) => document.data?.id?.path?.join('/') === path?.join('/'),
    )?.data
  }
  const latest = dir.data ? [...dir.data].sort(lastUpdateSort) : []
  const firstItem = latest[0]
  const restItems = latest.slice(1)
  const accountsMetadata: AccountsMetadata = documents
    .map((document) => {
      const d = document.data?.document
      if (!d) return null
      if (d?.path?.length !== 0) return null
      return {
        uid: d.account || '',
        metadata: d.metadata,
      }
    })
    .filter((m) => !!m)
  return (
    <Container clearVerticalSpace marginBottom={100}>
      {firstItem && (
        <BannerNewspaperCard
          item={firstItem}
          entity={getEntity(firstItem.path)}
          accountsMetadata={accountsMetadata}
        />
      )}
      <XStack flexWrap="wrap" gap="$4" marginTop="$4" jc="center">
        {restItems.map((item) => {
          return (
            <NewspaperCard
              item={item}
              entity={getEntity(item.path)}
              key={item.path.join('/')}
              accountsMetadata={accountsMetadata}
            />
          )
        })}
      </XStack>
    </Container>
  )
}

function lastUpdateSort(
  a: {updateTime?: PlainMessage<Timestamp>},
  b: {updateTime?: PlainMessage<Timestamp>},
) {
  return lastUpdateOfEntry(b) - lastUpdateOfEntry(a)
}

function lastUpdateOfEntry(entry: {updateTime?: PlainMessage<Timestamp>}) {
  return entry.updateTime?.seconds ? Number(entry.updateTime?.seconds) : 0
}

function BannerNewspaperCard({
  item,
  entity,
  accountsMetadata,
}: {
  item: HMDocumentListItem
  entity: HMEntityContent | null | undefined
  accountsMetadata: AccountsMetadata
}) {
  const id = hmId('d', item.account, {path: item.path})
  const navigate = useNavigate()
  if (!entity?.document) return null
  return (
    <XStack
      {...baseCardStyles}
      marginTop="$4"
      onPress={() => {
        navigate({key: 'document', id})
      }}
    >
      <View width="50%">
        <NewspaperCardImage />
      </View>
      <YStack flex={1} width="50%" jc="space-between">
        <NewspaperCardContent entity={entity} />
        <NewspaperCardFooter
          entity={entity}
          item={item}
          accountsMetadata={accountsMetadata}
        />
      </YStack>
    </XStack>
  )
}
function NewspaperCardImage() {
  return <View f={1} minHeight={120} backgroundColor="$blue6" />
}

function NewspaperCardContent({
  entity,
}: {
  entity: HMEntityContent | null | undefined
}) {
  let textContent = useMemo(() => {
    if (entity?.document?.content) {
      let content = ''
      entity?.document?.content.forEach((bn) => {
        content += bn.block?.text + ' '
      })
      return content
    }
  }, [entity?.document])
  return (
    <YStack paddingHorizontal="$4" paddingVertical="$2">
      <Heading>{entity?.document?.metadata?.name}</Heading>
      <YStack overflow="hidden" maxHeight={20 * 3}>
        <SizableText>{textContent}</SizableText>
      </YStack>
    </YStack>
  )
}

function NewspaperCardFooter({
  item,
  entity,
  accountsMetadata,
}: {
  item: HMDocumentListItem
  entity: HMEntityContent | null | undefined
  accountsMetadata: AccountsMetadata
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
function NewspaperCard({
  item,
  entity,
  accountsMetadata,
}: {
  item: HMDocumentListItem
  entity: HMEntityContent | null | undefined
  accountsMetadata: AccountsMetadata
}) {
  const id = hmId('d', item.account, {path: item.path})
  const navigate = useNavigate()
  if (!entity?.document) return null
  return (
    <YStack
      {...baseCardStyles}
      //   marginTop="$4"
      //   marginTop="$4"
      width={208}
      //   maxWidth={208}
      //   f={1}
      onPress={() => {
        navigate({key: 'document', id})
      }}
    >
      <NewspaperCardImage />
      <NewspaperCardContent entity={entity} />

      <NewspaperCardFooter
        entity={entity}
        item={item}
        accountsMetadata={accountsMetadata}
      />
    </YStack>
  )
}

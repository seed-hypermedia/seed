import {useListDirectory} from '@/models/documents'
import {useEntities} from '@/models/entities'
import {PlainMessage, Timestamp} from '@bufbuild/protobuf'
import {hmId, HMMetadata, UnpackedHypermediaId} from '@shm/shared'
import {BannerNewspaperCard, Container, NewspaperCard} from '@shm/ui'
import {AccountsMetadata} from '@shm/ui/src/face-pile'
import {XStack} from 'tamagui'

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
  const authorUids = new Set<string>()

  dir.data?.forEach((entity) =>
    entity.authors.forEach((authorUid) => authorUids.add(authorUid)),
  )
  const documents = useEntities([
    ...docIds,
    ...Array.from(authorUids).map((uid) => hmId('d', uid)),
  ])
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
      const d = document.data
      if (!d || !d.document) return null
      if (d.id.path && d.id.path.length !== 0) return null
      return {
        id: d.id,
        metadata: d.document.metadata,
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

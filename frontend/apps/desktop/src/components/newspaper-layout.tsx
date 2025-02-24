import {useListSite} from '@/models/documents'
import {useEntities, useSubscribedEntity} from '@/models/entities'
import {sortNewsEntries} from '@shm/shared/content'
import {
  HMAccountsMetadata,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Container} from '@shm/ui/container'
import {BannerNewspaperCard, NewspaperCard} from '@shm/ui/newspaper'
import {XStack} from 'tamagui'

export function NewspaperLayout({
  id,
  metadata,
}: {
  id: UnpackedHypermediaId
  metadata: HMMetadata
}) {
  const dir = useListSite(id)
  useSubscribedEntity(id, true)

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
  const sortedItems = sortNewsEntries(
    dir.data,
    metadata.seedExperimentalHomeOrder,
  )
  const firstItem = sortedItems[0]
  const restItems = sortedItems.slice(1)
  const accountsMetadata: HMAccountsMetadata = documents
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
    <Container
      clearVerticalSpace
      marginTop={60}
      marginBottom={80}
      maxWidth={1080}
    >
      {firstItem && (
        <BannerNewspaperCard
          item={firstItem}
          entity={getEntity(firstItem.path)}
          accountsMetadata={accountsMetadata}
        />
      )}
      <XStack flexWrap="wrap" marginTop="$4" justifyContent="center" gap="$6">
        {restItems.map((item) => {
          const id = hmId('d', item.account, {
            path: item.path,
          })
          return (
            <NewspaperCard
              id={id}
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

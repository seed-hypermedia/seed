import {AccessoryContainer} from '@/components/accessory-sidebar'
import {useDocHistory} from '@/models/changes'
import {useRouteLink} from '@shm/shared'
import {hmId, UnpackedHypermediaId} from '@shm/shared/utils/entity-id-url'
import {Theme, YStack} from '@shm/ui'
import {useEntities} from './models/entities'

export function EntityVersionsAccessory({
  id,
  activeVersion,
  variantVersion,
}: {
  id?: UnpackedHypermediaId | null
  activeVersion: string | undefined
  variantVersion: string | undefined
}) {
  const changes = useDocHistory(id?.id, variantVersion)
  const authors = new Set<string>()
  const routingContext = useRouteLink({
    key: 'document',
  })
  changes.forEach((item) => {
    item?.change?.author && authors.add(item?.change?.author)
  })
  const authorAccounts = useEntities(
    Array.from(authors).map((author) => hmId('d', author)),
  )
  if (!id) return null
  return (
    <>
      <Theme name="subtle">
        <AccessoryContainer title="Variant History">
          <YStack
            paddingHorizontal="$4"
            paddingVertical="$2"
            paddingBottom="$6"
            borderBottomColor="$borderColor"
            borderBottomWidth={1}
          >
            {changes.map((item, index) => {
              const change = item?.change
              const authorQ = change?.author
                ? authorAccounts.find((d) => d.data?.id?.uid === change?.author)
                : null
              const author = authorQ?.data
                ? {
                    id: authorQ.data.id,
                    metadata: authorQ.data.document?.metadata,
                  }
                : null
              if (!change || !author) return null
              return null
              // <ChangeItem
              //   prevListedChange={changes[index - 1]}
              //   entityId={id.id}
              //   key={change.id}
              //   change={change}
              //   activeVersion={activeVersion}
              //   author={author}
              // />
            })}
          </YStack>
        </AccessoryContainer>
      </Theme>
    </>
  )
}

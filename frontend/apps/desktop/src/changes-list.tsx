import {useDocHistory} from '@/models/changes'
import {UnpackedHypermediaId} from '@shm/shared'
import {useEntities} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Theme, YStack} from 'tamagui'
import {AccessoryContent} from './components/accessory-sidebar'

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
        <AccessoryContent>
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
        </AccessoryContent>
      </Theme>
    </>
  )
}

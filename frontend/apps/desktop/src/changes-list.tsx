import {useDocHistory} from '@/models/changes'
import {UnpackedHypermediaId} from '@shm/shared'
import {useResources} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {AccessoryContent} from '@shm/ui/accessories'

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
  const authorAccounts = useResources(
    Array.from(authors).map((author) => hmId(author)),
  )
  if (!id) return null
  return (
    <>
      <AccessoryContent>
        <div className="border-b-border flex flex-col border-b px-4 py-2 pb-6">
          {changes.map((item, index) => {
            const change = item?.change
            const authorQ = change?.author
              ? authorAccounts.find((d) => d.data?.id?.uid === change?.author)
              : null
            const author = authorQ?.data
              ? {
                  id: authorQ.data.id,
                  // @ts-expect-error
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
        </div>
      </AccessoryContent>
    </>
  )
}

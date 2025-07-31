import {useDeletedContent, useUndeleteEntity} from '@/models/entities'
import {HMDeletedEntity} from '@shm/shared/hm-types'
import {formattedDateLong, formattedDateMedium} from '@shm/shared/utils/date'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {ShieldX} from '@shm/ui/icons'
import {List} from '@shm/ui/list'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'

export default function DeletedContent() {
  const deleted = useDeletedContent()
  return (
    <List
      items={deleted.data || []}
      header={<div className="h-5" />}
      footer={<div className="h-5" />}
      renderItem={({item}) => {
        return (
          <div className="flex w-full max-w-[600px] items-center gap-2 px-4 py-1.5">
            <Tooltip content={`Reason: ${item.deletedReason}`}>
              <SizableText weight="bold" color="destructive">
                {item.metadata}
              </SizableText>
            </Tooltip>
            <div className="flex-1" />
            <Tooltip
              content={`You deleted this on ${formattedDateLong(
                item.deleteTime,
              )}`}
            >
              <SizableText color="muted">
                {formattedDateMedium(item.deleteTime)}
              </SizableText>
            </Tooltip>
            <UndeleteButton item={item} />
          </div>
        )
      }}
    />
  )
}

function UndeleteButton({item}: {item: HMDeletedEntity}) {
  const undelete = useUndeleteEntity()
  const unpackedId = item.id ? unpackHmId(item.id) : null
  if (!unpackedId) return null
  return (
    <Tooltip
      content={`Allow this document to be synced to your computer again.`}
    >
      <Button
        size="sm"
        onClick={() => {
          if (!item.id) return
          undelete.mutate({id: item.id})
        }}
      >
        <ShieldX className="size-4" />
      </Button>
    </Tooltip>
  )
}

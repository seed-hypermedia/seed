import {useDeletedContent, useUndeleteEntity} from '@/models/entities'
import {HMDeletedEntity} from '@shm/shared/hm-types'
import {formattedDateLong, formattedDateMedium} from '@shm/shared/utils/date'
import {
  HYPERMEDIA_ENTITY_TYPES,
  unpackHmId,
} from '@shm/shared/utils/entity-id-url'
import {
  Button,
  List,
  ShieldX,
  SizableText,
  Tooltip,
  View,
  XStack,
} from '@shm/ui'

export default function DeletedContent() {
  const deleted = useDeletedContent()
  return (
    <List
      items={deleted.data || []}
      header={<View height={20} />}
      footer={<View height={20} />}
      renderItem={({item}) => {
        return (
          <XStack
            paddingVertical="$1.5"
            w="100%"
            gap="$2"
            ai="center"
            paddingHorizontal="$4"
            maxWidth={600}
            group="item"
          >
            <Tooltip content={`Reason: ${item.deletedReason}`}>
              <SizableText fontWeight={'bold'} color="$red10">
                {item.metadata}
              </SizableText>
            </Tooltip>
            <View f={1} />
            <Tooltip
              content={`You deleted this on ${formattedDateLong(
                item.deleteTime,
              )}`}
            >
              <SizableText color="$color9">
                {formattedDateMedium(item.deleteTime)}
              </SizableText>
            </Tooltip>
            <UndeleteButton item={item} />
          </XStack>
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
      content={`Allow this ${HYPERMEDIA_ENTITY_TYPES[
        unpackedId.type
      ].toLowerCase()} to be synced to your computer again.`}
    >
      <Button
        size="$2"
        onPress={() => {
          if (!item.id) return
          undelete.mutate({id: item.id})
        }}
        icon={ShieldX}
      ></Button>
    </Tooltip>
  )
}

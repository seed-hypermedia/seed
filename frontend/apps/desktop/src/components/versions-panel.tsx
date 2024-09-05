import {useEntity} from '@/models/entities'
import {useDocumentChanges, useVersionChanges} from '@/models/versions'
import {useNavigate} from '@/utils/useNavigate'
import {
  DocumentRoute,
  formattedDateMedium,
  getAccountName,
  HMChangeInfo,
  hmId,
} from '@shm/shared'
import {Button} from '@shm/ui'
import {SizableText, YStack} from 'tamagui'
import {AccessoryContainer} from './accessory-sidebar'

export function VersionsPanel({
  route,
  onClose,
}: {
  route: DocumentRoute
  onClose: () => void
}) {
  const navigate = useNavigate()
  const activeChangeIds = useVersionChanges(route.id)
  const changes = useDocumentChanges(route.id)
  return (
    <AccessoryContainer title="Versions" onClose={onClose}>
      {changes.data?.map((change) => {
        const isActive = activeChangeIds?.has(change.id) || false
        return (
          <ChangeItem
            change={change}
            isActive={isActive}
            onPress={() => {
              navigate({...route, id: {...route.id, version: change.id}})
            }}
          />
        )
      })}
    </AccessoryContainer>
  )
}

function ChangeItem({
  change,
  isActive,
  onPress,
}: {
  change: HMChangeInfo
  onPress: () => void
  isActive: boolean
}) {
  const authorEntity = useEntity(hmId('d', change.author))
  return (
    <Button
      onPress={onPress}
      key={change.id}
      backgroundColor={isActive ? '$blue6' : undefined}
    >
      <YStack>
        <SizableText>{formattedDateMedium(change.createTime)}</SizableText>
        <SizableText>{getAccountName(authorEntity.data?.document)}</SizableText>
      </YStack>
    </Button>
  )
}

import {useDocumentChanges} from '@/models/versions'
import {DocumentRoute} from '@shm/shared'
import {SizableText} from 'tamagui'
import {AccessoryContainer} from './accessory-sidebar'

export function VersionsPanel({
  route,
  onClose,
}: {
  route: DocumentRoute
  onClose: () => void
}) {
  const changes = useDocumentChanges(route.id)
  return (
    <AccessoryContainer title="Versions" onClose={onClose}>
      {changes.data?.map((version) => <SizableText>{version.id}</SizableText>)}
    </AccessoryContainer>
  )
}

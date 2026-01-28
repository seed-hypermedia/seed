import {useNavRoute} from '@shm/shared/utils/navigation'
import {ResourcePage} from '@shm/ui/resource-page-common'

export default function DesktopResourcePage() {
  const route = useNavRoute()

  // Only handle document-related routes
  const supportedKeys = [
    'document',
    'feed',
    'directory',
    'collaborators',
    'activity',
    'discussions',
  ]
  if (!supportedKeys.includes(route.key)) {
    throw new Error(`DesktopResourcePage: unsupported route ${route.key}`)
  }

  // @ts-expect-error - route.id exists on all supported route types
  const docId = route.id
  if (!docId) throw new Error('No document ID in route')

  return <ResourcePage docId={docId} />
}

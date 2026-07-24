import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {OnyxTour} from '@shm/ui/onyx/index'

export default function OnyxPage() {
  const route = useNavRoute()
  const navigate = useNavigate('replace')
  if (route.key !== 'onyx') throw new Error(`OnyxPage: unsupported route ${route.key}`)
  return <OnyxTour slug={route.slug || 'onyx-schema'} onNavigate={(slug) => navigate({key: 'onyx', slug})} />
}

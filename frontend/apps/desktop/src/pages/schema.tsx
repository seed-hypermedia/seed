import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {useOpenUrl} from '@shm/shared'
import {OnyxSchemaBrowserPage} from '@shm/ui/onyx/schema-browser'

/** Full-page schema browser for a schema blob by CID (`/hm/schema/<cid>`). */
export default function SchemaPage() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const openUrl = useOpenUrl()
  if (route.key !== 'schema') throw new Error(`SchemaPage: unsupported route ${route.key}`)
  return <OnyxSchemaBrowserPage cid={route.cid} navigate={navigate} openUrl={openUrl} />
}

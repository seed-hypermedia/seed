import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {useOpenUrl} from '@shm/shared'
import {pageFrameStyles} from '@shm/ui/container'
import {OnyxSchemaBrowserPage} from '@shm/ui/onyx/schema-browser'
import {cn} from '@shm/ui/utils'

/** Full-page schema browser for a schema blob by CID (`/hm/schema/<cid>`). */
export default function SchemaPage() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const openUrl = useOpenUrl()
  if (route.key !== 'schema') throw new Error(`SchemaPage: unsupported route ${route.key}`)
  return (
    <div className={cn(pageFrameStyles, 'overflow-y-auto')}>
      <OnyxSchemaBrowserPage cid={route.cid} navigate={navigate} openUrl={openUrl} />
    </div>
  )
}

import DesktopResourcePage from './desktop-resource'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {useOpenUrl} from '@shm/shared'
import {pageFrameStyles} from '@shm/ui/container'
import {OnyxSchemaBrowserPage} from '@shm/ui/onyx/schema-browser'
import {cn} from '@shm/ui/utils'

/**
 * The schema route, two shapes:
 *   - with a defining document (`id`): a document tool tab — the full document page shell
 *     (header, tabs) with the schema browser as the active view;
 *   - bare CID (`/hm/schema/<cid>`): the standalone browser page, for schemas with no
 *     defining document (bundled library entries, raw ipfs refs).
 */
export default function SchemaPage() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const openUrl = useOpenUrl()
  if (route.key !== 'schema') throw new Error(`SchemaPage: unsupported route ${route.key}`)
  if (route.id) return <DesktopResourcePage />
  return (
    <div className={cn(pageFrameStyles, 'overflow-y-auto')}>
      <OnyxSchemaBrowserPage cid={route.cid} navigate={navigate} openUrl={openUrl} />
    </div>
  )
}

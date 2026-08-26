import {useOpenUrl} from '@shm/shared'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {OnyxSchemaBrowserPage} from '@shm/ui/onyx/schema-browser'

/** Parse a reserved `/hm/schema/<cid>` URL back to a schema route (mirrors routeToHref). */
export function extractSchemaRouteFromPath(pathParts: string[]): {key: 'schema'; cid: string} | null {
  if (pathParts[0] !== 'hm' || pathParts[1] !== 'schema' || !pathParts[2]) return null
  return {key: 'schema', cid: pathParts[2]}
}

/** Full-page schema browser for the web app. */
export function WebSchemaPage() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const openUrl = useOpenUrl()
  if (route.key !== 'schema') throw new Error(`WebSchemaPage: unsupported route ${route.key}`)
  return <OnyxSchemaBrowserPage cid={route.cid} navigate={navigate} openUrl={openUrl} />
}

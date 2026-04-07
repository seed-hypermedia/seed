import {API_HTTP_URL} from '@shm/shared/constants'
import {ApiInspector} from '@shm/ui/api-inspector'
import {InspectorShell} from '@shm/ui/inspector-shell'

/** Renders the desktop-only API inspector route. */
export default function DesktopApiInspectorPage() {
  return (
    <div className="relative h-full max-h-full overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
      <InspectorShell title="API Inspector" contentMaxWidth={1360}>
        <ApiInspector apiHost={API_HTTP_URL} />
      </InspectorShell>
    </div>
  )
}

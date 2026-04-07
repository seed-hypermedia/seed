import {useNavRoute} from '@shm/shared/utils/navigation'
import {InspectorPage} from '@shm/ui/inspector-page'

/** Renders the dedicated document inspector in the desktop app. */
export default function DesktopInspectResourcePage() {
  const route = useNavRoute()

  if (route.key !== 'inspect') {
    throw new Error(`DesktopInspectResourcePage: unsupported route ${route.key}`)
  }

  return (
    <div className="relative h-full max-h-full overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
      <InspectorPage docId={route.id} />
    </div>
  )
}

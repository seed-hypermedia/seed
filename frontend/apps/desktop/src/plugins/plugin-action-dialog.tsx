import type {PluginManifest} from '@shm/ui/plugin-manifest'
import {SizableText} from '@shm/ui/text'
import {RunActionPanel} from './run-action-panel'

/**
 * Dialog wrapper for invoking a plugin action from a document page (via the
 * document options menu). Because the document machine stays mounted under
 * the dialog, the bridge's document capabilities are live: the action reads
 * the open document and stages draft changes the user then reviews.
 */
export function PluginActionDialog({
  input,
  onClose,
}: {
  input: {manifest: PluginManifest; actionName: string}
  onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <SizableText size="lg" weight="bold">
        {input.manifest.title ?? input.manifest.name}
      </SizableText>
      <RunActionPanel manifest={input.manifest} actionName={input.actionName} onClose={onClose} />
    </div>
  )
}

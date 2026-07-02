import {selectContext} from '@shm/shared/models/use-document-machine'
import {useDocumentMachineRefOptional} from '@shm/shared/models/use-document-machine'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {useEffect} from 'react'
import {setDocumentPluginCapabilities} from './document-capabilities'

/**
 * Registers the open document's plugin capabilities while its machine is
 * mounted (rendered via ResourcePage's `machineExtras`). Reads go through the
 * machine snapshot (draft metadata over published); writes stage a metadata
 * patch through the exact staged-draft path the metadata editor uses — the
 * user still reviews and publishes.
 */
export function RegisterDocumentPluginCapabilities() {
  const actorRef = useDocumentMachineRefOptional()
  const {canEdit, beginEditIfNeeded} = useEditorGate()

  useEffect(() => {
    if (!actorRef) return
    setDocumentPluginCapabilities({
      readDocument: async () => {
        const context = selectContext(actorRef.getSnapshot())
        return {
          id: context.documentId.id,
          metadata: {
            ...((context.document?.metadata as Record<string, unknown> | undefined) ?? {}),
            ...((context.metadata as Record<string, unknown> | undefined) ?? {}),
          },
        }
      },
      updateDocumentMetadata: canEdit
        ? async (patch) => {
            beginEditIfNeeded()
            actorRef.send({type: 'change', metadata: patch as never})
          }
        : undefined,
    })
    return () => setDocumentPluginCapabilities(null)
  }, [actorRef, canEdit, beginEditIfNeeded])

  return null
}

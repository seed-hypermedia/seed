import type {CollectedBlob} from '@seed-hypermedia/client/file-to-ipfs'
import type {HMBlockNode, HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'
import {useUniversalClient} from '@shm/shared'
import {getEffectiveDocumentMetadata} from '@shm/shared/models/document-machine'
import {selectContext, useDocumentSelector, useDocumentSend} from '@shm/shared/models/use-document-machine'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {useCallback, useMemo} from 'react'

/**
 * A typed resource's draft (a tool or a trigger, inside an app or an agent), the way any document
 * has one: edits stage into the document's draft, which saves itself; the top bar's Publish button
 * appears once there is something to publish, and Discard Changes drops the draft. `metadata` and
 * `content` are what the draft holds now (the published document overlaid with pending edits).
 * Attributes that point at blobs (a schema, a code folder, a trigger's source) take the blobs'
 * `ipfs://` URL; `storeBlobs` puts those blobs in the node first so the draft can reference them.
 */
export function useResourceDraft(published: HMDocument) {
  const client = useUniversalClient()
  const context = useDocumentSelector(selectContext)
  const send = useDocumentSend()
  const {beginEditIfNeeded, canEdit} = useEditorGate()
  const metadata = useMemo(() => {
    const merged = context ? getEffectiveDocumentMetadata(context) : published.metadata
    // A cleared attribute is drafted as null: read it as absent.
    return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== null)) as HMMetadata
  }, [context, published.metadata])
  const content: HMBlockNode[] = context?.draftContent ?? published.content ?? []

  /** Stages a metadata patch (null clears an attribute) and, for a trigger, a new body. */
  const change = useCallback(
    (patch: Record<string, unknown>, nextContent?: HMBlockNode[]) => {
      beginEditIfNeeded()
      send({type: 'change', metadata: patch as HMMetadata, ...(nextContent ? {content: nextContent} : {})})
    },
    [beginEditIfNeeded, send],
  )

  /** Puts blobs in the node, so a draft attribute can point at them before anything is published. */
  const storeBlobs = useCallback(
    async (blobs: CollectedBlob[]) => {
      if (blobs.length) await client.request('PublishBlobs', {blobs})
    },
    [client],
  )

  return {metadata, content, change, storeBlobs, canEdit}
}

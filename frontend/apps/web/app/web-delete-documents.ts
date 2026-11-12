import {toast} from '@shm/ui/toast'
import {createTombstoneRef, followToDocument, type SeedClient} from '@seed-hypermedia/client'
import type {HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {UniversalClient} from '@shm/shared/universal-client'
import {getParentPaths} from '@shm/shared/utils/breadcrumbs'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {enqueueWebDocumentCardCleanup, releaseWebDocumentCardCleanup} from './document-edit/web-document-card-cleanup'

/** Tombstones the given documents (and queues parent card cleanup) using the signing account's capability. */
export async function deleteWebDocuments(
  client: Pick<UniversalClient, 'request' | 'publish' | 'getSigner' | 'deleteRecent'>,
  input: {ids: UnpackedHypermediaId[]; signingAccountId: string; capabilityId?: string},
): Promise<void> {
  if (!client.getSigner) throw new Error('Signing not available')
  const signer = client.getSigner(input.signingAccountId) as HMSigner

  let pendingJobId: string | undefined
  const selectedDeletedDocument = input.ids[0]
  if (selectedDeletedDocument) {
    const queued = await enqueueWebDocumentCardCleanup(
      {
        deletedDocumentId: selectedDeletedDocument.id,
        awaitingPrimary: {documentId: selectedDeletedDocument.id, expectedType: 'tombstone'},
        signingAccountUid: input.signingAccountId,
        capabilityId: input.capabilityId,
      },
      {client},
    ).catch((error) => {
      console.warn('Documents deleted, but parent maintenance could not be queued', error)
      toast.error('Documents deleted. Parent cards need manual review because maintenance could not be saved.')
    })
    pendingJobId = queued?.jobId
  }

  await Promise.all(
    input.ids.map(async (id) => {
      await client.deleteRecent?.(id.id)
      const resource = await client.request('Resource', id)
      if (resource.type !== 'document' && resource.type !== 'redirect')
        throw new Error(`Cannot delete: resource is ${resource.type}`)
      // A redirected path (including a republished one) has no document of its own to read
      // genesis and generation from: the tombstone borrows the redirect target's genesis and
      // takes a fresh generation, which supersedes the redirect Ref so the path reads as
      // deleted instead of continuing to follow the target.
      let genesis: string
      let generation: number
      if (resource.type === 'redirect') {
        const followed = await followToDocument(client as unknown as SeedClient, id)
        genesis = followed.document.genesis
        generation = Date.now()
      } else {
        const doc = resource.document
        genesis = doc.genesis
        generation = doc.generationInfo ? Number(doc.generationInfo.generation) : 0
      }
      const refInput = await createTombstoneRef(
        {
          space: id.uid,
          path: hmIdPathToEntityQueryPath(id.path),
          genesis,
          generation,
          capability: input.capabilityId,
        },
        signer,
      )
      await client.publish(refInput)
    }),
  )

  if (pendingJobId) await releaseWebDocumentCardCleanup(pendingJobId).catch(console.error)

  invalidateQueries([])
  invalidateQueries([queryKeys.DOC_LIST_DIRECTORY], {refetchType: 'all'})
  new Set(input.ids.map((id) => id.uid)).forEach((uid) => {
    invalidateQueries([queryKeys.DOC_LIST_UNREFERENCED, uid], {refetchType: 'all'})
  })
  input.ids.forEach((id) => {
    invalidateQueries([queryKeys.ENTITY, id.id])
    invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
    invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, id.id])
    getParentPaths(id.path).forEach((path) => {
      const parentId = hmId(id.uid, {path})
      invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id, 'Children'])
      invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id, 'AllDescendants'])
      invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, parentId.id])
    })
  })
}

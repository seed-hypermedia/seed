import {signDocumentChange} from '@seed-hypermedia/client'
import type {HMDocument, HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {ResourceVisibility} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {invalidateAfterPublish} from '@shm/shared/models/post-publish-cache'
import {invalidateQueries, refetchQueriesByKey} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import type {UniversalClient} from '@shm/shared/universal-client'
import {latestId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {buildRestoreVersionChanges, getRestoreVersionGeneration} from '@shm/shared/utils/restore-document-version'
import {deleteWebDocDraft, getLatestWebDocDraftForDoc} from './web-draft-db'

export type RestoreWebDocumentVersionInput = {
  targetId: UnpackedHypermediaId
  selectedVersion: HMDocument
  signerAccountUid: string
  capabilityCid?: string
}

export type RestoreWebDocumentVersionDeps = {
  client: UniversalClient
  getSigner: (accountUid: string) => HMSigner
}

/** Restores a document version on web without going through the draft publish flow. */
export async function restoreWebDocumentVersion(
  input: RestoreWebDocumentVersionInput,
  deps: RestoreWebDocumentVersionDeps,
): Promise<HMDocument> {
  const targetId = latestId(input.targetId)
  const latestResource = await deps.client.request('Resource', targetId)
  const latestDocument = latestResource.type === 'document' ? latestResource.document : null
  if (!latestDocument?.version) throw new Error('Could not load the latest document version')
  if (latestDocument.version === input.selectedVersion.version)
    throw new Error('This version is already the latest version')

  const changes = buildRestoreVersionChanges(latestDocument, input.selectedVersion)
  if (!changes.length) throw new Error('This version matches the latest version')

  const path = hmIdPathToEntityQueryPath(targetId.path || [])
  const visibility = ResourceVisibility.UNSPECIFIED
  const prepareResult = (await deps.client.request(
    'PrepareDocumentChange' as any,
    {
      account: targetId.uid,
      path,
      baseVersion: latestDocument.version,
      changes: changes as any,
      capability: input.capabilityCid ?? '',
      visibility,
    } as any,
  )) as any

  const {changeCid, publishInput} = await signDocumentChange(
    {
      account: targetId.uid,
      path,
      unsignedChange: prepareResult.unsignedChange,
      genesis: latestDocument.genesis,
      generation: getRestoreVersionGeneration(latestDocument),
      capability: input.capabilityCid ?? '',
      visibility,
    },
    deps.getSigner(input.signerAccountUid),
  )

  await deps.client.publish(publishInput)

  const after = await deps.client.request('Resource', {
    ...targetId,
    version: changeCid.toString(),
    latest: false,
  })
  if (after.type !== 'document') throw new Error('post-restore resource is not a document')

  const draft = await getLatestWebDocDraftForDoc(targetId.id)
  if (draft) {
    await deleteWebDocDraft(draft.draftId)
  }

  invalidateAfterPublish(targetId, after.document)
  invalidateQueries([queryKeys.ACTIVITY_FEED])
  invalidateQueries(['web-doc-draft', targetId.id])
  try {
    await refetchQueriesByKey(['web-doc-draft', targetId.id])
  } catch {
    // Non-critical: the stale draft cache will clear on the next mount.
  }

  return after.document
}

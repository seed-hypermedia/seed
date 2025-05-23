import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, hmIdPathToEntityQueryPath} from '@shm/shared'
import {HMDocumentChangeInfo} from './hm.api.changes'

export type HMDocumentChangesPayload = {
  changes: Array<HMDocumentChangeInfo>
  latestVersion: string
}

export const loader = apiGetter(async (req) => {
  const [_api, _changes, uid, ...restPath] = req.pathParts
  const path = hmIdPathToEntityQueryPath(restPath)
  const latestDoc = await queryClient.documents.getDocument({
    account: uid,
    path,
    version: undefined,
  })
  const result = await queryClient.documents.listDocumentChanges({
    account: uid,
    path,
    version: latestDoc.version,
    pageSize: BIG_INT,
  })
  const changes = result.toJson() as Array<HMDocumentChangeInfo>
  return {
    changes,
    latestVersion: latestDoc.version,
  } satisfies HMDocumentChangesPayload
})

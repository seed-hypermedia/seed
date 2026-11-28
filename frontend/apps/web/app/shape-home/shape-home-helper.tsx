import {ShapeHomeHelperContainer, type ShapeHomeHelperSnapshotJob} from '@shm/ui/shape-home-helper-container'
import {toast} from '@shm/ui/toast'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {type ShapeHomeSiteRecord} from '@shm/shared/models/shape-home-machines'
import {loadShapeHomeStatus} from '@shm/shared/utils/shape-home'
import {useQuery} from '@tanstack/react-query'
import {useMemo} from 'react'
import {
  enqueueWebDocumentCardCleanup,
  getWebDocumentCardCleanupSnapshot,
  retryWebDocumentCardCleanup,
} from '../document-edit/web-document-card-cleanup'
import {webUniversalClient} from '../universal-client'
import {persistShapeHomeSiteRecord} from './store'
import {useWebShapeHomeGate} from './use-web-shape-home-gate'

/** Web Shape Home helper block rendered above Home content for sites that need shaping. */
export function WebShapeHomeHelper() {
  const gate = useWebShapeHomeGate()
  const uid = gate.uid
  const record = gate.record

  const effects = useMemo(
    () => ({
      loadCandidates: async (u: string) => (await loadShapeHomeStatus(webUniversalClient, u)).candidates,
      enqueueAddCards: async (u: string, targetIds: string[]) => {
        const result = await enqueueWebDocumentCardCleanup(
          {
            operation: 'add-cards',
            parentDocumentId: hmId(u).id,
            targetDocumentIds: targetIds,
            signingAccountUid: u,
          },
          {client: webUniversalClient},
        )
        if (!('jobId' in result) || !result.jobId) throw new Error('Could not queue the Home update')
        return {jobId: result.jobId}
      },
      retryJob: async (jobId: string) => {
        await retryWebDocumentCardCleanup(jobId)
      },
      persistRecord: (u: string, r: ShapeHomeSiteRecord) => persistShapeHomeSiteRecord(u, r),
      refreshHome: (u: string) => {
        const homeId = hmId(u).id
        invalidateQueries([queryKeys.ENTITY, homeId])
        invalidateQueries([queryKeys.RESOLVED_ENTITY, homeId])
        invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, homeId])
      },
      toastResult: (added: string[], skipped: string[]) => {
        if (skipped.length > 0) {
          toast.success(`Added ${added.length} of ${added.length + skipped.length} pages to Home`)
        } else {
          toast.success(`Added ${added.length} pages to Home`)
        }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid],
  )

  const snapshotQuery = useQuery({
    queryKey: ['web-document-card-cleanup'],
    queryFn: () => getWebDocumentCardCleanupSnapshot(),
    refetchInterval: 1_000,
  })

  const jobs: ShapeHomeHelperSnapshotJob[] = (snapshotQuery.data?.jobs ?? []) as any

  if (!uid || (!gate.eligible && record?.status !== 'adding')) return null

  return <ShapeHomeHelperContainer uid={uid} record={record} effects={effects} jobs={jobs} />
}

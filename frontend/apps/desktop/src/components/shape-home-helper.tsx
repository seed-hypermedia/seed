import {client} from '@/trpc'
import {useUniversalAppContext} from '@shm/shared'
import {hmId} from '@shm/shared'
import {loadShapeHomeStatus} from '@shm/shared/utils/shape-home'
import {type ShapeHomeSiteRecord} from '@shm/shared/models/shape-home-machines'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {ShapeHomeHelperContainer, type ShapeHomeHelperSnapshotJob} from '@shm/ui/shape-home-helper-container'
import {toast} from '@shm/ui/toast'
import {useQuery} from '@tanstack/react-query'

/** Desktop Shape Home helper block rendered above Home content for sites that need shaping. */
export function DesktopShapeHomeHelper({uid, record}: {uid: string; record?: ShapeHomeSiteRecord}) {
  const {universalClient} = useUniversalAppContext()

  const effects = {
    loadCandidates: async (u: string) => (await loadShapeHomeStatus(universalClient as any, u)).candidates,
    enqueueAddCards: async (u: string, targetIds: string[]) => {
      const res = await client.documentCardCleanup.enqueue.mutate({
        operation: 'add-cards',
        parentDocumentId: hmId(u).id,
        targetDocumentIds: targetIds,
        signingAccountUid: u,
      })
      if (!('jobId' in res) || !res.jobId) throw new Error('Could not queue the Home update')
      return {jobId: res.jobId}
    },
    retryJob: async (jobId: string) => {
      await client.documentCardCleanup.retry.mutate({jobId})
    },
    persistRecord: (u: string, r: ShapeHomeSiteRecord) => {
      client.shapeHome.setSiteRecord.mutate({uid: u, record: r}).catch(() => {})
    },
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
  }

  const snapshotQuery = useQuery({
    queryKey: ['trpc.documentCardCleanup.getSnapshot'],
    queryFn: () => client.documentCardCleanup.getSnapshot.query() as Promise<{jobs: ShapeHomeHelperSnapshotJob[]}>,
  })

  const jobs = snapshotQuery.data?.jobs ?? []

  return <ShapeHomeHelperContainer uid={uid} record={record} effects={effects} jobs={jobs} />
}

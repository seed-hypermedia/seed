import type {ReactNode} from 'react'
import {client} from '@/trpc'
import {useNavigate} from '@/utils/useNavigate'
import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import {DocumentMaintenance, documentCleanupItems} from '@shm/ui/document-maintenance'
import {useQuery} from '@tanstack/react-query'

/** Makes the main-process durable recovery queue reachable in every desktop window. */
export function DesktopDocumentMaintenance({children}: {children?: ReactNode}) {
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: ['trpc.documentCardCleanup.getSnapshot'],
    queryFn: () => client.documentCardCleanup.getSnapshot.query(),
  })
  return (
    <DocumentMaintenance
      items={documentCleanupItems(query.data?.jobs || [])}
      loadError={
        query.data?.storageError ||
        (query.error ? 'Could not load document maintenance. Reopen the app to try again.' : undefined)
      }
      onRetry={async (jobId) => {
        await client.documentCardCleanup.retry.mutate({jobId})
        await query.refetch()
      }}
      onDismiss={async (jobId) => {
        await client.documentCardCleanup.dismiss.mutate({jobId})
        await query.refetch()
      }}
      onClearDismissed={async () => {
        await client.documentCardCleanup.clearDismissed.mutate()
        await query.refetch()
      }}
      onReviewDeletion={(jobId) => client.documentCardCleanup.reviewDeletion.query({jobId})}
      onConfirmDeletion={async (jobId, approvedSubtree) => {
        await client.documentCardCleanup.confirmDeletion.mutate({jobId, approvedSubtree})
        await query.refetch()
      }}
      onOpenDocument={(documentId) => {
        const id = unpackHmId(documentId)
        if (id) navigate({key: 'document', id})
      }}
    >
      {children}
    </DocumentMaintenance>
  )
}

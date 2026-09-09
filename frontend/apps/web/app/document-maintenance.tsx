import type {ReactNode} from 'react'
import {useNavigate} from '@remix-run/react'
import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import {routeToHref} from '@shm/shared'
import {DocumentMaintenance, documentCleanupItems} from '@shm/ui/document-maintenance'
import {useQuery} from '@tanstack/react-query'
import {useEffect, useState} from 'react'
import {
  reviewWebDocumentCardCleanupDeletion,
  confirmWebDocumentCardCleanupDeletion,
  dismissWebDocumentCardCleanup,
  clearDismissedWebDocumentCardCleanup,
  getWebDocumentCardCleanupSnapshot,
  getWebDocumentCardCleanupWorkerError,
  retryWebDocumentCardCleanup,
  startWebDocumentCardCleanupCoordinator,
} from './document-edit/web-document-card-cleanup'
import {webUniversalClient} from './universal-client'

/** Starts per-device recovery outside document routes and exposes its durable attention list. */
export function WebDocumentMaintenance({children}: {children?: ReactNode}) {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string>()
  useEffect(() => {
    try {
      startWebDocumentCardCleanupCoordinator({client: webUniversalClient})
      setReady(true)
    } catch (error) {
      setStartupError(error instanceof Error ? error.message : 'Could not start document maintenance.')
    }
  }, [])
  const query = useQuery({
    queryKey: ['web-document-card-cleanup'],
    queryFn: () => ({...getWebDocumentCardCleanupSnapshot(), workerError: getWebDocumentCardCleanupWorkerError()}),
    enabled: ready,
  })
  return (
    <DocumentMaintenance
      items={documentCleanupItems(query.data?.jobs || [])}
      loadError={
        startupError ||
        query.data?.workerError ||
        (query.error ? 'Could not load document maintenance. Reload to try again.' : undefined)
      }
      onRetry={async (jobId) => {
        await retryWebDocumentCardCleanup(jobId)
        await query.refetch()
      }}
      onDismiss={async (jobId) => {
        await dismissWebDocumentCardCleanup(jobId)
        await query.refetch()
      }}
      onClearDismissed={async () => {
        await clearDismissedWebDocumentCardCleanup()
        await query.refetch()
      }}
      onReviewDeletion={reviewWebDocumentCardCleanupDeletion}
      onConfirmDeletion={async (jobId, approvedSubtree) => {
        await confirmWebDocumentCardCleanupDeletion(jobId, approvedSubtree)
        await query.refetch()
      }}
      onOpenDocument={(documentId) => {
        const id = unpackHmId(documentId)
        if (id) {
          const href = routeToHref({key: 'document', id})
          if (href) navigate(href)
        }
      }}
    >
      {children}
    </DocumentMaintenance>
  )
}

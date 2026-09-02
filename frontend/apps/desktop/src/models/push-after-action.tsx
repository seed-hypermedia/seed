import {reportError} from '@/errors'
import {usePushResource} from '@/models/documents'
import {usePushOnCopy, usePushOnPublish} from '@/models/gateway-settings'
import {trackPushInFooter} from '@/models/push-status'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {CopiedToast, PushResourceStatus} from '@shm/ui/push-toast'
import {toast} from '@shm/ui/toast'
import {useCallback} from 'react'

/**
 * Shared helper used after publishing a document/comment or copying a link.
 * Gates on the user's `pushOnPublish` or `pushOnCopy` preference and pushes
 * to the relevant servers. Publish-triggered pushes surface progress in the
 * window footer. Copy-triggered pushes keep a toast as immediate feedback
 * next to the action. Fire-and-forget — the returned callback never rejects.
 */
export function usePushAfterAction() {
  const pushResource = usePushResource()
  const pushOnPublish = usePushOnPublish()
  const pushOnCopy = usePushOnCopy()
  return useCallback(
    (params: {id: UnpackedHypermediaId; trigger: 'publish' | 'copy'; onlyPushToHost?: string}) => {
      const setting = params.trigger === 'copy' ? pushOnCopy.data : pushOnPublish.data
      if (setting === 'never') return
      const [setStatus, status] = writeableStateStream<PushResourceStatus | null>(null)
      const promise = pushResource(params.id, params.onlyPushToHost, setStatus)
      if (params.trigger === 'copy') {
        toast.promise(promise, {
          loading: <CopiedToast pushStatus={status} status="loading" />,
          success: <CopiedToast pushStatus={status} status="success" />,
          error: (err) => <CopiedToast pushStatus={status} status="error" errorMessage={err?.message} />,
        })
      } else {
        trackPushInFooter(promise, status)
      }
      promise.catch((err) => {
        console.error('[push-after-action]', params.trigger, err)
        reportError(err, {
          feature: 'push-after-action',
          operation: 'top-level',
          trigger: params.trigger,
          resourceId: params.id.id,
          onlyPushToHost: params.onlyPushToHost,
        })
      })
    },
    [pushResource, pushOnPublish.data, pushOnCopy.data],
  )
}

import {usePushResource} from '@/models/documents'
import {usePushOnCopy, usePushOnPublish} from '@/models/gateway-settings'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {CopiedToast, PushedToast, PushResourceStatus} from '@shm/ui/push-toast'
import {toast} from '@shm/ui/toast'
import {useCallback} from 'react'

/**
 * Shared helper used after publishing a document/comment or copying a link.
 * Gates on the user's `pushOnPublish` or `pushOnCopy` preference, pushes to
 * the relevant servers, and surfaces progress via a toast. Fire-and-forget —
 * the returned callback never rejects and the push lifecycle is owned by
 * `toast.promise`.
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
      const Toast = params.trigger === 'copy' ? CopiedToast : PushedToast
      toast.promise(promise, {
        loading: <Toast pushStatus={status} status="loading" />,
        success: <Toast pushStatus={status} status="success" />,
        error: (err) => <Toast pushStatus={status} status="error" errorMessage={err?.message} />,
      })
      promise.catch((err) => {
        console.error('[push-after-action]', params.trigger, err)
      })
    },
    [pushResource, pushOnPublish.data, pushOnCopy.data],
  )
}

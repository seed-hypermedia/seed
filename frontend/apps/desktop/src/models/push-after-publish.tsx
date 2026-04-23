import {usePushResource} from '@/models/documents'
import {usePushOnPublish} from '@/models/gateway-settings'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {PushedToast, PushResourceStatus} from '@shm/ui/push-toast'
import {toast} from '@shm/ui/toast'
import {useCallback} from 'react'

/**
 * Shared helper used after publishing a document or comment. Gates on the
 * user's `pushOnPublish` preference, pushes to destination servers, and
 * surfaces progress via a toast. Fire-and-forget — the returned callback
 * never rejects and the push lifecycle is owned by `toast.promise`.
 */
export function usePushAfterPublish() {
  const pushResource = usePushResource()
  const pushOnPublish = usePushOnPublish()
  return useCallback(
    (id: UnpackedHypermediaId) => {
      if (pushOnPublish.data === 'never') return
      const [setPushStatus, pushStatus] = writeableStateStream<PushResourceStatus | null>(null)
      const promise = pushResource(id, undefined, setPushStatus)
      toast.promise(promise, {
        loading: <PushedToast pushStatus={pushStatus} status="loading" />,
        success: <PushedToast pushStatus={pushStatus} status="success" />,
        error: (err) => <PushedToast pushStatus={pushStatus} status="error" errorMessage={err?.message} />,
      })
      promise.catch((err) => {
        console.error('[push-after-publish] failed:', err)
      })
    },
    [pushResource, pushOnPublish.data],
  )
}

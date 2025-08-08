import {grpcClient} from '@/grpc-client'
import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {Subscription} from '@shm/shared/client/.generated/activity/v1alpha/subscriptions_pb'
import {BIG_INT} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
// @ts-expect-error
import {hmId, UnpackedHypermediaId} from '@shm/shared/utils/entity-id-url'
import {
  entityQueryPathToHmIdPath,
  hmIdPathToEntityQueryPath,
} from '@shm/shared/utils/path-api'
import {useMutation, useQuery} from '@tanstack/react-query'

export type HMSubscription = Omit<PlainMessage<Subscription>, 'path'> & {
  id: UnpackedHypermediaId
}

export function useSubscription(id: UnpackedHypermediaId) {
  const allSubs = useListSubscriptions()
  const exactSubscription = allSubs.data?.find(
    (sub) =>
      sub.account === id.uid && sub.path === hmIdPathToEntityQueryPath(id.path),
  )
  let parentSubscription = null
  if (!exactSubscription) {
    parentSubscription = allSubs.data?.find(
      (sub) =>
        sub.account === id.uid &&
        hmIdPathToEntityQueryPath(id.path).startsWith(sub.path) &&
        sub.recursive,
    )
  }
  const setSubscription = useSetSubscription()
  return {
    parentSubscription,
    exactSubscription,
    unsubscribeParent: () => {
      if (!parentSubscription) return
      setSubscription.mutate({
        id: parentSubscription.id,
        subscribed: false,
      })
    },
    subscription: exactSubscription
      ? exactSubscription.recursive
        ? 'space'
        : 'document'
      : parentSubscription
      ? 'parent'
      : 'none',
    setSubscription: (type: 'none' | 'document' | 'space') => {
      setSubscription.mutate({
        id,
        subscribed: type !== 'none',
        recursive: type === 'space',
      })
    },
  }
}

export function useListSubscriptions() {
  return useQuery({
    queryKey: [queryKeys.SUBSCRIPTIONS],
    queryFn: async () => {
      const resp = await grpcClient.subscriptions.listSubscriptions({
        pageSize: BIG_INT,
      })
      return resp.subscriptions.map(toPlainMessage).map((sub) => ({
        ...sub,
        id: hmId(sub.account, {
          path: entityQueryPathToHmIdPath(sub.path),
        }),
      }))
    },
  })
}

export function useSetSubscription() {
  return useMutation({
    mutationFn: async (input: {
      subscribed: boolean
      id: UnpackedHypermediaId
      recursive?: boolean
    }) => {
      if (input.subscribed) {
        await grpcClient.subscriptions.subscribe({
          account: input.id.uid,
          path: hmIdPathToEntityQueryPath(input.id.path),
          recursive: !!input.recursive,
        })
      } else {
        await grpcClient.subscriptions.unsubscribe({
          account: input.id.uid,
          path: hmIdPathToEntityQueryPath(input.id.path),
        })
      }
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.SUBSCRIPTIONS])
    },
  })
}

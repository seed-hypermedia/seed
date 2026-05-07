import {HMRequestImplementation} from './api-types'
import {
  HMListSubscriptionsRequest,
  HMSubscribeRequest,
  HMUnsubscribeRequest,
} from '@seed-hypermedia/client/hm-types'

/** Subscribe to a document or space (recursive=true mirrors all docs under path). */
export const Subscribe: HMRequestImplementation<HMSubscribeRequest> = {
  async getData(grpcClient, input) {
    await grpcClient.subscriptions.subscribe({
      account: input.account,
      path: input.path ?? '',
      recursive: !!input.recursive,
      async: input.async,
    })
    return {}
  },
}

/** Remove a subscription. */
export const Unsubscribe: HMRequestImplementation<HMUnsubscribeRequest> = {
  async getData(grpcClient, input) {
    await grpcClient.subscriptions.unsubscribe({
      account: input.account,
      path: input.path ?? '',
    })
    return {}
  },
}

/** List active subscriptions on this daemon. */
export const ListSubscriptions: HMRequestImplementation<HMListSubscriptionsRequest> = {
  async getData(grpcClient, input) {
    const result = await grpcClient.subscriptions.listSubscriptions({
      pageSize: input.pageSize,
      pageToken: input.pageToken,
    })
    return {
      subscriptions: result.subscriptions.map((s) => ({
        account: s.account,
        path: s.path,
        recursive: s.recursive,
        since: s.since ? s.since.toDate().toISOString() : undefined,
      })),
      nextPageToken: result.nextPageToken || undefined,
    }
  },
}

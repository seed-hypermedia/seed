import {HMRequestImplementation} from './api-types'
import {HMForceSyncRequest} from '@seed-hypermedia/client/hm-types'
import {discoveryUrl} from './discovery'
import {BIG_INT} from './constants'

/**
 * Trigger immediate discovery of every active subscription.
 *
 * The original `Daemon.ForceSync` RPC is deprecated and now returns
 * `Unimplemented`. We replace it with a fan-out over the entities service:
 *   1. List active subscriptions.
 *   2. For each, call `Entities.DiscoverEntity` with `recursion=descendants`
 *      and `async=true` so the daemon promotes that subtree into the hot
 *      discovery tier without blocking the caller.
 *
 * Returns once all DiscoverEntity calls have been dispatched (not when
 * discovery completes — that's monitored separately via `site sync-status`).
 */
export const ForceSync: HMRequestImplementation<HMForceSyncRequest> = {
  async getData(grpcClient) {
    const subs = await grpcClient.subscriptions.listSubscriptions({pageSize: BIG_INT})
    await Promise.all(
      subs.subscriptions.map((s) =>
        grpcClient.entities.discoverEntity({
          id: discoveryUrl({
            uid: s.account,
            path: pathStringToParts(s.path),
            recursion: s.recursive ? 'descendants' : 'none',
          }),
        }),
      ),
    )
    return {}
  },
}

function pathStringToParts(path: string): string[] | null {
  if (!path) return null
  return path.split('/').filter(Boolean)
}

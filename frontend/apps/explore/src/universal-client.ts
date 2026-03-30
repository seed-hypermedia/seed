import {createWebUniversalClient, type WebClientDependencies} from '@shm/shared/create-web-universal-client'
import type {HMRequest} from '@seed-hypermedia/client/hm-types'
import {createSeedClient} from '@seed-hypermedia/client'
import {getApiHost} from './queryClient'

/** Adapter that keeps Explore requests bound to the current API host. */
const request: WebClientDependencies['request'] = ((key: HMRequest['key'], input: HMRequest['input']) => {
  const client = createSeedClient(getApiHost())
  return client.request(key as never, input as never)
}) as WebClientDependencies['request']

/** Universal client used by Explore to talk to the configured desktop API host. */
export const exploreUniversalClient = createWebUniversalClient({
  request,
  publish: (input) => {
    const client = createSeedClient(getApiHost())
    return client.publish(input)
  },
  // Explore app doesn't need comment editing
  CommentEditor: () => null as unknown as JSX.Element,
})

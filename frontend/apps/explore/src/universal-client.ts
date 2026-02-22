import {createWebUniversalClient} from '@shm/shared'
import type {HMRequest} from '@shm/shared'
import {createSeedClient} from '@seed-hypermedia/client'
import {getApiHost} from './queryClient'

export const exploreUniversalClient = createWebUniversalClient({
  request: <Req extends HMRequest>(key: Req['key'], input: Req['input']) => {
    // Create client per-request since apiHost can change at runtime
    const client = createSeedClient(getApiHost())
    return client.request<Req>(key, input)
  },
  // Explore app doesn't need comment editing
  CommentEditor: () => null as unknown as JSX.Element,
})

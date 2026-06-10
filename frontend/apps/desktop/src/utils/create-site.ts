import {grpcClient} from '@/grpc-client'
import {fetchResource} from '@/models/entities'
import {client} from '@/trpc'
import {DiscoveryTaskState} from '@shm/shared'
import {discoveryUrl} from '@shm/shared/discovery'
import {tryUntilSuccess} from '@shm/shared/try-until-success'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {nanoid} from 'nanoid'

async function waitForHomeDiscovery(accountUid: string) {
  await tryUntilSuccess(
    async () => {
      const response = await grpcClient.entities.discoverEntity({
        id: discoveryUrl({uid: accountUid, path: []}),
      })
      return response.state === DiscoveryTaskState.DISCOVERY_TASK_COMPLETED ? response : null
    },
    {retryDelayMs: 1_000, maxRetryMs: 60_000},
  )
}

/** Returns the account home document id, creating a home draft only after discovery confirms no home document exists. */
export async function getOrCreateSiteHome(accountUid: string) {
  const homeId = hmId(accountUid, {path: []})
  await waitForHomeDiscovery(accountUid)
  const homeResource = await fetchResource(homeId)
  if (homeResource.type === 'document' || homeResource.type === 'redirect') return homeId
  if (homeResource.type !== 'not-found' && homeResource.type !== 'tombstone') {
    throw new Error(`Unexpected home document status: ${homeResource.type}`)
  }

  const draftId = nanoid(10)
  await client.drafts.write.mutate({
    id: draftId,
    editUid: accountUid,
    editPath: [],
    metadata: {},
    content: [],
    deps: [],
    visibility: 'PUBLIC',
  })
  return homeId
}

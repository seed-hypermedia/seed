import {grpcClient} from '@/grpc-client'
import {fetchResource} from '@/models/entities'
import {client} from '@/trpc'
import {DiscoveryTaskState} from '@shm/shared'
import {discoveryUrl} from '@shm/shared/discovery'
import {tryUntilSuccess} from '@shm/shared/try-until-success'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {nanoid} from 'nanoid'

const remoteSignInHomeDiscoveryTasks = new Map<string, Promise<void>>()
const remoteSignInHomeDiscoveryCompleted = new Set<string>()

function waitForRemoteSignInHomeDiscovery(accountUid: string) {
  const existing = remoteSignInHomeDiscoveryTasks.get(accountUid)
  if (existing) return existing

  const task = tryUntilSuccess(
    async () => {
      const response = await grpcClient.entities.discoverEntity({
        id: discoveryUrl({uid: accountUid, path: []}),
      })
      return response.state === DiscoveryTaskState.DISCOVERY_TASK_COMPLETED ? response : null
    },
    {retryDelayMs: 1_000, maxRetryMs: 60_000},
  )
    .then(() => {
      remoteSignInHomeDiscoveryCompleted.add(accountUid)
    })
    .catch((error) => {
      remoteSignInHomeDiscoveryTasks.delete(accountUid)
      throw error
    })

  remoteSignInHomeDiscoveryTasks.set(accountUid, task)
  return task
}

/** Discovers account home documents once after remote vault sign-in, before any pending create-site intent runs. */
export function syncRemoteSignInSiteHomes(accountUids: string[]) {
  return Promise.all(
    Array.from(new Set(accountUids)).map((accountUid) => waitForRemoteSignInHomeDiscovery(accountUid)),
  ).then(() => {})
}

/** Returns the account home document id, creating a home draft immediately except right after remote sign-in discovery. */
export async function getOrCreateSiteHome(accountUid: string) {
  const homeId = hmId(accountUid, {path: []})
  if (remoteSignInHomeDiscoveryCompleted.has(accountUid)) {
    const homeResource = await fetchResource(homeId)
    if (homeResource.type === 'document' || homeResource.type === 'redirect') return homeId
    if (homeResource.type !== 'not-found' && homeResource.type !== 'tombstone') {
      throw new Error(`Unexpected home document status: ${homeResource.type}`)
    }
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

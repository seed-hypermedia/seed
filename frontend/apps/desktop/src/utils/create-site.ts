import {grpcClient} from '@/grpc-client'
import {fetchResource} from '@/models/entities'
import {DiscoveryTaskState} from '@shm/shared'
import {discoveryUrl} from '@shm/shared/discovery'
import {tryUntilSuccess} from '@shm/shared/try-until-success'
import {hmId} from '@shm/shared/utils/entity-id-url'

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

/**
 * Returns the account's existing home document id, or null when the account has no space yet.
 * Only checks right after remote sign-in discovery, when an existing space may have just synced.
 */
export async function findExistingSiteHome(accountUid: string) {
  if (!remoteSignInHomeDiscoveryCompleted.has(accountUid)) return null
  const homeId = hmId(accountUid, {path: []})
  const homeResource = await fetchResource(homeId)
  if (homeResource.type === 'document' || homeResource.type === 'redirect') return homeId
  if (homeResource.type !== 'not-found' && homeResource.type !== 'tombstone') {
    throw new Error(`Unexpected home document status: ${homeResource.type}`)
  }
  return null
}

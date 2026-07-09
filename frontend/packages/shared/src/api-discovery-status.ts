import type {HMDiscoveryStatusRequest} from '@seed-hypermedia/client/hm-types'
import {DiscoveryTaskState} from './client/.generated/entities/v1alpha/entities_pb'
import type {HMRequestImplementation, HMRequestParams} from './api-types'
import {discoveryUrl} from './discovery'
import type {GRPCClient} from './grpc-client'
import {hmIdPathToEntityQueryPath} from './utils/path-api'

/**
 * Trigger/poll discovery without blocking. The daemon's discoverEntity call
 * returns immediately with the current task state (starting a task if none
 * exists), so this is safe to call from a request handler that must respond
 * fast, and to call repeatedly from a polling client.
 *
 * This is the only way discovery gets started for gateway page loads: SSR
 * never pokes discovery for not-found resources, it renders a shim page
 * whose JS polls this endpoint. Clients that don't execute JS (crawlers,
 * vulnerability scanners) therefore never start discovery tasks.
 */
export const DiscoveryStatus: HMRequestImplementation<HMDiscoveryStatusRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMDiscoveryStatusRequest['output']> {
    const {uid, path, version, latest} = input
    function isDiscoverySuccess(discoveredVersion: string) {
      if (latest && discoveredVersion) return true
      if (!version && discoveredVersion) return true
      if (version && version === discoveredVersion) return true
      return false
    }
    try {
      const resp = await grpcClient.entities.discoverEntity({
        id: discoveryUrl({uid, path, recursion: 'descendants'}),
        version: version || undefined,
      })
      if (isDiscoverySuccess(resp.version)) {
        return {state: 'found', version: resp.version}
      }
      if (resp.state === DiscoveryTaskState.DISCOVERY_TASK_COMPLETED) {
        return {state: 'failed', error: resp.lastError || undefined}
      }
      return {state: 'pending'}
    } catch (e) {
      console.warn(`discoverEntity error on hm://${uid}${hmIdPathToEntityQueryPath(path)},  error: ${e}`)
      // The discovery call sometimes errors randomly; check whether the
      // document is already available before reporting the task as pending.
      try {
        const doc = await grpcClient.documents.getDocument({
          account: uid,
          path: hmIdPathToEntityQueryPath(path),
          version: version || undefined,
        })
        if (isDiscoverySuccess(doc.version)) {
          return {state: 'found', version: doc.version}
        }
      } catch (docError) {}
      return {state: 'pending', error: e instanceof Error ? e.message : String(e)}
    }
  },
}

export const DiscoveryStatusParams: HMRequestParams<HMDiscoveryStatusRequest> = {
  inputToParams: (input) => {
    const params: Record<string, string> = {uid: input.uid, path: input.path.join('/')}
    if (input.version) params.v = input.version
    if (input.latest) params.l = ''
    return params
  },
  paramsToInput: (params) => {
    if (!params.uid) {
      throw new Error('uid query param is required')
    }
    return {
      uid: params.uid,
      path: (params.path || '').split('/').filter(Boolean),
      version: params.v || undefined,
      latest: params.l !== undefined ? true : undefined,
    }
  },
}

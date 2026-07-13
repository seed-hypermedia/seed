import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {queryKeys, useUniversalClient} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {useCallback, useRef, useState} from 'react'

export type DiscoverState =
  | {status: 'idle'}
  | {status: 'discovering'}
  | {status: 'found'}
  | {status: 'failed'; error?: string}

const POLL_INTERVAL_MS = 1500
const DISCOVERY_TIMEOUT_MS = 60_000

/**
 * Triggers the daemon's async discovery for a resource that isn't available on
 * the configured host, then polls until it is found (or fails/times out). On
 * success it invalidates the entity queries so the resource view refetches and
 * renders the now-available content.
 *
 * The daemon's `DiscoverEntity` call returns immediately with the current task
 * state (starting one if none exists), so each poll re-pokes discovery — this
 * is the same mechanism the gateway's not-found shim page uses.
 */
export function useDiscoverResource(id: UnpackedHypermediaId) {
  const client = useUniversalClient()
  const [state, setState] = useState<DiscoverState>({status: 'idle'})
  // Guards against overlapping runs when the button is clicked repeatedly.
  const activeRef = useRef(false)

  const discover = useCallback(async () => {
    if (activeRef.current) return
    activeRef.current = true
    setState({status: 'discovering'})

    const input = {
      uid: id.uid,
      path: id.path?.filter(Boolean) ?? [],
      version: id.version || undefined,
      // With no explicit version, accept any discovered version as success.
      latest: id.latest || !id.version,
    }
    const deadline = Date.now() + DISCOVERY_TIMEOUT_MS

    try {
      while (Date.now() < deadline) {
        const res = await client.request('DiscoveryStatus', input)
        if (res.state === 'found') {
          invalidateQueries([queryKeys.ENTITY])
          setState({status: 'found'})
          return
        }
        if (res.state === 'failed') {
          setState({status: 'failed', error: res.error})
          return
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
      setState({status: 'failed', error: 'Discovery timed out. The content may be unavailable on the network.'})
    } catch (e) {
      setState({status: 'failed', error: e instanceof Error ? e.message : String(e)})
    } finally {
      activeRef.current = false
    }
  }, [client, id.uid, id.path, id.version, id.latest])

  return {state, discover}
}

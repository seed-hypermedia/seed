import {grpcClient} from '@/client.server'
import {parseRequest} from '@/request'
import {getOrCreateServerSignerAccountUid} from '@/server-signing'
import {requireSignInEnabled} from '@/require-sign-in.server'
import {getConfig} from '@/site-config.server'
import type {LoaderFunction} from '@remix-run/node'
import {json} from '@remix-run/node'
import {NOTIFY_SERVICE_HOST, SEED_AGENT_SERVER_URL, SITE_BASE_URL, WEB_IS_GATEWAY} from '@shm/shared/constants'
import {notifyServiceOrigin} from '@shm/shared/notify-url'

const corsHeaders = {'Access-Control-Allow-Origin': '*'}

/**
 * The `siteUrl` the registered space's home document carries, so `seed-deploy
 * doctor` can tell when it disagrees with the hostname (after a hostname
 * change that was not followed by `set-hostname`). Null when there is no
 * registered space or the daemon cannot answer; this route must not fail on it.
 */
async function registeredSiteUrl(accountUid: string | undefined): Promise<string | null> {
  if (!accountUid) return null
  try {
    const home = await grpcClient.documents.getDocument({account: accountUid, path: '', version: undefined})
    const metadata = home.metadata ? (home.metadata.toJson() as Record<string, unknown>) : {}
    return typeof metadata.siteUrl === 'string' ? metadata.siteUrl : null
  } catch {
    return null
  }
}

export const loader: LoaderFunction = async ({request}) => {
  try {
    const {hostname} = parseRequest(request)
    const config = await getConfig(hostname)
    if (!config) throw new Error(`No config defined for ${hostname}`)
    const daemonInfo = await grpcClient.daemon.getInfo({})
    const peerInfo = await grpcClient.networking.getPeerInfo({
      deviceId: daemonInfo.peerId,
    })
    const signerAccountUid = await getOrCreateServerSignerAccountUid()
    const siteUrl = await registeredSiteUrl(config.registeredAccountUid)
    return json(
      {
        registeredAccountUid: config.registeredAccountUid,
        siteUrl,
        peerId: daemonInfo.peerId,
        protocolId: daemonInfo.protocolId,
        signerAccountUid,
        addrs: peerInfo.addrs,
        hostname: SITE_BASE_URL,
        isGateway: WEB_IS_GATEWAY,
        // Notify base URL (canonical `<origin>/hm/api/notify`, or a legacy origin-only value);
        // build endpoints with `notifyEndpointUrl`.
        notifyServiceUrl: NOTIFY_SERVICE_HOST || null,
        // Legacy field: older clients append `/hm/api/notifications` to it, which the
        // notify service on that origin still serves.
        notifyServiceHost: NOTIFY_SERVICE_HOST ? notifyServiceOrigin(NOTIFY_SERVICE_HOST) : null,
        agentServerUrl: SEED_AGENT_SERVER_URL || null,
        requireSignIn: requireSignInEnabled(),
      },
      {headers: corsHeaders},
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return json({message}, {status: 500, headers: corsHeaders})
  }
}

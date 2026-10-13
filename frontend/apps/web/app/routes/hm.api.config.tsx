import {grpcClient} from '@/client.server'
import {parseRequest} from '@/request'
import {getOrCreateServerSignerAccountUid} from '@/server-signing'
import {requireSignInEnabled} from '@/require-sign-in.server'
import {getConfig} from '@/site-config.server'
import type {LoaderFunction} from '@remix-run/node'
import {json} from '@remix-run/node'
import {NOTIFY_SERVICE_HOST, SITE_BASE_URL, WEB_IS_GATEWAY} from '@shm/shared/constants'

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
        notifyServiceHost: NOTIFY_SERVICE_HOST || null,
        requireSignIn: requireSignInEnabled(),
      },
      {headers: corsHeaders},
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return json({message}, {status: 500, headers: corsHeaders})
  }
}

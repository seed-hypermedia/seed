import {grpcClient} from '@/client.server'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config.server'
import type {LoaderFunction} from 'react-router'
// removed data import from 'react-router'
import {SITE_BASE_URL, WEB_IS_GATEWAY} from '@shm/shared/constants'

export const loader: LoaderFunction = async ({request}) => {
  const {hostname} = parseRequest(request)
  const config = await getConfig(hostname)
  if (!config) throw new Error(`No config defined for ${hostname}`)
  const daemonInfo = await grpcClient.daemon.getInfo({})
  const peerInfo = await grpcClient.networking.getPeerInfo({
    deviceId: daemonInfo.peerId,
  })
  return Response.json({
    registeredAccountUid: config.registeredAccountUid,
    peerId: daemonInfo.peerId,
    protocolId: daemonInfo.protocolId,
    addrs: peerInfo.addrs,
    hostname: SITE_BASE_URL,
    isGateway: WEB_IS_GATEWAY,
  })
}

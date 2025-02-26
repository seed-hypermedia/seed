import {queryClient} from '@/client'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
import type {LoaderFunction} from '@remix-run/node'
import {json} from '@remix-run/node'
import {SITE_BASE_URL} from '@shm/shared'

export const loader: LoaderFunction = async ({request}) => {
  const {hostname} = parseRequest(request)
  const config = await getConfig(hostname)
  if (!config) throw new Error(`No config defined for ${hostname}`)
  const daemonInfo = await queryClient.daemon.getInfo({})
  const peerInfo = await queryClient.networking.getPeerInfo({
    deviceId: daemonInfo.peerId,
  })
  return json({
    registeredAccountUid: config.registeredAccountUid,
    peerId: daemonInfo.peerId,
    protocolId: daemonInfo.protocolId,
    addrs: peerInfo.addrs,
    hostname: SITE_BASE_URL,
  })
}

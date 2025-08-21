import {grpcClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, ConnectionStatus} from '@shm/shared'

const ConnectionStatusKeys = {
  [ConnectionStatus.NOT_CONNECTED]: 'NOT_CONNECTED',
  [ConnectionStatus.CONNECTED]: 'CONNECTED',
  [ConnectionStatus.CAN_CONNECT]: 'CAN_CONNECT',
  [ConnectionStatus.CANNOT_CONNECT]: 'CANNOT_CONNECT',
  [ConnectionStatus.LIMITED]: 'LIMITED',
} as const

export const loader = apiGetter(async (req) => {
  const peerList = await grpcClient.networking.listPeers({
    pageSize: BIG_INT,
  })
  return {
    peers: peerList.peers.map((peer) => ({
      id: peer.id,
      status: ConnectionStatusKeys[peer.connectionStatus],
    })),
  }
})

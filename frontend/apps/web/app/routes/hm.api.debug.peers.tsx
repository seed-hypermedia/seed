import {grpcClient} from '@/client.server'
import {toPlainMessage} from '@bufbuild/protobuf'
import type {LoaderFunction} from 'react-router'
// removed data import from 'react-router'

export const loader: LoaderFunction = async () => {
  const peers = await grpcClient.networking.listPeers({})
  return Response.json({
    addrs: toPlainMessage(peers),
  })
}

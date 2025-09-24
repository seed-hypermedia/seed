import {grpcClient} from '@/client'
import {toPlainMessage} from '@bufbuild/protobuf'
import type {LoaderFunction} from 'react-router'
import {json} from '@/utils/json'

export const loader: LoaderFunction = async () => {
  const peers = await grpcClient.networking.listPeers({})
  return json({
    addrs: toPlainMessage(peers),
  })
}

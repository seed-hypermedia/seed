import {grpcClient} from '@/client'
import {ActionFunction} from 'react-router'
import {json} from '@/utils/json'

// TODO: this is a debug endpoint for storing blobs, we should probably use higher level actions to avoid abuse

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return json({message: 'Method not allowed'}, {status: 405})
  }
  if (request.headers.get('Content-Type') !== 'application/cbor') {
    return json(
      {message: 'Content-Type must be application/cbor'},
      {status: 400},
    )
  }

  const cborData = await request.arrayBuffer()
  const storeResult = await grpcClient.daemon.storeBlobs({
    blobs: [
      {
        // @ts-expect-error
        data: cborData,
      },
    ],
  })
  return json({
    message: 'Success',
    // @ts-expect-error
    cid: storeResult.blobs[0].cid,
  })
}

import {grpcClient} from '@/client.server'
import {ActionFunction} from 'react-router'

// TODO: this is a debug endpoint for storing blobs, we should probably use higher level actions to avoid abuse

export const action: ActionFunction = async ({request}) => {
  if (request.method !== 'POST') {
    return Response.json({message: 'Method not allowed'}, {status: 405})
  }
  if (request.headers.get('Content-Type') !== 'application/cbor') {
    return Response.json(
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
  return Response.json({
    message: 'Success',
    // @ts-expect-error
    cid: storeResult.blobs[0].cid,
  })
}

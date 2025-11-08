import {grpcClient} from '@/client.server'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {ActionFunction} from 'react-router'

type BlobPayload = {
  data: Uint8Array
  cid: string
  serverSignature?: string
}

export type UpdateDocumentPayload = {
  change: BlobPayload
  ref: BlobPayload
  icon: BlobPayload | null
}

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
  const payload = cborDecode(new Uint8Array(cborData)) as UpdateDocumentPayload

  if (payload.icon) {
    const storedImageResult = await grpcClient.daemon.storeBlobs({
      blobs: [
        {
          cid: payload.icon.cid,
          data: payload.icon.data,
        },
      ],
    })
  }
  const storedHomeResult = await grpcClient.daemon.storeBlobs({
    blobs: [
      {
        cid: payload.change.cid,
        data: payload.change.data,
      },
    ],
  })
  const storedRefResult = await grpcClient.daemon.storeBlobs({
    blobs: [
      {
        cid: payload.ref.cid,
        data: payload.ref.data,
      },
    ],
  })

  return Response.json({
    message: 'Success',
  })
}

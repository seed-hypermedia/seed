import {queryClient} from '@/client'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {ActionFunction, json} from '@remix-run/node'

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
    return json({message: 'Method not allowed'}, {status: 405})
  }
  if (request.headers.get('Content-Type') !== 'application/cbor') {
    return json(
      {message: 'Content-Type must be application/cbor'},
      {status: 400},
    )
  }

  const cborData = await request.arrayBuffer()
  const payload = cborDecode(new Uint8Array(cborData)) as UpdateDocumentPayload

  if (payload.icon) {
    const storedImageResult = await queryClient.daemon.storeBlobs({
      blobs: [
        {
          cid: payload.icon.cid,
          data: payload.icon.data,
        },
      ],
    })
  }
  const storedHomeResult = await queryClient.daemon.storeBlobs({
    blobs: [
      {
        cid: payload.change.cid,
        data: payload.change.data,
      },
    ],
  })
  const storedRefResult = await queryClient.daemon.storeBlobs({
    blobs: [
      {
        cid: payload.ref.cid,
        data: payload.ref.data,
      },
    ],
  })

  return json({
    message: 'Success',
  })
}

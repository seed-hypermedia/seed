import {queryClient} from '@/client'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {ActionFunction, json} from '@remix-run/node'

type BlobPayload = {
  data: Uint8Array
  cid: string
  serverSignature?: string
}

export type CreateAccountPayload = {
  genesis: BlobPayload
  home: BlobPayload
  ref: Uint8Array
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
  const payload = cborDecode(new Uint8Array(cborData)) as CreateAccountPayload

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

  const storedGenesisResult = await queryClient.daemon.storeBlobs({
    blobs: [
      {
        cid: payload.genesis.cid,
        data: payload.genesis.data,
      },
    ],
  })
  const storedHomeResult = await queryClient.daemon.storeBlobs({
    blobs: [
      {
        cid: payload.home.cid,
        data: payload.home.data,
      },
    ],
  })
  const storedRefResult = await queryClient.daemon.storeBlobs({
    blobs: [
      {
        data: payload.ref,
      },
    ],
  })

  return json({
    message: 'Success',
  })
}

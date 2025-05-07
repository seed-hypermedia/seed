import {queryClient} from '@/client'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {ActionFunction, json} from '@remix-run/node'

export type DelegateDevicePayload = {
  profileAlias: Uint8Array
  browserToAppCap: Uint8Array
}

export type DelegateDeviceResponsePayload = {
  message: string
}

async function storeBlob(blob: Uint8Array) {
  const result = await queryClient.daemon.storeBlobs({
    blobs: [{data: blob}],
  })
  return result.cids[0]
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
  const delegateDevicePayload = cborDecode(
    new Uint8Array(cborData),
  ) as DelegateDevicePayload
  const profileAliasCid = await storeBlob(delegateDevicePayload.profileAlias)
  console.log('~~ profileAliasCid', profileAliasCid)
  const browserToAppCapCid = await storeBlob(
    delegateDevicePayload.browserToAppCap,
  )
  console.log('~~ browserToAppCapCid', browserToAppCapCid)

  return json({
    message: 'Success',
  } satisfies DelegateDeviceResponsePayload)
}

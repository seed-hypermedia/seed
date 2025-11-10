import {grpcClient} from '@/client.server'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {ActionFunction, json} from '@remix-run/node'

export type DelegateDevicePayload = {
  profileAlias: Uint8Array
  browserToAppCap: Uint8Array
  appToBrowserCap: Uint8Array
}

export type DelegateDeviceResponsePayload = {
  message: string
  profileAliasCid: string
  browserToAppCapCid: string
  appToBrowserCapCid: string
}

async function storeBlob(blob: Uint8Array) {
  const result = await grpcClient.daemon.storeBlobs({
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
  const browserToAppCapCid = await storeBlob(
    delegateDevicePayload.browserToAppCap,
  )
  const appToBrowserCapCid = await storeBlob(
    delegateDevicePayload.appToBrowserCap,
  )
  const profileAliasCid = await storeBlob(delegateDevicePayload.profileAlias)

  return json({
    message: 'Success',
    // @ts-expect-error
    profileAliasCid,
    // @ts-expect-error
    browserToAppCapCid,
    // @ts-expect-error
    appToBrowserCapCid,
  } satisfies DelegateDeviceResponsePayload)
}

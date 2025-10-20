export {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'

export * as rawCodec from 'multiformats/codecs/raw'

export async function postCBOR(path: string, body: Uint8Array) {
  const response = await fetch(`${path}`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/cbor',
    },
  })
  return await response.json()
}

export async function get(path: string) {
  const response = await fetch(`${path}`, {})
  return await response.json()
}

export async function post(path: string, body: any) {
  const response = await fetch(`${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return await response.json()
}

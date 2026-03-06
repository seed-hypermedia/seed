import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {BlockView} from 'multiformats'
import * as Block from 'multiformats/block'
import {sha256} from 'multiformats/hashes/sha2'

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

export const cborCodec = {
  code: 0x71,
  encode: (input: any) => cborEncode(input),
  name: 'DAG-CBOR',
}

type EncodedBlock = BlockView<unknown, number, 18, 1>

export async function encodeBlock(
  data: any,
  codec?: Parameters<typeof Block.encode>[0]['codec'],
): Promise<EncodedBlock> {
  const block = await Block.encode({
    value: data,
    codec: codec || cborCodec,
    hasher: sha256,
  })
  return block
}


export async function getChangesDepth(deps: string[]) {
  const allDepths = await Promise.all(
    deps.map(async (dep) => {
      const res = await fetch(getDaemonFileUrl(dep))
      const data = await res.arrayBuffer()
      const cborData = new Uint8Array(data)
      const decoded = cborDecode(cborData) as {depth: number}
      return decoded.depth
    }),
  )
  return Math.max(...allDepths)
}


import {grpcClient} from '@/client.server'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {ActionFunction, json} from '@remix-run/node'
import * as blobs from '@shm/shared/blobs'

export type UploadDelegationPayload = {
  vaultCapability: blobs.StoredBlob<blobs.Capability>
  vaultProfile: blobs.StoredBlob<blobs.Profile>
  reverseCapability: blobs.StoredBlob<blobs.Capability>
  reverseProfile: blobs.StoredBlob<blobs.Profile>
}

export type UploadDelegationResponse = {
  message: string
}

function validateStoredBlob<T extends blobs.Blob>(
  storedBlob: blobs.StoredBlob<T>,
  label: string,
): blobs.EncodedBlob<T> {
  const encodedBlob = blobs.encode(storedBlob.decoded)
  if (encodedBlob.cid.toString() !== storedBlob.cid.toString()) {
    throw new Error(`${label} CID mismatch`)
  }
  return encodedBlob
}

async function storeBlob<T extends blobs.Blob>(blob: blobs.EncodedBlob<T>) {
  await grpcClient.daemon.storeBlobs({
    blobs: [
      {
        cid: blob.cid.toString(),
        data: blob.data,
      },
    ],
  })
}

export const action: ActionFunction = async ({request}) => {
  // Add CORS headers for cross-origin delegation persistence.
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (request.method !== 'POST') {
    return json({message: 'Method not allowed'}, {status: 405})
  }
  if (request.headers.get('Content-Type') !== 'application/cbor') {
    return json({message: 'Content-Type must be application/cbor'}, {status: 400})
  }

  const cborData = await request.arrayBuffer()

  let payload: UploadDelegationPayload
  try {
    payload = cborDecode(new Uint8Array(cborData)) as UploadDelegationPayload
  } catch (_error) {
    return json({message: 'Failed to decode payload'}, {status: 400})
  }

  let vaultCapability: blobs.EncodedBlob<blobs.Capability>
  let vaultProfile: blobs.EncodedBlob<blobs.Profile>
  let reverseCapability: blobs.EncodedBlob<blobs.Capability>
  let reverseProfile: blobs.EncodedBlob<blobs.Profile>

  try {
    vaultCapability = validateStoredBlob(payload.vaultCapability, 'Vault capability')
    vaultProfile = validateStoredBlob(payload.vaultProfile, 'Vault profile')
    reverseCapability = validateStoredBlob(payload.reverseCapability, 'Reverse capability')
    reverseProfile = validateStoredBlob(payload.reverseProfile, 'Reverse profile')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid blob payload'
    return json({message}, {status: 400})
  }

  if (!blobs.verify(vaultCapability.decoded)) {
    return json({message: 'Invalid vault capability signature'}, {status: 400})
  }
  if (!blobs.verify(vaultProfile.decoded)) {
    return json({message: 'Invalid vault profile signature'}, {status: 400})
  }
  if (!blobs.verify(reverseCapability.decoded)) {
    return json({message: 'Invalid reverse capability signature'}, {status: 400})
  }
  if (!blobs.verify(reverseProfile.decoded)) {
    return json({message: 'Invalid reverse profile signature'}, {status: 400})
  }

  const sessionKey = vaultCapability.decoded.delegate
  const vaultAccount = vaultCapability.decoded.signer

  if (!blobs.principalEqual(vaultCapability.decoded.delegate, reverseCapability.decoded.signer)) {
    return json({message: 'Coherence mismatch: Session key mismatch in reverse capability'}, {status: 400})
  }
  if (!blobs.principalEqual(vaultCapability.decoded.signer, reverseCapability.decoded.delegate)) {
    return json({message: 'Coherence mismatch: Vault account mismatch in reverse capability'}, {status: 400})
  }
  if (!reverseProfile.decoded.alias || !blobs.principalEqual(reverseProfile.decoded.alias, vaultAccount)) {
    return json({message: 'Coherence mismatch: Reverse profile alias must be vault account'}, {status: 400})
  }
  if (!blobs.principalEqual(reverseProfile.decoded.signer, sessionKey)) {
    return json({message: 'Coherence mismatch: Reverse profile must be signed by session key'}, {status: 400})
  }

  const profileOwner = vaultProfile.decoded.account || vaultProfile.decoded.signer
  if (!blobs.principalEqual(profileOwner, vaultAccount)) {
    return json({message: 'Coherence mismatch: Vault profile owner mismatch'}, {status: 400})
  }

  // Store blobs sequentially to avoid indexer race conditions.
  await storeBlob(vaultCapability)
  await storeBlob(vaultProfile)
  await storeBlob(reverseCapability)
  await storeBlob(reverseProfile)

  return json(
    {
      message: 'Success',
    } satisfies UploadDelegationResponse,
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    },
  )
}

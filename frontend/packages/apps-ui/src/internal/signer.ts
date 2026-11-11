import * as blobs from '@shm/shared/blobs'
import type {SeedAgentsSigner} from '../host'

/** The `blobs.Signer` the agents code signs with, backed by the host's signer. */
export function toBlobsSigner(signer: SeedAgentsSigner): blobs.Signer {
  return {
    principal: blobs.principalFromString(signer.signerUid ?? signer.accountUid),
    sign: (data: Uint8Array) => signer.sign(data),
  }
}

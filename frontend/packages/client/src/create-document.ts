import {createChange, createChangeOps, createHomeGenesisChange, type DocumentOperation} from './change'
import type {HMPublishBlobsInput} from './hm-types'
import {createVersionRef} from './ref'
import type {AnySigner} from './signer'
import {signerPublicKey} from './signing'
import {base58btc} from 'multiformats/bases/base58'

export type CreateDocumentBlobsInput = {
  /** Account UID the document lives in. */
  space: string
  /** Entity path ('' for the account's home document, '/a/b' otherwise). */
  path: string
  /** The first content change. */
  ops: DocumentOperation[]
  /** Capability CID, when the signer writes into someone else's space. */
  capability?: string
  /** Generation of the Ref; defaults to the first change's timestamp, as the daemon does. */
  generation?: number
  visibility?: string
}

export type CreateDocumentBlobs = {
  /** Blobs to publish, in dependency order. */
  blobs: HMPublishBlobsInput['blobs']
  genesis: string
  version: string
  ts: bigint
}

/**
 * The blobs that bring a brand-new document into existence, built the way the daemon builds
 * them:
 *
 *   - A non-home document has no genesis blob of its own. Its first content Change is its
 *     genesis: no `genesis`/`deps` on the Change, and the Ref's genesis and head are both that
 *     Change (the daemon's docmodel.Ref does the same for its first Ref).
 *   - The account's HOME document (path '') gets the deterministic genesis
 *     ({@link createHomeGenesisChange}), then the content Change on top of it, then the Ref.
 *     The daemon's ensureProfileGenesis mints that same genesis, and only when the path is
 *     empty AND the space is the signer's own account: a home can only be created by its
 *     owner, so any other signer asking for path '' is refused here as well.
 *
 * Every document one account created through the deterministic genesis used to share one
 * identity (sixty papers, one comment thread, 2026-09-15); keep this the single place that
 * decides which genesis a new document gets.
 */
export async function createDocumentBlobs(
  signer: AnySigner,
  input: CreateDocumentBlobsInput,
): Promise<CreateDocumentBlobs> {
  const isHome = input.path === ''
  const toBlob = (block: {bytes: Uint8Array; cid: {toString(): string}}) => ({
    data: block.bytes,
    cid: block.cid.toString(),
  })

  if (isHome) {
    const signerAccount = base58btc.encode(new Uint8Array(await signerPublicKey(signer)))
    if (signerAccount !== input.space) {
      throw new Error(
        `A home document can only be created by its own account: signer ${signerAccount} cannot create the home of ${input.space}`,
      )
    }
    const genesis = await createHomeGenesisChange(signer)
    const {unsignedBytes, ts} = createChangeOps({
      ops: input.ops,
      genesisCid: genesis.cid,
      deps: [genesis.cid],
      depth: 1,
    })
    const change = await createChange(unsignedBytes, signer)
    const ref = await createVersionRef(
      {
        space: input.space,
        path: '',
        genesis: genesis.cid.toString(),
        version: change.cid.toString(),
        generation: input.generation ?? Number(ts),
        capability: input.capability,
        visibility: input.visibility,
      },
      signer,
    )
    return {
      blobs: [toBlob(genesis), toBlob(change), ...ref.blobs],
      genesis: genesis.cid.toString(),
      version: change.cid.toString(),
      ts,
    }
  }

  const {unsignedBytes, ts} = createChangeOps({ops: input.ops})
  const change = await createChange(unsignedBytes, signer)
  const ref = await createVersionRef(
    {
      space: input.space,
      path: input.path,
      genesis: change.cid.toString(),
      version: change.cid.toString(),
      generation: input.generation ?? Number(ts),
      capability: input.capability,
      visibility: input.visibility,
    },
    signer,
  )
  return {
    blobs: [toBlob(change), ...ref.blobs],
    genesis: change.cid.toString(),
    version: change.cid.toString(),
    ts,
  }
}

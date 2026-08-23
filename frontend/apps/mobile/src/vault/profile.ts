/**
 * Client-side profile editing for the identity home document — no daemon key
 * required, everything is built and signed locally with the vault identity.
 *
 * Two paths (mirroring frontend/apps/cli/src/commands/document.ts `update`):
 * - The home document already exists: resolve its change DAG state
 *   (resolveDocumentState), append a SetAttributes change with the current
 *   heads as deps and depth = headDepth + 1, and publish change + version ref
 *   (+ any icon blobs) in ONE client.publish call.
 * - No home document yet: fall back to the fresh client-side genesis path
 *   (publishDocument via publishAsIdentity, all-setMetadata changes), with the
 *   icon blobs published alongside.
 *
 * Icons are chunked into IPFS blobs fully client-side (fileToIpfsBlobs) and
 * referenced as `ipfs://<cid>`; the server serves them back via
 * `{server}/hm/api/image/{cid}`.
 */

import {CID} from 'multiformats/cid'
import type {SeedClient} from '@seed-hypermedia/client/client'
import {createChange, createChangeOps, type DocumentOperation} from '@seed-hypermedia/client/change'
import {resolveDocumentState} from '@seed-hypermedia/client/document-state'
import {SeedClientError} from '@seed-hypermedia/client/errors'
import type {CollectedBlob} from '@seed-hypermedia/client/file-to-ipfs'
import {createVersionRef} from '@seed-hypermedia/client/ref'
import {getIdentitySigner, publishAsIdentity} from './signing'

export type UpdateProfileInput = {
  /** New display name for the profile. */
  name?: string
  /** Raw image bytes to upload as the profile icon. */
  iconBytes?: Uint8Array
}

export type UpdateProfileResult = {
  /** The `ipfs://<cid>` icon URL, when an icon was uploaded. */
  icon?: string
}

/**
 * Update the metadata (name and/or icon) of an identity's home document,
 * signed by the vault identity.
 */
export async function updateProfile(
  client: SeedClient,
  accountId: string,
  input: UpdateProfileInput,
): Promise<UpdateProfileResult> {
  if (input.name === undefined && !input.iconBytes) {
    throw new Error('No profile changes specified.')
  }

  let iconValue: string | undefined
  let iconBlobs: CollectedBlob[] = []
  if (input.iconBytes) {
    // Lazy require (storage.ts / IconPicker pattern): Metro bundles it
    // statically but only executes it when an icon is actually uploaded, and
    // jest never resolves the ESM-only UnixFS chunking deps (blockstore-core,
    // ipfs-unixfs-importer) unless a test calls this path. A dynamic import()
    // does NOT work here: Metro's async bundle split mangles the aliased
    // @seed-hypermedia/client path at runtime.
    const {fileToIpfsBlobs} =
      require('@seed-hypermedia/client/file-to-ipfs') as typeof import('@seed-hypermedia/client/file-to-ipfs')
    const {cid, blobs} = await fileToIpfsBlobs(input.iconBytes)
    iconValue = `ipfs://${cid}`
    iconBlobs = blobs
  }

  const state = await resolveExistingHomeDocState(client, accountId)
  if (!state) {
    // Fresh identity — the home document is built fully client-side by
    // publishDocument (genesis + all-setMetadata change + version ref).
    // publishDocument cannot carry extra blobs, so the icon blobs go up first.
    if (iconBlobs.length > 0) {
      await client.publish({blobs: iconBlobs.map((blob) => ({data: blob.data, cid: blob.cid}))})
    }
    await publishAsIdentity(client, accountId, {
      account: accountId,
      changes: [
        ...(input.name !== undefined
          ? [{op: {case: 'setMetadata' as const, value: {key: 'name', value: input.name}}}]
          : []),
        ...(iconValue ? [{op: {case: 'setMetadata' as const, value: {key: 'icon', value: iconValue}}}] : []),
      ],
    })
    return iconValue ? {icon: iconValue} : {}
  }

  // Existing home document — append a change on top of the current heads.
  const attrs: Array<{key: string[]; value: string}> = []
  if (input.name !== undefined) attrs.push({key: ['name'], value: input.name})
  if (iconValue) attrs.push({key: ['icon'], value: iconValue})
  const ops: DocumentOperation[] = [{type: 'SetAttributes', attrs}]

  const genesisCid = CID.parse(state.genesis)
  const depCids = state.heads.map((head) => CID.parse(head))
  const depth = state.headDepth + 1

  const signer = await getIdentitySigner(accountId)
  const {unsignedBytes, ts} = createChangeOps({ops, genesisCid, deps: depCids, depth})
  const changeBlock = await createChange(unsignedBytes, signer)
  const refInput = await createVersionRef(
    {
      space: accountId,
      path: '',
      genesis: state.genesis,
      version: changeBlock.cid.toString(),
      generation: Number(ts),
    },
    signer,
  )

  await client.publish({
    blobs: [
      {data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()},
      ...refInput.blobs,
      ...iconBlobs.map((blob) => ({data: blob.data, cid: blob.cid})),
    ],
  })

  return iconValue ? {icon: iconValue} : {}
}

/**
 * Resolve the home document's change DAG state, or null when the document
 * does not exist yet. Any other failure (network, server) is rethrown so a
 * transient error can never fork an existing document with a fresh genesis.
 *
 * Not-found detection covers both surfaces of a missing document:
 * - resolveDocumentState's own "No changes found" error;
 * - a SeedClientError carrying the daemon's gRPC NotFound. The web API
 *   server's catch-all wraps it as HTTP 500 (api-server.ts), so the status
 *   alone is not enough — match the `[not_found]` code marker and the
 *   daemon's not-found message shapes (documents.go) in message and body.
 */
async function resolveExistingHomeDocState(client: SeedClient, accountId: string) {
  try {
    return await resolveDocumentState(client, `hm://${accountId}`)
  } catch (error) {
    if (error instanceof SeedClientError) {
      if (error.status === 404) return null
      const text = `${error.message} ${error.body ?? ''}`
      if (/\[not_found\]|is not found|document not found/i.test(text)) return null
    }
    if (error instanceof Error && /No changes found/i.test(error.message)) return null
    throw error
  }
}

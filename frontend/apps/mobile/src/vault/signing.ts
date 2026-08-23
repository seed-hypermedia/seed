/**
 * Publishing helpers that wire vault identities into SeedClient.publishDocument.
 *
 * A fresh identity's profile home doc (all-setMetadata changes, no
 * genesis/baseVersion/path) is built fully client-side by publishDocument —
 * genesis + change + version ref signed with the identity's key.
 */

import type {SeedClient, PublishDocumentInput} from '@seed-hypermedia/client/client'
import type {HMSigner} from '@seed-hypermedia/client/signer'
import {getVaultManager} from './store'

/** Resolve the signer for a vault identity (throws when unknown). */
export async function getIdentitySigner(accountId: string): Promise<HMSigner> {
  const manager = await getVaultManager()
  return manager.getSigner(accountId)
}

/** Publish a document signed by the given vault identity. */
export async function publishAsIdentity(
  client: SeedClient,
  accountId: string,
  input: PublishDocumentInput,
): Promise<void> {
  const signer = await getIdentitySigner(accountId)
  await client.publishDocument(input, signer)
}

/** Publish the profile home document for an identity (client-side genesis path). */
export async function publishProfile(client: SeedClient, accountId: string, displayName: string): Promise<void> {
  await publishAsIdentity(client, accountId, {
    account: accountId,
    changes: [{op: {case: 'setMetadata', value: {key: 'name', value: displayName}}}],
  })
}

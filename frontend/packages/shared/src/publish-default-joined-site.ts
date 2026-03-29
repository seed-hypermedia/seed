import {createContact} from '@seed-hypermedia/client'
import type {HMPublishBlobsInput, HMSigner} from '@seed-hypermedia/client/hm-types'

type PublishDefaultJoinedSiteInput = {
  accountUid: string
}

type PublishDefaultJoinedSiteClient = {
  getSigner: (accountUid: string) => Promise<HMSigner> | HMSigner
  publish: (input: HMPublishBlobsInput) => Promise<unknown>
}

/** The site that brand new accounts automatically join right after creation. */
export const defaultJoinedSiteUid = 'z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS'

/**
 * Publishes the default site-subscription contact for a newly created account.
 *
 * This helper must stay side-effect-free and free of UI/cache imports because it
 * is shared by both the web app and Vault. Vault ships this code into a browser
 * bundle, and pulling in broader shared modules from here can drag runtime-
 * specific side effects like `process.env` reads into that bundle.
 *
 * Returns `true` when the contact publish succeeds. Failures are logged and
 * reported as `false` so platform-specific wrappers can preserve their own
 * success-only side effects without reintroducing cross-runtime coupling here.
 */
export async function publishDefaultJoinedSite(
  input: PublishDefaultJoinedSiteInput,
  client: PublishDefaultJoinedSiteClient,
): Promise<boolean> {
  try {
    const signer = await client.getSigner(input.accountUid)
    const contact = await createContact(
      {
        subjectUid: defaultJoinedSiteUid,
        accountUid: input.accountUid,
        subscribe: {site: true},
      },
      signer,
    )
    await client.publish(contact)
    return true
  } catch (error) {
    console.error('Failed to publish default joined site contact', error)
    return false
  }
}

import {createContact} from '@seed-hypermedia/client'
import type {HMPublishBlobsInput, HMSigner} from '@seed-hypermedia/client/hm-types'
import {invalidateQueries} from './models/query-client'
import {queryKeys} from './models/query-keys'

type PostAccountCreateActionInput = {
  accountUid: string
}

type PostAccountCreateActionClient = {
  getSigner: (accountUid: string) => Promise<HMSigner> | HMSigner
  publish: (input: HMPublishBlobsInput) => Promise<unknown>
}

/** The site that new accounts automatically join right after creation. */
export const defaultJoinedSiteUid = 'z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS'

/**
 * Runs client-side follow-up work after a brand new account has been created.
 */
export async function postAccountCreateAction(
  input: PostAccountCreateActionInput,
  client: PostAccountCreateActionClient,
): Promise<void> {
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

    invalidateQueries([queryKeys.CONTACTS_ACCOUNT, input.accountUid])
    invalidateQueries([queryKeys.CONTACTS_SUBJECT, defaultJoinedSiteUid])
  } catch (error) {
    console.error('Failed to run postAccountCreateAction', error)
  }
}

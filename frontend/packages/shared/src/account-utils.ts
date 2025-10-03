import {toPlainMessage} from '@bufbuild/protobuf'
import {GRPCClient} from './grpc-client'
import {HMMetadata} from './hm-types'
import {unpackHmId} from './utils'

export type HMContactItem = {
  id: ReturnType<typeof unpackHmId>
  metadata?: HMMetadata
}

/**
 * Resolves an account ID to a contact item with metadata
 * Handles alias resolution recursively
 * First checks contacts to get custom names, then fetches the account document
 *
 * Contacts only provide a custom `name` override for the account's metadata.
 * The account's own metadata is always fetched from the document.
 */
export async function resolveAccount(
  grpcClient: GRPCClient,
  accountId: string,
  currentAccount: string,
  maxDepth: number = 10,
): Promise<HMContactItem> {
  if (maxDepth === 0) {
    throw new Error(`Max alias resolution depth reached: ${accountId}`)
  }

  // Fetch the account document to get metadata and check for alias
  const grpcAccount = await grpcClient.documents.getAccount({
    id: accountId,
  })

  // Check if it's an alias account - if so, recursively resolve
  if (grpcAccount.aliasAccount) {
    return resolveAccount(
      grpcClient,
      grpcAccount.aliasAccount,
      currentAccount,
      maxDepth - 1,
    )
  }

  // Get the account's metadata
  const metadata = grpcAccount.metadata?.toJson({emitDefaultValues: true}) as
    | HMMetadata
    | undefined

  // Check if current user has a contact for this account
  const contactsResponse = currentAccount
    ? await grpcClient.documents.listContacts({
        filter: {
          case: 'account',
          value: currentAccount,
        },
      })
    : null

  const contact = contactsResponse?.contacts.find(
    (c) => toPlainMessage(c).subject === accountId,
  )

  // If there's a contact, override the name in metadata
  if (contact) {
    const plainContact = toPlainMessage(contact)
    return {
      id: unpackHmId(accountId)!,
      metadata: {
        ...(metadata || {}),
        name: plainContact.name,
      },
    }
  }

  // Return the account with its original metadata
  return {
    id: unpackHmId(accountId)!,
    metadata,
  }
}

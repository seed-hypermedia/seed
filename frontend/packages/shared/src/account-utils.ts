import {toPlainMessage} from '@bufbuild/protobuf'
import {GRPCClient} from './grpc-client'
import {HMContactItem, HMMetadata} from './hm-types'
import {hmId} from './utils'
import {abbreviateUid} from './utils/abbreviate'

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
  currentAccount?: string,
  maxDepth: number = 10,
): Promise<HMContactItem> {
  if (maxDepth === 0) {
    throw new Error(`Max alias resolution depth reached: ${accountId}`)
  }

  // Fetch the account document to get metadata and check for alias
  let grpcAccount
  try {
    grpcAccount = await grpcClient.documents.getAccount({
      id: accountId,
    })
  } catch (error) {
    // If account is not found, return minimal contact item with just the ID
    // This can happen for web-created accounts that haven't synced yet
    const id = hmId(accountId)
    return {
      id,
      metadata: {
        name: abbreviateUid(accountId),
      },
    }
  }

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

  const id = hmId(accountId)
  // If there's a contact, override the name in metadata
  if (contact) {
    const plainContact = toPlainMessage(contact)

    return {
      id,
      metadata: {
        ...(metadata || {}),
        name: plainContact.name,
      },
    }
  }

  // Return the account with its original metadata
  return {
    id,
    metadata,
  }
}

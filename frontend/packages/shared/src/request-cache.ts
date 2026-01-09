/**
 * Request-scoped cache for deduplicating gRPC calls within a single ListEvents request.
 *
 * This cache stores Promises (not resolved values) to handle race conditions correctly.
 * When two events reference the same resource concurrently, they share the same
 * in-flight Promise, ensuring only one gRPC call is made.
 */

import {toPlainMessage} from '@bufbuild/protobuf'
import {Comment, Document} from './client'
import {GRPCClient} from './grpc-client'
import {HMContactItem, HMMetadata} from './hm-types'
import {hmId} from './utils'
import {abbreviateUid} from './utils/abbreviate'

export type RequestCache = {
  /**
   * Get or resolve an account. Caches by uid:currentAccount key since
   * contact name may differ based on currentAccount's contacts.
   */
  getAccount: (uid: string, currentAccount?: string) => Promise<HMContactItem>

  /**
   * Get or fetch a document. Caches by account:path:version key.
   */
  getDocument: (params: {
    account?: string
    path?: string
    version?: string
  }) => Promise<Document>

  /**
   * Get or fetch a comment. Caches by comment ID.
   */
  getComment: (id: string) => Promise<Comment>

  /**
   * Get or fetch comment reply count. Caches by comment ID.
   */
  getCommentReplyCount: (id: string) => Promise<number>

  /**
   * Get or fetch contacts for an account. Caches by account UID.
   */
  getContacts: (
    accountUid: string,
  ) => Promise<{subject: string; name: string}[]>
}

/**
 * Creates a request-scoped cache for deduplicating resource fetches.
 *
 * Usage:
 * ```typescript
 * const cache = createRequestCache(grpcClient)
 * // All calls with same parameters share the same Promise
 * const [account1, account2] = await Promise.all([
 *   cache.getAccount('xyz'),
 *   cache.getAccount('xyz'), // Same Promise, no duplicate gRPC call
 * ])
 * ```
 */
export function createRequestCache(grpcClient: GRPCClient): RequestCache {
  // Store Promises to handle concurrent access correctly
  const accounts = new Map<string, Promise<HMContactItem>>()
  const documents = new Map<string, Promise<Document>>()
  const comments = new Map<string, Promise<Comment>>()
  const replyCounts = new Map<string, Promise<number>>()
  const contacts = new Map<string, Promise<{subject: string; name: string}[]>>()

  return {
    getAccount(uid: string, currentAccount?: string) {
      // Key includes currentAccount because contact name may differ
      const key = `${uid}:${currentAccount || ''}`
      if (!accounts.has(key)) {
        accounts.set(
          key,
          resolveAccountWithCache(grpcClient, uid, currentAccount, this),
        )
      }
      return accounts.get(key)!
    },

    getDocument(params) {
      const key = `${params.account || ''}:${params.path || ''}:${
        params.version || ''
      }`
      if (!documents.has(key)) {
        documents.set(
          key,
          grpcClient.documents.getDocument({
            account: params.account,
            path: params.path,
            version: params.version,
          }),
        )
      }
      return documents.get(key)!
    },

    getComment(id: string) {
      if (!comments.has(id)) {
        comments.set(id, grpcClient.comments.getComment({id}))
      }
      return comments.get(id)!
    },

    getCommentReplyCount(id: string) {
      if (!replyCounts.has(id)) {
        replyCounts.set(
          id,
          grpcClient.comments
            .getCommentReplyCount({id})
            .then((r) => Number(r.replyCount)),
        )
      }
      return replyCounts.get(id)!
    },

    getContacts(accountUid: string) {
      if (!contacts.has(accountUid)) {
        contacts.set(
          accountUid,
          grpcClient.documents
            .listContacts({
              filter: {
                case: 'account',
                value: accountUid,
              },
            })
            .then((r) =>
              r.contacts.map((c) => {
                const plain = toPlainMessage(c)
                return {subject: plain.subject, name: plain.name}
              }),
            ),
        )
      }
      return contacts.get(accountUid)!
    },
  }
}

/**
 * Resolves an account ID to a contact item with metadata.
 * Uses the cache for contacts lookup to avoid duplicate listContacts calls.
 *
 * This is a cache-aware version of resolveAccount from account-utils.ts
 */
async function resolveAccountWithCache(
  grpcClient: GRPCClient,
  accountId: string,
  currentAccount: string | undefined,
  cache: RequestCache,
  maxDepth: number = 10,
): Promise<HMContactItem> {
  if (maxDepth === 0) {
    throw new Error(`Max alias resolution depth reached: ${accountId}`)
  }

  // Fetch the account document to get metadata and check for alias
  let grpcAccount
  try {
    grpcAccount = await grpcClient.documents.getAccount({id: accountId})
  } catch (error) {
    // If account is not found, return minimal contact item with just the ID
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
    return cache.getAccount(grpcAccount.aliasAccount, currentAccount)
  }

  // Get the account's metadata
  const metadata = grpcAccount.metadata?.toJson({
    emitDefaultValues: true,
    enumAsInteger: false,
  }) as HMMetadata | undefined

  // Check if current user has a contact for this account (using cache)
  const contactsList = currentAccount
    ? await cache.getContacts(currentAccount)
    : null

  const contact = contactsList?.find((c) => c.subject === accountId)

  const id = hmId(accountId)
  // If there's a contact, override the name in metadata
  if (contact) {
    return {
      id,
      metadata: {
        ...(metadata || {}),
        name: contact.name,
      },
    }
  }

  // Return the account with its original metadata
  return {
    id,
    metadata,
  }
}

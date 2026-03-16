/**
 * Derived Subscriptions
 *
 * Manages subscriptions automatically based on local keys and their contacts.
 * Subscriptions are "derived" from:
 * 1. All local keys (always subscribed)
 * 2. Contacts with subscribe.site === true (joined sites)
 * 3. Contacts with subscribe.profile === true (followed profiles)
 * 4. Legacy contacts with no subscribe field (implicit profile subscription)
 *
 * Updates are triggered by:
 * - Query invalidation (when user follows/unfollows via UI)
 * - Periodic polling (to catch contacts synced from network)
 */

// How often to poll for contacts synced from network (in ms)
const SYNC_POLL_INTERVAL_MS = 30_000 // 30 seconds

import {toPlainMessage} from '@bufbuild/protobuf'
import {grpcClient} from './app-grpc'
import {BIG_INT} from '@shm/shared/constants'
import {onQueryInvalidation} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import * as logger from './logger'

// Types for contact subscription handling
interface ContactSubscribe {
  site?: boolean
  profile?: boolean
}

interface ParsedContact {
  id: string
  subject: string
  subscribe?: ContactSubscribe
}

/**
 * Fetches contacts for a given account from the gRPC service.
 */
async function fetchContactsForAccount(accountUid: string): Promise<ParsedContact[]> {
  const response = await grpcClient.documents.listContacts({
    filter: {
      case: 'account',
      value: accountUid,
    },
  })

  return response.contacts.map((c) => {
    const plain = toPlainMessage(c)
    // subscribe field is stored in metadata Struct
    const metadata = c.metadata?.toJson() as Record<string, unknown> | undefined
    const subscribe = metadata?.subscribe as ContactSubscribe | undefined
    return {
      id: plain.id,
      subject: plain.subject,
      subscribe,
    }
  })
}

/**
 * Determines if a contact should trigger a subscription to its subject.
 * Returns true if the contact has site or profile subscription, or is a legacy contact.
 */
function shouldSubscribeToContact(contact: ParsedContact): boolean {
  // Explicit site subscription
  if (contact.subscribe?.site) return true
  // Explicit profile subscription
  if (contact.subscribe?.profile) return true
  // Legacy contact (no subscribe field = implicit profile subscription)
  if (!contact.subscribe || (!contact.subscribe.site && !contact.subscribe.profile)) return true
  return false
}

/**
 * Computes the set of account IDs that should have active subscriptions.
 * This includes all local keys and all contacts with site/profile subscriptions.
 */
async function computeDesiredSubscriptions(): Promise<Set<string>> {
  const desired = new Set<string>()

  // Add all local keys
  const keys = await grpcClient.daemon.listKeys({})
  for (const key of keys.keys) {
    desired.add(key.accountId)
  }

  // For each local key, add contacts with subscriptions
  for (const key of keys.keys) {
    try {
      const contacts = await fetchContactsForAccount(key.accountId)
      for (const contact of contacts) {
        if (shouldSubscribeToContact(contact)) {
          desired.add(contact.subject)
        }
      }
    } catch (e) {
      logger.error(`Failed to fetch contacts for ${key.accountId}: ${(e as Error).message}`)
    }
  }

  return desired
}

/**
 * Gets the current set of root-level recursive subscriptions.
 */
async function getCurrentSubscriptions(): Promise<Set<string>> {
  const subs = await grpcClient.subscriptions.listSubscriptions({
    pageSize: BIG_INT,
  })

  const current = new Set<string>()
  for (const sub of subs.subscriptions) {
    // Only consider root-level recursive subscriptions
    if (sub.path === '' && sub.recursive) {
      current.add(sub.account)
    }
  }
  return current
}

/**
 * Synchronizes subscriptions to match the derived set.
 * Subscribes to new accounts and unsubscribes from accounts no longer needed.
 */
async function syncDerivedSubscriptions() {
  logger.info('SyncDerivedSubscriptions')
  const desired = await computeDesiredSubscriptions()
  const current = await getCurrentSubscriptions()

  // Subscribe to new accounts
  for (const account of Array.from(desired)) {
    if (!current.has(account)) {
      logger.debug(`DerivedSubscriptions: subscribing to ${account}`)
      await grpcClient.subscriptions.subscribe({
        account,
        recursive: true,
        path: '',
      })
    }
  }

  // Unsubscribe from accounts no longer needed
  for (const account of Array.from(current)) {
    if (!desired.has(account)) {
      logger.debug(`DerivedSubscriptions: unsubscribing from ${account}`)
      await grpcClient.subscriptions.unsubscribe({
        account,
        path: '',
      })
    }
  }

  logger.info(`SyncDerivedSubscriptions complete: ${desired.size} desired, ${current.size} current`)
}

// Debounce timer for subscription sync
let syncSubscriptionsTimeout: NodeJS.Timeout | null = null

/**
 * Debounced version of syncDerivedSubscriptions to avoid thrashing
 * when multiple query invalidations occur in quick succession.
 */
function debouncedSyncSubscriptions() {
  if (syncSubscriptionsTimeout) clearTimeout(syncSubscriptionsTimeout)
  syncSubscriptionsTimeout = setTimeout(() => {
    syncDerivedSubscriptions().catch((e) => {
      logger.error('DerivedSubscriptionsError: ' + (e as Error).message)
    })
  }, 500) // 500ms debounce
}

// Polling interval reference
let pollIntervalId: NodeJS.Timeout | null = null

/**
 * Initializes the derived subscriptions system.
 * Computes initial subscriptions and sets up listeners for changes.
 */
export async function initDerivedSubscriptions() {
  logger.info('InitDerivedSubscriptions')

  // 1. Compute and sync initial subscriptions
  await syncDerivedSubscriptions()

  // 2. Subscribe to query invalidations to react to UI-driven changes
  onQueryInvalidation((queryKey) => {
    if (
      queryKey[0] === queryKeys.LOCAL_ACCOUNT_ID_LIST ||
      queryKey[0] === queryKeys.CONTACTS_ACCOUNT
    ) {
      logger.debug(`DerivedSubscriptions: query invalidated ${queryKey[0]}`)
      debouncedSyncSubscriptions()
    }
  })

  // 3. Poll periodically to catch contacts synced from network
  // (Network-synced contacts don't trigger query invalidation)
  pollIntervalId = setInterval(() => {
    logger.debug('DerivedSubscriptions: periodic poll')
    debouncedSyncSubscriptions()
  }, SYNC_POLL_INTERVAL_MS)
}

/**
 * Stops the derived subscriptions system.
 * Call this when the app is shutting down.
 */
export function stopDerivedSubscriptions() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId)
    pollIntervalId = null
  }
  if (syncSubscriptionsTimeout) {
    clearTimeout(syncSubscriptionsTimeout)
    syncSubscriptionsTimeout = null
  }
}

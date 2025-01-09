// this file exists so you know what may need to be invalidated from the cache when you make changes.

import {abbreviateCid} from '@shm/shared'
import {QueryKey} from '@tanstack/react-query'

export const queryKeys = {
  // Organized by the model file that is responsible for querying + mutating the keys

  // NOTE: Arguments to query keys documented in comments

  SITE_LIBRARY: 'SITE_LIBRARY', // siteUid: string

  // feed
  FEED: 'FEED', // trustedOnly: boolean
  FEED_LATEST_EVENT: 'FEED_LATEST_EVENT', // trustedOnly: boolean
  RESOURCE_FEED: 'RESOURCE_FEED', //, resourceId: string
  RESOURCE_FEED_LATEST_EVENT: 'RESOURCE_FEED_LATEST_EVENT', //, resourceId: string

  // daemon
  GET_DAEMON_INFO: 'GET_DAEMON_INFO',
  LOCAL_ACCOUNT_ID_LIST: 'LOCAL_ACCOUNT_ID_LIST',
  KEYS_GET: 'KEYS_GET',
  GENERATE_MNEMONIC: 'GENERATE_MNEMONIC',
  SAVED_MNEMONICS: 'SAVED_MNEMONICS',

  // networking
  PEERS: 'PEERS', // , filterConnected: boolean
  GET_PEER_INFO: 'GET_PEER_INFO', // , deviceId: string

  // accounts
  LIST_ACCOUNTS: 'LIST_ACCOUNTS', //
  ACCOUNT: 'ACCOUNT', // , accountId: string

  // entities
  ENTITY_TIMELINE: 'ENTITY_TIMELINE', //, entityId: string, includeDrafts: boolean

  // documents
  ACCOUNT_DOCUMENTS: 'ACCOUNT_DOCUMENTS', //, accountId: string
  DOC_LIST_DIRECTORY: 'DOC_LIST_DIRECTORY', // accountUid: string
  DRAFT: 'DRAFT', // , id: string
  LIST_ROOT_DOCUMENTS: 'LIST_ROOT_DOCUMENTS', //

  ENTITY: 'ENTITY',
  ENTITY_CHANGES: 'ENTITY_CHANGES',

  CAPABILITIES: 'CAPABILITIES', //, id.uid: string, ...id.path

  // comments
  COMMENT: 'COMMENT', //, commentId: string
  DOCUMENT_COMMENTS: 'DOCUMENT_COMMENTS', //, docUid: string

  // content-graph
  ENTITY_CITATIONS: 'ENTITY_CITATIONS', //, entityId: string

  // web-links
  GET_URL: 'GET_URL',

  // changes
  CHANGE: 'CHANGE', //, changeId: string

  // cid
  BLOB_DATA: 'BLOB_DATA', //, cid: string

  // lightning
  LIGHTNING_ACCOUNT_CHECK: 'LIGHTNING_ACCOUNT_CHECK', //, accountId: string

  // search
  SEARCH: 'SEARCH', //, query: string

  // deleted content
  DELETED: 'deleted',

  // subscriptions
  SUBSCRIPTIONS: 'SUBSCRIPTIONS',

  // payments
  WALLETS: 'WALLETS', //, walletId: string
  ACCOUNT_WALLETS: 'ACCOUNT_WALLETS', //, accountId: string
  INVOICES: 'INVOICES', //, walletId: string
  CURRENCY_COMPARISONS: 'CURRENCY_COMPARISONS',
  PAYMENT_RECIPIENTS: 'PAYMENT_RECIPIENTS', // string: "accountUid,accountUid"
  INVOICE_STATUS: 'INVOICE_STATUS', // invoiceId: string
} as const

export function labelOfQueryKey(key: QueryKey) {
  const discriminator = key[0]
  const arg1 = key[1] as string | undefined
  switch (discriminator) {
    // feed
    case queryKeys.FEED:
      return 'Activity Feed'
    case queryKeys.FEED_LATEST_EVENT:
      return 'Activity Feed Latest Event'

    // daemon
    case queryKeys.GET_DAEMON_INFO:
      return 'Daemon Info'

    // networking
    case queryKeys.PEERS:
      return 'Peers'
    case queryKeys.GET_PEER_INFO:
      return `Peer ${abbreviateCid(arg1)}`

    // accounts
    case queryKeys.LIST_ACCOUNTS:
      return 'All Accounts'
    case queryKeys.ACCOUNT:
      return `Account ${abbreviateCid(arg1)}`

    // entities
    case queryKeys.ENTITY_TIMELINE:
      return 'Entity Timeline'

    // documents
    case queryKeys.ACCOUNT_DOCUMENTS:
      return 'Account Publications'
    case queryKeys.DRAFT:
      return `Editor Draft ${abbreviateCid(arg1)}`
    case queryKeys.ENTITY:
      return `Entity`

    // comments
    case queryKeys.COMMENT:
      return 'Comment'
    case queryKeys.DOCUMENT_COMMENTS:
      return 'Publication Comments'

    // content-graph
    case queryKeys.ENTITY_CITATIONS:
      return `Citations of ${abbreviateCid(arg1)}`

    // web-links
    case queryKeys.GET_URL:
      return `URL ${arg1}`

    // changes
    case queryKeys.CHANGE:
      return 'Change'

    // cid
    case queryKeys.BLOB_DATA:
      return 'Blab Data'

    // lightning
    case queryKeys.LIGHTNING_ACCOUNT_CHECK:
      return 'Lightning Account'

    // search
    case queryKeys.SEARCH:
      return `Search "${arg1}"`

    // payments
    case queryKeys.WALLETS:
      return 'Wallet'
    case queryKeys.ACCOUNT_WALLETS:
      return 'Account Wallets'
    case queryKeys.INVOICES:
      return 'Invoices'
    case queryKeys.CURRENCY_COMPARISONS:
      return 'Currency Comparisons'
    case queryKeys.PAYMENT_RECIPIENTS:
      return 'Payment Recipients'
    case queryKeys.INVOICE_STATUS:
      return 'Invoice Status'

    default:
      // return 'unknown'
      return discriminator
  }
}

export function fullInvalidate(invalidate: (key: QueryKey) => void) {
  Object.keys(queryKeys).forEach((key) => {
    if (key === 'FEED') return // the feed does not need to be invalidated, because GEED_LATEST_EVENT is invalidated and the user will be prompted for new items
    invalidate([key])
  })
}

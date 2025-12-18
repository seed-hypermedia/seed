// this file exists so you know what may need to be invalidated from the cache when you make changes.

import {QueryKey} from '@tanstack/react-query'
import {abbreviateCid} from '../utils'

export const queryKeys = {
  // Organized by the model file that is responsible for querying + mutating the keys

  // NOTE: Arguments to query keys documented in comments

  LIBRARY: 'LIBRARY',
  SITE_LIBRARY: 'SITE_LIBRARY', // siteUid: string

  // feed
  FEED: 'FEED', // docId?: boolean

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
  ACCOUNT_DRAFTS: 'ACCOUNT_DRAFTS', // , accountUid: string
  LIST_ROOT_DOCUMENTS: 'LIST_ROOT_DOCUMENTS', //
  DOCUMENT_INTERACTION_SUMMARY: 'DOCUMENT_INTERACTION_SUMMARY', //, docId.id: string

  // entity
  ENTITY: 'ENTITY', // , id.id: string, version: string
  RESOLVED_ENTITY: 'RESOLVED_ENTITY', // , id.id: string, version: string
  ENTITY_CHANGES: 'ENTITY_CHANGES',

  CAPABILITIES: 'CAPABILITIES', //, id.uid: string, ...id.path
  ACCOUNT_CAPABILITIES: 'ACCOUNT_CAPABILITIES', //, accountId: string

  // comments
  COMMENT: 'COMMENT', //, commentId: string

  // web-links
  GET_URL: 'GET_URL',

  // changes
  CHANGE: 'CHANGE', //, changeId: string

  // cid
  BLOB_DATA: 'BLOB_DATA', //, cid: string

  // lightning
  LIGHTNING_ACCOUNT_CHECK: 'LIGHTNING_ACCOUNT_CHECK', //, accountId: string

  // search
  SEARCH: 'SEARCH', //, perspectiveAccountUid: string|null, accountUid: string|null, query: string

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

  // recents
  RECENTS: 'RECENTS',

  // citations
  DOC_CITATIONS: 'DOC_CITATIONS', //, docId: string id.id

  // web stuff is queried differently...
  DOCUMENT_ACTIVITY: 'DOCUMENT_ACTIVITY', //, docId.id: string
  DOCUMENT_DISCUSSION: 'DOCUMENT_DISCUSSION', //, docId.id: string, targetCommentId?: string
  BLOCK_DISCUSSIONS: 'BLOCK_DISCUSSIONS', //, docId.id: string, blockId: string
  COMMENTS_BATCH: 'COMMENTS_BATCH',
  DOCUMENT_COMMENTS: 'DOCUMENT_COMMENTS', //, docId.id: string, targetCommentId?: string

  SETTINGS: 'SETTINGS', // key: string

  // hosting
  HOST_INFO: 'HOST_INFO',
  HOST_ABSORB_SESSION: 'HOST_ABSORB_SESSION', // pendingSessionToken: string

  // contacts
  CONTACTS_ACCOUNT: 'CONTACTS_ACCOUNT', // accountUid: string
  CONTACTS_SUBJECT: 'CONTACTS_SUBJECT', // accountUid: string

  // activity
  ACTIVITY_FEED: 'ACTIVITY_FEED', // pageSize, pageToken, trustedOnly, filterAuthors, filterEventType, filterResource, addLinkedResource

  ROOT_DOCUMENTS: 'ROOT_DOCUMENTS',
  CID: 'CID', // cid: string
  COMMENTS: 'COMMENTS', // id.id: string
  AUTHORED_COMMENTS: 'AUTHORED_COMMENTS', // id.id: string
  CITATIONS: 'CITATIONS', // id.id: string
  CHANGES: 'CHANGES', // id.id: string

  // tRPC-migrated query keys
  EXPERIMENTS: 'EXPERIMENTS',
  FAVORITES: 'FAVORITES',
  HOST_STATE: 'HOST_STATE',
  RECENT_SIGNERS: 'RECENT_SIGNERS',
  COMMENT_DRAFT: 'COMMENT_DRAFT', // targetDocId, replyCommentId, quotingBlockId, context
  COMMENT_DRAFTS_LIST: 'COMMENT_DRAFTS_LIST',
  GATEWAY_URL: 'GATEWAY_URL',
  NOTIFY_SERVICE_HOST: 'NOTIFY_SERVICE_HOST',
  PUSH_ON_COPY: 'PUSH_ON_COPY',
  PUSH_ON_PUBLISH: 'PUSH_ON_PUBLISH',
  AUTO_UPDATE_PREFERENCE: 'AUTO_UPDATE_PREFERENCE',
  SECURE_STORAGE: 'SECURE_STORAGE',
  DRAFTS_LIST: 'DRAFTS_LIST',
  DRAFTS_LIST_ACCOUNT: 'DRAFTS_LIST_ACCOUNT', // accountUid
} as const

export function labelOfQueryKey(key: QueryKey) {
  const discriminator = key[0]
  const arg1 = key[1] as string | undefined
  switch (discriminator) {
    // library
    case queryKeys.LIBRARY:
      return 'Library'
    case queryKeys.SITE_LIBRARY:
      return `Site Library`

    // feed
    case queryKeys.FEED:
      return 'Activity Feed'

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
    case queryKeys.ACCOUNT_DRAFTS:
      return `Account Drafts`
    case queryKeys.ENTITY:
    case queryKeys.RESOLVED_ENTITY:
      return `Entity`
    case queryKeys.ENTITY_CHANGES:
      return `Entity Changes`

    // capabilities
    case queryKeys.CAPABILITIES:
      return `Capabilities`
    case queryKeys.ACCOUNT_CAPABILITIES:
      return `Account Capabilities`

    // comments
    case queryKeys.COMMENT:
      return 'Comment'
    case queryKeys.DOCUMENT_DISCUSSION:
      return 'Document Discussion'

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

    // recents
    case queryKeys.RECENTS:
      return 'Recents'

    // citations
    case queryKeys.DOC_CITATIONS:
      return `Citations`

    // hosting
    case queryKeys.HOST_INFO:
      return 'Host Info'
    case queryKeys.HOST_ABSORB_SESSION:
      return 'Host Establish Session'

    // activity
    case queryKeys.ACTIVITY_FEED:
      return 'Activity Feed'

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

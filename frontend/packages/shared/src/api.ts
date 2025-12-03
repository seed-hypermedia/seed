import {HMRequest} from '.'
import {Account, AccountParams} from './api-account'
import {AccountContacts} from './api-account-contacts'
import {ListEvents} from './api-activity'
import {BatchAccounts} from './api-batch-accounts'
import {
  GetCommentReplyCount,
  ListComments,
  ListCommentsByReference,
  ListDiscussions,
} from './api-comments'
import {Query} from './api-query'
import {Resource, ResourceParams} from './api-resource'
import {ResourceMetadata, ResourceMetadataParams} from './api-resource-metadata'
import {Search} from './api-search'
import {HMRequestImplementation, HMRequestParams} from './api-types'

export const APIRouter = {
  Resource,
  ResourceMetadata,
  Account,
  AccountContacts,
  BatchAccounts,
  Search,
  Query,
  ListComments,
  ListDiscussions,
  ListCommentsByReference,
  GetCommentReplyCount,
  ListEvents,
} as const satisfies {
  [K in HMRequest as K['key']]: HMRequestImplementation<K>
}

export const APIParams: {
  [K in HMRequest['key']]?: HMRequestParams<Extract<HMRequest, {key: K}>>
} = {
  Account: AccountParams,
  Resource: ResourceParams,
  ResourceMetadata: ResourceMetadataParams,
}

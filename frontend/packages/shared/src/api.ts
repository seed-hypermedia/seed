import {HMRequest} from '.'
import {Account, AccountParams} from './api-account'
import {Comment} from './api-comment'
import {AccountContacts} from './api-account-contacts'
import {ListEvents} from './api-activity'
import {BatchAccounts} from './api-batch-accounts'
import {ListCapabilities} from './api-capabilities'
import {ListChanges} from './api-changes'
import {ListCitations} from './api-citations'
import {
  GetCommentReplyCount,
  ListComments,
  ListCommentsByReference,
  ListDiscussions,
} from './api-comments'
import {GetCID} from './api-get-cid'
import {ListAccounts} from './api-list-accounts'
import {ListCommentsByAuthor} from './api-list-comments-by-author'
import {Query} from './api-query'
import {Resource, ResourceParams} from './api-resource'
import {ResourceMetadata, ResourceMetadataParams} from './api-resource-metadata'
import {Search} from './api-search'
import {HMRequestImplementation, HMRequestParams} from './api-types'

export const APIRouter = {
  Resource,
  ResourceMetadata,
  Account,
  Comment,
  AccountContacts,
  BatchAccounts,
  Search,
  Query,
  ListComments,
  ListDiscussions,
  ListCommentsByReference,
  GetCommentReplyCount,
  ListEvents,
  ListAccounts,
  GetCID,
  ListCommentsByAuthor,
  ListCitations,
  ListChanges,
  ListCapabilities,
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

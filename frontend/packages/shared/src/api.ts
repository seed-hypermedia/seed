import {HMRequest} from '.'
import {Account} from './api-account'
import {AccountContacts} from './api-account-contacts'
import {BatchAccounts} from './api-batch-accounts'
import {
  GetCommentReplyCount,
  ListComments,
  ListCommentsByReference,
  ListDiscussions,
} from './api-comments'
import {Query} from './api-query'
import {Resource} from './api-resource'
import {ResourceMetadata} from './api-resource-metadata'
import {Search} from './api-search'
import {HMRequestImplementation} from './api-types'

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
} as const satisfies {
  [K in HMRequest as K['key']]: HMRequestImplementation<K>
}

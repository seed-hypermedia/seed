import {HMAction, HMGetRequest} from '@seed-hypermedia/client/hm-types'
import {Account, AccountParams} from './api-account'
import {AccountContacts} from './api-account-contacts'
import {SubjectContacts} from './api-subject-contacts'
import {ListEvents} from './api-activity'
import {ListCapabilities, ListCapabilitiesParams} from './api-capabilities'
import {ListChanges, ListChangesParams} from './api-changes'
import {ListCitations, ListCitationsParams} from './api-citations'
import {Comment} from './api-comment'
import {GetCommentReplyCount, ListComments, ListCommentsByReference, ListDiscussions} from './api-comments'
import {GetCID} from './api-get-cid'
import {InteractionSummary} from './api-interaction-summary'
import {ListAccounts} from './api-list-accounts'
import {ListCommentsByAuthor} from './api-list-comments-by-author'
import {PrepareDocumentChange} from './api-prepare-document-change'
import {PublishBlobs} from './api-publish-blobs'
import {Query} from './api-query'
import {Resource, ResourceParams} from './api-resource'
import {ResourceMetadata, ResourceMetadataParams} from './api-resource-metadata'
import {Search} from './api-search'
import {HMRequestImplementation, HMRequestParams} from './api-types'

export const APIQueries = {
  Resource,
  ResourceMetadata,
  Account,
  Comment,
  AccountContacts,
  SubjectContacts,
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
  InteractionSummary,
} as const satisfies {
  [K in HMGetRequest['key']]: HMRequestImplementation<Extract<HMGetRequest, {key: K}>>
}

export const APIActions = {
  PublishBlobs,
  PrepareDocumentChange,
} as const satisfies {
  [K in HMAction['key']]: HMRequestImplementation<Extract<HMAction, {key: K}>>
}

// Combined router — kept for backward compatibility (desktop uses this directly)
export const APIRouter = {
  ...APIQueries,
  ...APIActions,
} as const

export const APIParams: {
  [K in HMGetRequest['key']]?: HMRequestParams<Extract<HMGetRequest, {key: K}>>
} = {
  Account: AccountParams,
  Resource: ResourceParams,
  ResourceMetadata: ResourceMetadataParams,
  ListCitations: ListCitationsParams,
  ListChanges: ListChangesParams,
  ListCapabilities: ListCapabilitiesParams,
}

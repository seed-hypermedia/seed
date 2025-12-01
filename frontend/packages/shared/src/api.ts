import {HMRequest} from '.'
import {Account} from './api-account'
import {BatchAccounts} from './api-batch-accounts'
import {Query} from './api-query'
import {Resource} from './api-resource'
import {ResourceMetadata} from './api-resource-metadata'
import {Search} from './api-search'
import {HMRequestImplementation} from './api-types'

export const APIRouter = {
  Resource,
  ResourceMetadata,
  Account,
  BatchAccounts,
  Search,
  Query,
} as const satisfies {
  [K in HMRequest as K['key']]: HMRequestImplementation<K>
}

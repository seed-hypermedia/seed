import {HMRequest} from '.'
import {Account} from './api-account'
import {BatchAccounts} from './api-batch-accounts'
import {Resource} from './api-resource'
import {ResourceMetadata} from './api-resource-metadata'
import {HMRequestImplementation} from './api-types'

export const APIRouter = {
  Resource,
  ResourceMetadata,
  Account,
  BatchAccounts,
} as const satisfies {
  [K in HMRequest as K['key']]: HMRequestImplementation<K>
}

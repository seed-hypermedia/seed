import {HMRequest} from '.'
import {Resource} from './api-resource'
import {ResourceMetadata} from './api-resource-metadata'
import {HMRequestImplementation} from './api-types'

type APIRouterType = {
  [K in HMRequest as K['key']]: HMRequestImplementation<K>
}

export const APIRouter: APIRouterType = {
  Resource,
  ResourceMetadata,
}

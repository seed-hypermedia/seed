export {createSeedClient} from './client'
export type {SeedClient, SeedClientOptions} from './client'
export {SeedClientError, SeedNetworkError, SeedValidationError} from './errors'

// Re-export key types so consumers don't need @shm/shared directly
export type {HMRequest, UnpackedHypermediaId} from '@shm/shared/hm-types'

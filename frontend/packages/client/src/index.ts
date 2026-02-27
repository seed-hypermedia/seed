export {createSeedClient} from './client'
export type {SeedClient, SeedClientOptions} from './client'
export {createComment, deleteComment} from './comment'
export type {CreateCommentInput, DeleteCommentInput, CommentAttachmentBlob} from './comment'
export {SeedClientError, SeedNetworkError, SeedValidationError} from './errors'

// Re-export key types so consumers don't need @shm/shared directly
export type {HMRequest, UnpackedHypermediaId} from '@shm/shared/hm-types'

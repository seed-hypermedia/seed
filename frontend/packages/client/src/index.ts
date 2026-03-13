export {createCapability} from './capability'
export type {CapabilityRole, CreateCapabilityInput} from './capability'
export {
  createChange,
  createChangeOps,
  createDocumentChange,
  createDocumentChangeFromOps,
  createGenesisChange,
  signDocumentChange,
  signPreparedChange,
} from './change'
export type {
  CreateChangeOpsInput,
  CreateDocumentChangeFromOpsInput,
  CreateDocumentChangeInput,
  DocumentOperation,
  SignDocumentChangeInput,
} from './change'
export {createSeedClient} from './client'
export type {PublishDocumentInput, SeedClient, SeedClientOptions} from './client'
export {commentRecordIdFromBlob, createComment, deleteComment} from './comment'
export type {CommentAttachmentBlob, CreateCommentInput, DeleteCommentInput} from './comment'
export {contactRecordIdFromBlob, createContact, deleteContact, updateContact} from './contact'
export type {CreateContactInput, CreateContactResult, DeleteContactInput, UpdateContactInput} from './contact'
export {SeedClientError, SeedNetworkError, SeedValidationError} from './errors'
export {createRedirectRef, createTombstoneRef, createVersionRef} from './ref'
export type {CreateRedirectRefInput, CreateTombstoneRefInput, CreateVersionRefInput} from './ref'

export {trimTrailingEmptyBlocks} from './comment'
export {
  entityQueryPathToHmIdPath,
  getHMQueryString,
  hmIdPathToEntityQueryPath,
  HYPERMEDIA_SCHEME,
  packBaseId,
  packHmId,
  serializeBlockRange,
} from './hm-types'
export type {HMRequest, HMSigner, UnpackedHypermediaId} from './hm-types'

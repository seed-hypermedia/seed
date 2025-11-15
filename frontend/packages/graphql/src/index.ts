/**
 * @shm/graphql - GraphQL client for HM resources
 *
 * Provides urql-based GraphQL client with normalized caching
 * for Hypermedia resources organized by account and path.
 */

// Client
export {
  createGraphQLClient,
  getDefaultGraphQLClient,
  resetDefaultGraphQLClient,
  type GraphQLClientOptions,
} from './client'

// Cache
export {createGraphcacheExchange, graphcacheConfig} from './cache'

// Provider
export {GraphQLProvider, type GraphQLProviderProps} from './provider'

// Hooks
export {useResource, useComments, useHello} from './hooks'
export type {
  GetResourceData,
  GetResourceVariables,
  ListCommentsData,
  ListCommentsVariables,
  HelloData,
} from './hooks'

// Queries
export {
  GET_RESOURCE_QUERY,
  LIST_COMMENTS_QUERY,
  HELLO_QUERY,
  BLOCKS_CONTENT_FRAGMENT,
  PROFILE_FRAGMENT,
  DOCUMENT_FRAGMENT,
  COMMENT_FRAGMENT,
} from './queries'

// Types
export type {
  NormalizedAccount,
  NormalizedProfile,
  NormalizedResourceBase,
  NormalizedDocument,
  NormalizedComment,
  NormalizedResource,
  BlocksContent,
  BlockNode,
  Block,
  BaseBlock,
  ParagraphBlock,
  HeadingBlock,
  CodeBlock,
  MathBlock,
  ImageBlock,
  VideoBlock,
  FileBlock,
  ButtonBlock,
  EmbedBlock,
  WebEmbedBlock,
  NostrBlock,
  Annotation,
  BaseAnnotation,
  LinkAnnotation,
  BoldAnnotation,
  ItalicAnnotation,
  UnderlineAnnotation,
  StrikeAnnotation,
  CodeAnnotation,
} from './types'
export {parseHmIri, buildHmIri} from './types'

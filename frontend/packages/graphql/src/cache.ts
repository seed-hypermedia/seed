/**
 * Graphcache Configuration
 *
 * Configures normalized caching for HM resources with urql graphcache.
 * Cache structure organizes resources by account ID and path.
 */

import {cacheExchange, type CacheExchangeOpts} from '@urql/exchange-graphcache'
import {parseHmIri} from './types'

/**
 * Generate cache key for a resource based on its IRI
 */
function generateResourceKey(iri: string): string | null {
  const parsed = parseHmIri(iri)
  if (!parsed) return null

  // Cache key format: Account:<accountId>:Resource:<path>
  return `Account:${parsed.account}:Resource:${parsed.path}`
}

/**
 * Generate cache key for a profile
 */
function generateProfileKey(accountId: string): string {
  return `Account:${accountId}:Profile`
}

/**
 * Graphcache configuration with normalized resource storage
 */
export const graphcacheConfig: CacheExchangeOpts = {
  keys: {
    // Resource interface uses custom key based on IRI
    Resource: (data: any) => {
      if (data.iri) {
        return generateResourceKey(data.iri)
      }
      return null
    },

    // Document type
    Document: (data: any) => {
      if (data.iri) {
        return generateResourceKey(data.iri)
      }
      // Fallback to account/path if no IRI
      if (data.account && data.path) {
        return `Account:${data.account}:Resource:${data.path}`
      }
      return null
    },

    // Comment type
    Comment: (data: any) => {
      if (data.iri) {
        return generateResourceKey(data.iri)
      }
      // Fallback to ID if no IRI
      if (data.id) {
        return `Comment:${data.id}`
      }
      return null
    },

    // Profile type
    Profile: (data: any) => {
      if (data.accountId) {
        return generateProfileKey(data.accountId)
      }
      return null
    },

    // BlocksContent doesn't need normalization (embedded)
    BlocksContent: () => null,

    // BlockNode doesn't need normalization (embedded)
    BlockNode: () => null,

    // Block types don't need normalization (embedded in content)
    ParagraphBlock: () => null,
    HeadingBlock: () => null,
    CodeBlock: () => null,
    MathBlock: () => null,
    ImageBlock: () => null,
    VideoBlock: () => null,
    FileBlock: () => null,
    ButtonBlock: () => null,
    EmbedBlock: () => null,
    WebEmbedBlock: () => null,
    NostrBlock: () => null,

    // Annotation types don't need normalization (embedded)
    LinkAnnotation: () => null,
    BoldAnnotation: () => null,
    ItalicAnnotation: () => null,
    UnderlineAnnotation: () => null,
    StrikeAnnotation: () => null,
    CodeAnnotation: () => null,
  },

  resolvers: {
    Query: {
      // Commenting out custom resolver - urql will fetch from network
      // getResource: (_parent, args) => {
      //   const key = generateResourceKey(args.iri as string)
      //   if (!key) return null
      //   return {__typename: 'Resource', iri: args.iri}
      // },
    },
  },

  updates: {
    Mutation: {
      // Add mutation updates here when implementing mutations
    },
  },

  optimistic: {
    // Add optimistic updates here when implementing mutations
  },
}

/**
 * Create configured cache exchange
 */
export function createGraphcacheExchange() {
  return cacheExchange(graphcacheConfig)
}

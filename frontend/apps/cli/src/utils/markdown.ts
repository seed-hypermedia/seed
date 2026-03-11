/**
 * Markdown to Seed block tree parser.
 *
 * Re-exports the parsing functions from @seed-hypermedia/client.
 * This file exists for backward compatibility — all logic now lives
 * in the client SDK's `markdown-to-blocks.ts`.
 */

export {parseMarkdown, flattenToOperations, parseInlineFormatting, parseFrontmatter} from '@seed-hypermedia/client'

export type {BlockNode, SeedBlock, Annotation} from '@seed-hypermedia/client'

export type {HMMetadata} from '@seed-hypermedia/client/hm-types'

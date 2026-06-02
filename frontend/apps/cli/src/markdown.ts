/**
 * CLI markdown formatter with network resolution support.
 *
 * The network-resolved implementation lives in @seed-hypermedia/client so the
 * CLI, desktop assistant, and Agents service share identical embed/mention
 * rendering behavior.
 */

import type {SeedClient} from '@seed-hypermedia/client'
import {documentToResolvedMarkdown} from '@seed-hypermedia/client'
import type {HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'

export type MarkdownOptions = {
  resolve?: boolean // Enable automatic resolution of embeds/mentions/queries
  client?: SeedClient // Required if resolve is true
  maxDepth?: number // Max embed recursion depth (default 2)
}

// Re-export the pure conversion for non-resolved use.
export {blocksToMarkdown} from '@seed-hypermedia/client'

/**
 * Convert a document to markdown with frontmatter, block IDs, and optional
 * resolution of embeds and mentions.
 */
export async function documentToMarkdown(doc: HMDocument, options?: MarkdownOptions): Promise<string> {
  const resolve = options?.resolve ?? false

  if (!resolve || !options?.client) {
    const {blocksToMarkdown} = await import('@seed-hypermedia/client')
    return blocksToMarkdown(doc)
  }

  return documentToResolvedMarkdown(doc, {client: options.client, maxDepth: options.maxDepth})
}

export type {HMDocument, HMMetadata}

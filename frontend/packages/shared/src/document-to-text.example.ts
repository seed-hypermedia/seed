/**
 * Example usage of documentToText function
 *
 * This file demonstrates how to convert a hypermedia document to plain text,
 * resolving all inline embeds and embedded documents.
 */

import {documentToText} from './document-to-text'
import {hmId} from './utils/entity-id-url'
import type {GRPCClient} from './grpc-client'

/**
 * Example 1: Basic usage
 */
export async function basicExample(grpcClient: GRPCClient) {
  const documentId = hmId('test-account', {path: ['my-document']})

  const text = await documentToText({
    documentId,
    grpcClient,
    options: {},
  })

  console.log(text)
  // Output: The plain text content of the document with inline embeds resolved
}

/**
 * Example 2: With custom options
 */
export async function customOptionsExample(grpcClient: GRPCClient) {
  const documentId = hmId('test-account', {path: ['my-document']})

  const text = await documentToText({
    documentId,
    grpcClient,
    options: {
      maxDepth: 5, // Limit recursion depth for embedded documents
      resolveInlineEmbeds: true, // Resolve inline embeds to document names (default: true)
      lineBreaks: true, // Use line breaks between blocks (default: true)
    },
  })

  console.log(text)
}

/**
 * Example 3: Handling inline embeds
 *
 * If a document contains text like: "Check this <inline-embed> out"
 * where <inline-embed> is an invisible character pointing to another document,
 * the output will be: "Check this [Referenced Document Name] out"
 */
export async function inlineEmbedExample(grpcClient: GRPCClient) {
  const documentId = hmId('test-account', {path: ['doc-with-inline-embeds']})

  const text = await documentToText({
    documentId,
    grpcClient,
    options: {},
  })

  // If the document contains: "Hello {inline-embed-to-doc} world"
  // Output: "Hello [Referenced Document] world"
  console.log(text)
}

/**
 * Example 4: Handling block embeds
 *
 * Block embeds are full document embeds that appear as separate blocks.
 * These are resolved recursively and their content is included in the output.
 */
export async function blockEmbedExample(grpcClient: GRPCClient) {
  const documentId = hmId('test-account', {path: ['doc-with-block-embeds']})

  const text = await documentToText({
    documentId,
    grpcClient,
    options: {},
  })

  // If the document has structure:
  // - Paragraph: "Introduction text"
  // - Embed block: -> points to another document with content "Embedded content"
  // - Paragraph: "Conclusion text"
  //
  // Output:
  // Introduction text
  //
  // Embedded content
  //
  // Conclusion text
  console.log(text)
}

/**
 * Example 5: Using lineBreaks option
 *
 * Control whether blocks are separated by line breaks or spaces
 */
export async function lineBreaksExample(grpcClient: GRPCClient) {
  const documentId = hmId('test-account', {path: ['my-document']})

  // With line breaks (default)
  const textWithBreaks = await documentToText({
    documentId,
    grpcClient,
    options: {lineBreaks: true},
  })
  // Output: "First paragraph\n\nSecond paragraph"

  // Without line breaks
  const textWithoutBreaks = await documentToText({
    documentId,
    grpcClient,
    options: {lineBreaks: false},
  })
  // Output: "First paragraph Second paragraph"

  console.log({textWithBreaks, textWithoutBreaks})
}

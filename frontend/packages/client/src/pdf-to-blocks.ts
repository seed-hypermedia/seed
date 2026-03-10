/**
 * Unified PDF-to-HMBlockNode converter.
 *
 * Uses embedded pdfjs-dist extraction by default (no server needed).
 * When a GROBID server URL is provided, uses GROBID for high-fidelity
 * ML-based extraction (better for academic papers).
 *
 * @example
 * ```ts
 * import {pdfToBlocks} from '@seed-hypermedia/client'
 *
 * // Embedded extraction (default, no server needed)
 * const result = await pdfToBlocks(pdfArrayBuffer)
 *
 * // Use GROBID for higher fidelity
 * const result = await pdfToBlocks(pdfArrayBuffer, {
 *   grobidUrl: 'http://localhost:8070',
 * })
 * ```
 */

import type {HMBlockNode, HMMetadata} from '@shm/shared/hm-types'
import {isGrobidAvailable, processFulltextDocument} from './grobid'
import type {GrobidOptions} from './grobid'
import {teiToBlocks} from './tei-to-blocks'
import type {TeiToBlocksOptions} from './tei-to-blocks'
import {embeddedPdfToBlocks} from './pdf-to-blocks-embedded'

// ── Public types ─────────────────────────────────────────────────────────────

/** Options for the unified PDF-to-blocks converter. */
export type PdfToBlocksOptions = {
  /** GROBID server URL. When provided, GROBID is used instead of embedded extraction. */
  grobidUrl?: string
  /** GROBID health-check timeout in milliseconds (default: 3000). */
  grobidTimeoutMs?: number
  /** Options passed to the TEI-to-blocks converter (GROBID path only). */
  teiOptions?: TeiToBlocksOptions
  /** Options passed to the GROBID API (e.g. teiCoordinates). */
  grobidOptions?: Pick<GrobidOptions, 'teiCoordinates'>
}

/** Result of the PDF-to-blocks conversion. */
export type PdfToBlocksResult = {
  /** Document metadata (title, authors, abstract, etc.). */
  metadata: Pick<HMMetadata, 'name' | 'summary' | 'displayPublishTime' | 'displayAuthor'>
  /** Document content as a hierarchical block tree. */
  blocks: HMBlockNode[]
  /** Which extraction method was used. */
  source: 'grobid' | 'embedded'
}

// ── Main API ─────────────────────────────────────────────────────────────────

/**
 * Convert a PDF to Seed Hypermedia blocks.
 *
 * Uses embedded pdfjs-dist extraction by default. When `grobidUrl` is
 * provided, connects to a GROBID server for higher-fidelity extraction
 * (academic papers, structured documents with references, figures, etc.).
 *
 * @param pdfData - Raw PDF file content as ArrayBuffer
 * @param options - Extraction options
 * @returns Metadata, block tree, and which source was used
 */
export async function pdfToBlocks(pdfData: ArrayBuffer, options: PdfToBlocksOptions = {}): Promise<PdfToBlocksResult> {
  const {grobidUrl, grobidTimeoutMs = 3000, teiOptions = {}, grobidOptions = {}} = options

  // ── GROBID path: only when explicitly requested via grobidUrl ──
  if (grobidUrl) {
    const available = await isGrobidAvailable(grobidUrl, grobidTimeoutMs)
    if (!available) {
      throw new Error(
        `GROBID server is not reachable at ${grobidUrl}.\n` +
          'Start a GROBID instance with:\n' +
          '  docker run --rm -p 8070:8070 grobid/grobid:0.8.2-full',
      )
    }
    return useGrobidExtraction(pdfData, grobidUrl, grobidOptions, teiOptions)
  }

  // ── Default: embedded extraction ──
  return useEmbeddedExtraction(pdfData)
}

// ── Internal extraction paths ────────────────────────────────────────────────

async function useGrobidExtraction(
  pdfData: ArrayBuffer,
  grobidUrl: string,
  grobidOpts: Pick<GrobidOptions, 'teiCoordinates'>,
  teiOpts: TeiToBlocksOptions,
): Promise<PdfToBlocksResult> {
  const teiXml = await processFulltextDocument(pdfData, {
    grobidUrl,
    teiCoordinates: grobidOpts.teiCoordinates || ['figure'],
  })

  const {metadata, blocks} = await teiToBlocks(teiXml, teiOpts)

  return {metadata, blocks, source: 'grobid'}
}

async function useEmbeddedExtraction(pdfData: ArrayBuffer): Promise<PdfToBlocksResult> {
  const {metadata, blocks} = await embeddedPdfToBlocks(pdfData)

  return {
    metadata: {
      name: metadata.name,
    },
    blocks,
    source: 'embedded',
  }
}

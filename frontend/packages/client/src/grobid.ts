/**
 * GROBID HTTP client — sends PDFs to a GROBID server for full-text extraction.
 *
 * Expects a running GROBID instance (e.g. via Docker):
 *   docker run --rm -p 8070:8070 grobid/grobid:0.8.2-full
 */

export const DEFAULT_GROBID_URL = 'http://localhost:8070'

export interface GrobidOptions {
  /** Base URL of the GROBID server (default: http://localhost:8070) */
  grobidUrl?: string
  /** Request TEI coordinates for specific element types */
  teiCoordinates?: string[]
}

/**
 * Check whether a GROBID server is reachable at the given URL.
 * Returns true if the server responds within the timeout, false otherwise.
 */
export async function isGrobidAvailable(grobidUrl = DEFAULT_GROBID_URL, timeoutMs = 3000): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(`${grobidUrl}/api/isalive`, {
      signal: controller.signal,
    })
    clearTimeout(timer)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Send a PDF to GROBID's processFulltextDocument endpoint and return TEI XML.
 */
export async function processFulltextDocument(
  pdfBuffer: ArrayBuffer | Buffer,
  options?: GrobidOptions,
): Promise<string> {
  const baseUrl = options?.grobidUrl || DEFAULT_GROBID_URL
  const url = `${baseUrl}/api/processFulltextDocument`

  const formData = new FormData()
  formData.append('input', new Blob([pdfBuffer]), 'document.pdf')

  // Request coordinates for figure bounding boxes (useful for future figure extraction)
  const coords = options?.teiCoordinates || ['figure']
  for (const coord of coords) {
    formData.append('teiCoordinates', coord)
  }

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`GROBID error (${response.status}): ${response.statusText}${body ? ` — ${body}` : ''}`)
  }

  return response.text()
}

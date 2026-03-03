import {LoaderFunction} from '@remix-run/node'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'

/**
 * Simple proxy for IPFS file content (videos, documents, etc.)
 * Unlike the image route, this does not process/resize the file.
 * Streams the response to avoid loading large files into memory.
 * This avoids the need for clients to construct localhost daemon URLs,
 * which break on hosted sites.
 */
export const loader: LoaderFunction = async ({params, request}) => {
  const CID = params['*']?.split('/')[0]

  if (!CID) return new Response('No CID provided', {status: 400})

  try {
    const fileUrl = `${DAEMON_HTTP_URL}/ipfs/${CID}`

    // Forward range headers for video seeking support
    const headers: Record<string, string> = {}
    const range = request.headers.get('range')
    if (range) {
      headers['Range'] = range
    }

    const response = await fetch(fileUrl, {headers})
    if (!response.ok && response.status !== 206) {
      throw new Error(`Failed to fetch file from ${fileUrl}: ${response.status}`)
    }

    // Stream the response body directly
    const responseHeaders: Record<string, string> = {
      'Cache-Control': 'public, max-age=31536000, immutable',
    }

    // Forward relevant headers from the daemon response
    const contentType = response.headers.get('content-type')
    if (contentType) responseHeaders['Content-Type'] = contentType
    const contentLength = response.headers.get('content-length')
    if (contentLength) responseHeaders['Content-Length'] = contentLength
    const contentRange = response.headers.get('content-range')
    if (contentRange) responseHeaders['Content-Range'] = contentRange
    const acceptRanges = response.headers.get('accept-ranges')
    if (acceptRanges) responseHeaders['Accept-Ranges'] = acceptRanges

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (err) {
    console.error('hm.api.file loader error:', err)
    return new Response('Failed to fetch file', {status: 500})
  }
}

import {LoaderFunction} from '@remix-run/node'
import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {daemonIpfsUrl, parseCidParam} from '@/utils/cid-param'
import {withCors} from '@/utils/cors'

/**
 * Simple proxy for IPFS file content (videos, documents, etc.)
 * Unlike the image route, this does not process/resize the file.
 * Streams the response to avoid loading large files into memory.
 * This avoids the need for clients to construct localhost daemon URLs,
 * which break on hosted sites.
 *
 * Responses carry CORS headers: sandboxed extension iframes run at an opaque
 * origin and load files (entry HTML, images, data) through this route.
 */
export const loader: LoaderFunction = async ({params, request}) => {
  if (request.method === 'OPTIONS') {
    return withFileCors(new Response(null, {status: 204}))
  }
  const authToken = await getDaemonAuthToken(request)
  return withFileCors(await withDaemonAuthToken(authToken, () => loadFile(params, request, authToken)))
}

function withFileCors(response: Response) {
  const res = withCors(response)
  // Range requests (video seeking) are not CORS-safelisted; allow them on preflight.
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range')
  res.headers.set('Access-Control-Expose-Headers', 'Content-Type, Content-Length, Content-Range, Accept-Ranges')
  return res
}

async function loadFile(params: Record<string, string | undefined>, request: Request, authToken: string | null) {
  // The CID is validated and re-serialized before it reaches the daemon URL so
  // the splat can only ever address `/ipfs/<cid>` (never another daemon route).
  const CID = parseCidParam(params['*'])

  if (!CID) return new Response('Invalid CID', {status: 400})

  try {
    const fileUrl = daemonIpfsUrl(CID)

    // Forward range headers for video seeking support
    const headers: Record<string, string> = {}
    const range = request.headers.get('range')
    if (range) {
      headers['Range'] = range
    }
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`
    }

    const response = await fetch(fileUrl, {headers})
    if (!response.ok && response.status !== 206) {
      throw new Error(`Failed to fetch file from ${fileUrl}: ${response.status}`)
    }

    // Stream the response body directly
    const responseHeaders: Record<string, string> = {}

    // Forward relevant headers from the daemon response
    const cacheControl = response.headers.get('cache-control')
    if (cacheControl) responseHeaders['Cache-Control'] = cacheControl
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

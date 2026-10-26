import {ipcMain, protocol, type Session} from 'electron'
import {randomBytes} from 'node:crypto'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {
  DOCUMENT_PAGE_CLIENT_PATH,
  DOCUMENT_PAGE_CLIENT_SCRIPT,
  DOCUMENT_PAGE_SCHEME,
  documentPageResponseHeaders,
  parseDocumentPageReference,
} from '@shm/shared/document-page'

/**
 * Serves custom HTML pages: `seed-page://<host>/<file>` is a file from the page folder of one
 * document, fetched from the daemon by the folder's CID, with a fresh unpredictable origin
 * for each launch, bound to the document, bundle and selected viewer.
 * Native storage cannot identify the viewer or silently carry private data into the next launch.
 *
 * The renderer registers a document's current page with `document-page-open` and embeds the URL
 * it gets back. Only files inside that folder are ever served from that origin, plus the bridge
 * client script; the daemon's own origin, its secret and the network stay out of reach.
 */

/** Must run before the page is ready: makes the scheme a real origin with storage and fetch. */
export function registerDocumentPageScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DOCUMENT_PAGE_SCHEME,
      privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true},
    },
  ])
}

type RegisteredPage = {id: string; cid: string; account: string | null}

/** Registers an immutable bundle/viewer origin and returns the page URL to embed. */
export function openDocumentPage(pages: Map<string, RegisteredPage>, input: unknown): string {
  const value = input as Partial<RegisteredPage> | null
  if (!value || typeof value.id !== 'string' || !value.id.startsWith('hm://'))
    throw new Error('A document id is required')
  const cid = parseDocumentPageReference(value.cid)
  if (!cid) throw new Error('A custom HTML page needs a folder CID')
  if (value.account !== null && typeof value.account !== 'string') throw new Error('A page viewer is required')
  const host = randomBytes(20).toString('hex')
  pages.set(host, {id: value.id, cid, account: value.account})
  return `${DOCUMENT_PAGE_SCHEME}://${host}/`
}

/** Answers one request inside a page origin. Pure apart from the file fetch it is handed. */
export async function handleDocumentPageRequest(
  request: {method: string; url: string},
  options: {
    pages: Map<string, RegisteredPage>
    frameAncestors: string[]
    fetchFile: (cid: string, path: string) => Promise<Response>
  },
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, {status: 405})
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return new Response(null, {status: 400})
  }
  const page = options.pages.get(url.hostname)
  if (!page) return new Response('No page is open for this document', {status: 404})
  if (url.pathname === DOCUMENT_PAGE_CLIENT_PATH) {
    return new Response(DOCUMENT_PAGE_CLIENT_SCRIPT, {
      status: 200,
      headers: documentPageResponseHeaders('text/javascript; charset=utf-8', options.frameAncestors),
    })
  }
  // The reserved prefix is the bridge's; nothing from the folder is served under it.
  if (url.pathname.startsWith('/.seed/')) return new Response(null, {status: 404})
  // Decode before judging: a non-special scheme keeps "%2e%2e" in the path as written.
  let segments: string[]
  try {
    segments = url.pathname
      .split('/')
      .filter((segment) => segment !== '')
      .map((segment) => decodeURIComponent(segment))
  } catch {
    return new Response(null, {status: 400})
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.includes('/')) return new Response(null, {status: 400})
  }
  let upstream: Response
  try {
    upstream = await options.fetchFile(page.cid, segments.join('/'))
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Page file unavailable', {status: 502})
  }
  if (!upstream.ok) return new Response(null, {status: upstream.status === 404 ? 404 : 502})
  // The daemon serves HTML as inert text. Restore its type only inside this isolated page origin.
  const contentType =
    url.pathname.endsWith('/') || /\.html?$/i.test(segments.at(-1) ?? '')
      ? 'text/html; charset=utf-8'
      : upstream.headers.get('content-type') || 'application/octet-stream'
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: 200,
    headers: documentPageResponseHeaders(contentType, options.frameAncestors),
  })
}

/** Fetches one file of a page folder from the daemon, which walks the UnixFS directory. */
function fetchPageFile(cid: string, path: string): Promise<Response> {
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return fetch(`${DAEMON_HTTP_URL}/ipfs/${encodeURIComponent(cid)}${encoded ? `/${encoded}` : ''}`)
}

/** Installs the scheme handler on a session and the IPC the renderer registers pages through. */
export function installDocumentPageProtocol(session: Session, getFrameAncestors: () => string[]) {
  const pages = new Map<string, RegisteredPage>()
  const owners = new Map<string, number>()
  const watched = new Set<number>()
  const release = (host: string) => {
    pages.delete(host)
    owners.delete(host)
    void session.clearStorageData({origin: `${DOCUMENT_PAGE_SCHEME}://${host}`}).catch(() => {})
  }
  session.protocol.handle(DOCUMENT_PAGE_SCHEME, (request) =>
    handleDocumentPageRequest(request, {pages, frameAncestors: getFrameAncestors(), fetchFile: fetchPageFile}),
  )
  ipcMain.handle('document-page-open', (event, input: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid page host')
    const url = openDocumentPage(pages, input)
    const host = new URL(url).hostname
    const senderId = event.sender.id
    if (!watched.has(senderId)) {
      watched.add(senderId)
      event.sender.once('destroyed', () => {
        for (const [key, owner] of Array.from(owners)) if (owner === senderId) release(key)
        watched.delete(senderId)
      })
    }
    owners.set(host, senderId)
    return url
  })
  ipcMain.handle('document-page-close', (event, url: string) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid page host')
    const host = new URL(url).hostname
    if (owners.get(host) !== event.sender.id) return
    release(host)
  })
}

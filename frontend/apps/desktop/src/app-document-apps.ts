import {ipcMain, protocol, type Session} from 'electron'
import {randomBytes} from 'node:crypto'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {
  DOCUMENT_APP_CLIENT_PATH,
  DOCUMENT_APP_CLIENT_SCRIPT,
  DOCUMENT_APP_SCHEME,
  documentAppResponseHeaders,
  parseDocumentAppReference,
} from '@shm/shared/document-app'

/**
 * Serves document apps: `seed-app://<host>/<file>` is a file from the app folder of one
 * document, fetched from the daemon by the folder's CID, with a fresh unpredictable origin
 * for each launch, bound to the document, bundle and selected viewer.
 * Native storage cannot identify the viewer or silently carry private data into the next launch.
 *
 * The renderer registers a document's current app with `document-app-open` and embeds the URL
 * it gets back. Only files inside that folder are ever served from that origin, plus the bridge
 * client script; the daemon's own origin, its secret and the network stay out of reach.
 */

/** Must run before the app is ready: makes the scheme a real origin with storage and fetch. */
export function registerDocumentAppScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DOCUMENT_APP_SCHEME,
      privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true},
    },
  ])
}

type RegisteredApp = {id: string; cid: string; account: string | null}

/** Registers an immutable bundle/viewer origin and returns the page URL to embed. */
export function openDocumentApp(apps: Map<string, RegisteredApp>, input: unknown): string {
  const value = input as Partial<RegisteredApp> | null
  if (!value || typeof value.id !== 'string' || !value.id.startsWith('hm://'))
    throw new Error('A document id is required')
  const cid = parseDocumentAppReference(value.cid)
  if (!cid) throw new Error('A document app needs a folder CID')
  if (value.account !== null && typeof value.account !== 'string') throw new Error('An app viewer is required')
  const host = randomBytes(20).toString('hex')
  apps.set(host, {id: value.id, cid, account: value.account})
  return `${DOCUMENT_APP_SCHEME}://${host}/`
}

/** Answers one request inside an app origin. Pure apart from the file fetch it is handed. */
export async function handleDocumentAppRequest(
  request: {method: string; url: string},
  options: {
    apps: Map<string, RegisteredApp>
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
  const app = options.apps.get(url.hostname)
  if (!app) return new Response('No app is open for this document', {status: 404})
  if (url.pathname === DOCUMENT_APP_CLIENT_PATH) {
    return new Response(DOCUMENT_APP_CLIENT_SCRIPT, {
      status: 200,
      headers: documentAppResponseHeaders('text/javascript; charset=utf-8', options.frameAncestors),
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
    upstream = await options.fetchFile(app.cid, segments.join('/'))
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'App file unavailable', {status: 502})
  }
  if (!upstream.ok) return new Response(null, {status: upstream.status === 404 ? 404 : 502})
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: 200,
    headers: documentAppResponseHeaders(
      upstream.headers.get('content-type') || 'application/octet-stream',
      options.frameAncestors,
    ),
  })
}

/** Fetches one file of an app folder from the daemon, which walks the UnixFS directory. */
function fetchAppFile(cid: string, path: string): Promise<Response> {
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return fetch(`${DAEMON_HTTP_URL}/ipfs/${encodeURIComponent(cid)}${encoded ? `/${encoded}` : ''}`)
}

/** Installs the scheme handler on a session and the IPC the renderer registers apps through. */
export function installDocumentAppProtocol(session: Session, getFrameAncestors: () => string[]) {
  const apps = new Map<string, RegisteredApp>()
  const owners = new Map<string, number>()
  const watched = new Set<number>()
  const release = (host: string) => {
    apps.delete(host)
    owners.delete(host)
    void session.clearStorageData({origin: `${DOCUMENT_APP_SCHEME}://${host}`}).catch(() => {})
  }
  session.protocol.handle(DOCUMENT_APP_SCHEME, (request) =>
    handleDocumentAppRequest(request, {apps, frameAncestors: getFrameAncestors(), fetchFile: fetchAppFile}),
  )
  ipcMain.handle('document-app-open', (event, input: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid app host')
    const url = openDocumentApp(apps, input)
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
  ipcMain.handle('document-app-close', (event, url: string) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid app host')
    const host = new URL(url).hostname
    if (owners.get(host) !== event.sender.id) return
    release(host)
  })
}

import {ipcMain, protocol, type Session} from 'electron'
import {createHash} from 'node:crypto'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {
  DOCUMENT_APP_CLIENT_PATH,
  DOCUMENT_APP_CLIENT_SCRIPT,
  DOCUMENT_APP_SCHEME,
  documentAppHostFromDigest,
  documentAppResponseHeaders,
  parseDocumentAppReference,
} from '@shm/shared/document-app'

/**
 * Serves document apps: `seed-app://<host>/<file>` is a file from the app folder of one
 * document, fetched from the daemon by the folder's CID. The host is derived from the document
 * id, bundle CID and selected viewer. Opening another revision cannot replace this origin's code.
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

/** Immutable code and viewer identity; portable state is separately keyed by viewer and document. */
export function documentAppHost(id: string, cid: string, account: string | null): string {
  return documentAppHostFromDigest(
    createHash('sha256')
      .update(JSON.stringify([id, cid, account]))
      .digest('hex'),
  )
}

/** Registers an immutable bundle/viewer origin and returns the page URL to embed. */
export function openDocumentApp(apps: Map<string, RegisteredApp>, input: unknown): string {
  const value = input as Partial<RegisteredApp> | null
  if (!value || typeof value.id !== 'string' || !value.id.startsWith('hm://'))
    throw new Error('A document id is required')
  const cid = parseDocumentAppReference(value.cid)
  if (!cid) throw new Error('A document app needs a folder CID')
  if (value.account !== null && typeof value.account !== 'string') throw new Error('An app viewer is required')
  const host = documentAppHost(value.id, cid, value.account)
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
  session.protocol.handle(DOCUMENT_APP_SCHEME, (request) =>
    handleDocumentAppRequest(request, {apps, frameAncestors: getFrameAncestors(), fetchFile: fetchAppFile}),
  )
  ipcMain.handle('document-app-open', (event, input: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid app host')
    return openDocumentApp(apps, input)
  })
}

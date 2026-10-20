/**
 * Document apps: a document whose `app` metadata attribute names a UnixFS folder with an
 * `index.html`. Seed opens the document as that app, in a sandboxed origin of its own, and the
 * app talks to Seed only through the `postMessage` bridge defined here.
 *
 * The app is untrusted code: once a document is shared, anyone's app runs on the viewer's
 * machine next to the viewer's data. So the app gets no network, no daemon, no secret, and no
 * access to the Seed window. What it gets is `window.seed` (from {@link DOCUMENT_APP_CLIENT_PATH}),
 * whose calls the embedding Seed window answers with the viewer's own client, so the app reads
 * exactly what the viewer can read, nothing more.
 *
 * The origin is per document, not per revision, so an app's `localStorage` survives the author
 * publishing a new version, while two documents never share state.
 */

/** The URL scheme the desktop serves app folders under: `seed-app://<document host>/<file>`. */
export const DOCUMENT_APP_SCHEME = 'seed-app'

/** The bridge script an app loads with `<script src="/.seed/client.js"></script>`. */
export const DOCUMENT_APP_CLIENT_PATH = '/.seed/client.js'

/** Version of the request/response envelope; bumped only for incompatible changes. */
export const DOCUMENT_APP_PROTOCOL = 1

/** Largest request an app may send, in JSON bytes. */
export const DOCUMENT_APP_MAX_REQUEST_BYTES = 64 * 1024

/** The methods an app may call. Reads only; every one answers from the viewer's perspective. */
export const DOCUMENT_APP_METHODS = ['context', 'resource', 'directory'] as const
export type DocumentAppMethod = (typeof DOCUMENT_APP_METHODS)[number]

export type DocumentAppRequest = {
  seedApp: typeof DOCUMENT_APP_PROTOCOL
  id: string
  method: DocumentAppMethod
  params?: unknown
}
export type DocumentAppResponse =
  | {seedApp: typeof DOCUMENT_APP_PROTOCOL; id: string; result: unknown}
  | {seedApp: typeof DOCUMENT_APP_PROTOCOL; id: string; error: string}

/** What `seed.context()` answers: where the app runs and as whom it reads. */
export type DocumentAppContext = {
  protocol: typeof DOCUMENT_APP_PROTOCOL
  /** The document the app belongs to, as `hm://<account>/<path>`. */
  document: string
  /** The version of that document being viewed, when known. */
  version: string | null
  /** The viewer's account, the perspective every read is answered from; null when signed out. */
  account: string | null
  /** The app folder's CID. */
  app: string
}

/** Extracts the folder CID from an `app` metadata value (`ipfs://<cid>` or a bare CID). */
export function parseDocumentAppReference(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cid = value.startsWith('ipfs://') ? value.slice('ipfs://'.length) : value
  return /^[a-z2-7]{20,}$/i.test(cid) && !cid.includes('/') ? cid : null
}

/**
 * The host of an app's origin, derived from the document it belongs to. Hostnames are
 * case-insensitive and account ids are not, so the id is hashed rather than embedded.
 * Callers pass a hex SHA-256 of the canonical `hm://` id; this keeps the host well-formed.
 */
export function documentAppHostFromDigest(hexDigest: string): string {
  const host = hexDigest.toLowerCase().slice(0, 40)
  if (!/^[0-9a-f]{40}$/.test(host)) throw new Error('A document app host is 40 hex characters of the id digest')
  return host
}

/** Whether a URL is a document app page, and nothing else, by its scheme and host shape. */
export function isDocumentAppURL(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === `${DOCUMENT_APP_SCHEME}:` && /^[0-9a-f]{40}$/.test(url.hostname)
}

/**
 * The origin string Chromium reports for an app URL (`seed-app://<host>`), built by hand because
 * `URL.origin` is `null` for the scheme outside the desktop, where it is registered as standard.
 */
export function documentAppOrigin(appUrl: string): string {
  const url = new URL(appUrl)
  if (url.protocol !== `${DOCUMENT_APP_SCHEME}:`) throw new Error('Not a document app URL')
  return `${DOCUMENT_APP_SCHEME}://${url.hostname}`
}

/**
 * The policy every response from inside an app origin carries. `'self'` is the app's own folder:
 * its scripts, styles and images load; nothing else does, and nothing is fetched elsewhere.
 * `frameAncestors` names who may embed the app, the Seed window.
 */
export function documentAppContentSecurityPolicy(frameAncestors: string[]): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors.length ? frameAncestors.join(' ') : "'none'"}`,
  ].join('; ')
}

/** Headers for a response served inside an app origin. */
export function documentAppResponseHeaders(contentType: string, frameAncestors: string[]): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': documentAppContentSecurityPolicy(frameAncestors),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), payment=(), usb=()',
  }
}

/**
 * The script served at {@link DOCUMENT_APP_CLIENT_PATH}. It defines `window.seed`, whose methods
 * post a request to the embedding window and resolve with its answer. Responses are accepted only
 * from that window.
 */
export const DOCUMENT_APP_CLIENT_SCRIPT = `(() => {
  if (window.seed) return;
  const host = window.parent !== window ? window.parent : null;
  const pending = new Map();
  let counter = 0;
  addEventListener('message', (event) => {
    const data = event.data;
    if (!host || event.source !== host || !data || data.seedApp !== ${DOCUMENT_APP_PROTOCOL} || typeof data.id !== 'string') return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if ('error' in data) entry.reject(new Error(String(data.error)));
    else entry.resolve(data.result);
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      if (!host) return reject(new Error('This app is not embedded in Seed'));
      const id = String(++counter) + '.' + Math.random().toString(36).slice(2);
      pending.set(id, {resolve, reject});
      host.postMessage({seedApp: ${DOCUMENT_APP_PROTOCOL}, id, method, params}, '*');
    });
  window.seed = Object.freeze({
    /** Where this app runs: its document, the version shown, and the viewer's account. */
    context: () => call('context'),
    /** A document or comment by hm:// URL, as the viewer sees it. */
    resource: (url) => call('resource', {url}),
    /** The documents under an hm:// URL: direct children, or every descendant with {all: true}. */
    directory: (url, options) => call('directory', {url, all: !!(options && options.all)}),
  });
})();
`

/** Parses an untrusted message into a request, or explains why it is not one. */
export function parseDocumentAppRequest(data: unknown): DocumentAppRequest | null {
  if (!data || typeof data !== 'object') return null
  const message = data as Record<string, unknown>
  if (message.seedApp !== DOCUMENT_APP_PROTOCOL) return null
  if (typeof message.id !== 'string' || !message.id || message.id.length > 64) return null
  if (typeof message.method !== 'string' || !(DOCUMENT_APP_METHODS as readonly string[]).includes(message.method))
    return null
  let size = 0
  try {
    size = JSON.stringify(message.params ?? null).length
  } catch {
    return null
  }
  if (size > DOCUMENT_APP_MAX_REQUEST_BYTES) return null
  return {
    seedApp: DOCUMENT_APP_PROTOCOL,
    id: message.id,
    method: message.method as DocumentAppMethod,
    params: message.params,
  }
}

/**
 * A `message` listener for the window that embeds an app. It answers requests that come from the
 * app's frame and origin and ignores everything else, so no other frame can pose as the app and no
 * app can reach a handler through a window it is not in.
 */
export function createDocumentAppMessageListener(options: {
  frame: () => HTMLIFrameElement | null
  origin: string
  handle: (request: DocumentAppRequest) => Promise<unknown>
}): (event: MessageEvent) => void {
  return (event) => {
    const frame = options.frame()
    const source = frame?.contentWindow
    if (!source || event.source !== source || event.origin !== options.origin) return
    const request = parseDocumentAppRequest(event.data)
    if (!request) return
    const reply = (response: DocumentAppResponse) => {
      // The frame may have navigated or unmounted while the request ran.
      if (options.frame()?.contentWindow === source) source.postMessage(response, options.origin)
    }
    options.handle(request).then(
      (result) => reply({seedApp: DOCUMENT_APP_PROTOCOL, id: request.id, result}),
      (error) =>
        reply({
          seedApp: DOCUMENT_APP_PROTOCOL,
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        }),
    )
  }
}

/** How the host app turns a document app into a page URL it can embed. */
export type DocumentAppPlatform = {
  /** Resolves the page URL for a document's app folder, registering it with the host if needed. */
  resolveAppUrl: (input: {id: string; cid: string}) => Promise<string>
}

let platform: DocumentAppPlatform | null = null

export function setDocumentAppPlatform(next: DocumentAppPlatform | null) {
  platform = next
}

export function getDocumentAppPlatform(): DocumentAppPlatform | null {
  return platform
}

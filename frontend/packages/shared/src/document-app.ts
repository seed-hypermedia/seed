import type {
  HMBlockNode,
  HMRequest,
  HMPublishBlobsInput,
  HMPublishBlobsOutput,
  HMSigner,
} from '@seed-hypermedia/client/hm-types'
import type {DOCUMENT_APP_SIGNING_HELPERS} from './document-app-content'
import type {PublishDocumentInput} from './universal-client'

/**
 * Document apps run untrusted HTML through a host-owned SDK. Desktop uses a fresh launch
 * origin; web uses an opaque sandbox on the Seed host. Portable state goes through
 * viewer/document-scoped storage. Content helpers have no authority; reads, writing and signing
 * require host-owned, scoped approvals. Keys stay in the host.
 */

/** The URL scheme the desktop serves app folders under: `seed-app://<document host>/<file>`. */
export const DOCUMENT_APP_SCHEME = 'seed-app'

/** The bridge script an app loads with `<script src="/.seed/client.js"></script>`. */
export const DOCUMENT_APP_CLIENT_PATH = '/.seed/client.js'

/** Version of the request/response envelope; bumped only for incompatible changes. */
export const DOCUMENT_APP_PROTOCOL = 1

/** Version of the SDK contract, independent of the transport envelope version. */
export const DOCUMENT_APP_SDK_VERSION = '1.2.0'

/** Largest request an app may send, including binary data. */
export const DOCUMENT_APP_MAX_REQUEST_BYTES = 8 * 1024 * 1024

/** Signing helpers available through the app SDK; each uses the current account. */
export const DOCUMENT_APP_SIGNING_HELPER_NAMES = [
  'createComment',
  'updateComment',
  'deleteComment',
  'createDocumentBlobs',
  'createVersionRef',
  'createRedirectRef',
  'createTombstoneRef',
  'createCapability',
  'createContact',
  'updateContact',
  'deleteContact',
  'signDocumentChange',
  'signBlob',
] as const

/** Bridge operations for reads, writes, signing, helpers and local state. */
export const DOCUMENT_APP_METHODS = [
  'runtime',
  'open',
  'context',
  'profile',
  'resource',
  'directory',
  'storage.get',
  'storage.set',
  'hm.parseMarkdown',
  'hm.validateContent',
  'hm.unpackHmId',
  'comments.create',
  'permissions.request',
  'permissions.revoke',
  'request',
  'publish',
  'publishDocument',
  'signer.getPublicKey',
  'signer.sign',
  ...DOCUMENT_APP_SIGNING_HELPER_NAMES.map((name) => `hm.${name}` as const),
] as const

/** Count UTF-8 metadata and actual binary bytes without expanding typed arrays into JSON entries. */
export function documentAppMessageSize(value: unknown): number {
  let binaryBytes = 0
  const json = JSON.stringify(value, (_key, item) => {
    if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer) {
      binaryBytes += item.byteLength
      return null
    }
    if (typeof item === 'bigint') return item.toString()
    return item
  })
  return new TextEncoder().encode(json).byteLength + binaryBytes
}

/** The same portable SDK surface is injected into desktop and opaque web runtimes. */
export const DOCUMENT_APP_API_SCRIPT = `(call) => Object.freeze({
  runtime: () => call('runtime'),
  open: (url, options) => call('open', {url, newWindow: !!options?.newWindow}),
  stringify: (value, space = 2) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item instanceof Uint8Array ? Array.from(item) : item, space),
  context: () => call('context'),
  profile: () => call('profile'),
  storage: Object.freeze({get: (key) => call('storage.get', {key}), set: (key, value) => call('storage.set', {key, value})}),
  resource: (url) => call('resource', {url}),
  directory: (url, options) => call('directory', {url, all: !!options?.all}),
  permissions: Object.freeze({request: () => call('permissions.request'), revoke: () => call('permissions.revoke')}),
  request: (key, input) => call('request', {key, input}),
  publish: (input) => call('publish', {input}),
  publishDocument: (input) => call('publishDocument', {input}),
  signer: Object.freeze({getPublicKey: () => call('signer.getPublicKey'), sign: (data) => call('signer.sign', {data})}),
  hm: Object.freeze({
    parseMarkdown: (markdown) => call('hm.parseMarkdown', {markdown}),
    validateContent: (content) => call('hm.validateContent', {content}),
    unpackHmId: (url) => call('hm.unpackHmId', {url}),
    ...Object.fromEntries(${JSON.stringify(
      DOCUMENT_APP_SIGNING_HELPER_NAMES,
    )}.map((name) => [name, (input) => call('hm.' + name, {input})])),
  }),
  comments: Object.freeze({create: (input) => call('comments.create', input)}),
})`

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

/** The portable SDK installed as `window.seed` in document apps. */
export type DocumentAppSDK = {
  /** Discover the running host contract before using newer APIs. */
  runtime(): Promise<Awaited<ReturnType<typeof documentAppRuntime>>>
  /** Open HM content in Seed, or an explicit HTTP(S) address on its original server. */
  open(url: string, options?: {newWindow?: boolean}): Promise<null>
  /** Display bridge values containing BigInt or binary bytes as JSON; not a signing serialization. */
  stringify(value: unknown, space?: number): string | undefined
  context(): Promise<DocumentAppContext>
  profile(): Promise<{id: string; name: string | null} | null>
  storage: {get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<null>}
  resource(url: string): Promise<unknown>
  directory(url: string, options?: {all?: boolean}): Promise<unknown>
  /** Inspect remembered rules or revoke them; operations themselves trigger consent. */
  permissions: {
    request(): Promise<{grants: import('./document-app-permissions').AppPermissionGrant[]}>
    revoke(): Promise<null>
  }
  signer: HMSigner
  request<K extends HMRequest['key']>(
    key: K,
    input: Extract<HMRequest, {key: K}>['input'],
  ): Promise<Extract<HMRequest, {key: K}>['output']>
  publish(input: HMPublishBlobsInput): Promise<HMPublishBlobsOutput>
  publishDocument(input: Omit<PublishDocumentInput, 'signerAccountUid'>): Promise<{document: string}>
  hm: {
    parseMarkdown(markdown: string): Promise<HMBlockNode[]>
    validateContent(content: HMBlockNode[]): Promise<HMBlockNode[]>
    unpackHmId(url: string): Promise<import('@seed-hypermedia/client/hm-types').UnpackedHypermediaId | null>
  } & {
    [K in keyof typeof DOCUMENT_APP_SIGNING_HELPERS]: (
      input: Parameters<(typeof DOCUMENT_APP_SIGNING_HELPERS)[K]>[0],
    ) => ReturnType<(typeof DOCUMENT_APP_SIGNING_HELPERS)[K]>
  }
  comments: {
    create(input: {
      content: HMBlockNode[]
      target?: string
      version?: string
    }): Promise<{commentId: string; version: string}>
  }
}

/** Host-owned capability manifest, fingerprinted from the actual SDK implementation. */
export async function documentAppRuntime(platform: 'web' | 'desktop') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(DOCUMENT_APP_API_SCRIPT))
  return {
    sdkVersion: DOCUMENT_APP_SDK_VERSION,
    sdkDigest: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    protocol: DOCUMENT_APP_PROTOCOL,
    platform,
    methods: [...DOCUMENT_APP_METHODS],
    storage: {
      scope: 'viewer/document',
      persistence: 'device-only',
      synced: false,
      maxKeyLength: 128,
      maxValueBytes: 16384,
      maxKeys: 64,
    },
    limits: {maxRequestBytes: DOCUMENT_APP_MAX_REQUEST_BYTES, maxPendingRequests: 32},
    authority: 'scoped-app-permissions',
  } as const
}

/** Validate navigation at the host boundary; never admit executable or local-file schemes. */
export function parseDocumentAppLink(params: unknown): {url: string; newWindow: boolean} {
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Invalid link parameters')
  const value = params as Record<string, unknown>
  if (Object.keys(value).some((key) => key !== 'url' && key !== 'newWindow')) throw new Error('Unknown link parameter')
  if (typeof value.url !== 'string' || value.url.length > 8192) throw new Error('Expected an hm:// or HTTP(S) URL')
  if (value.newWindow !== undefined && typeof value.newWindow !== 'boolean') throw new Error('Invalid newWindow option')
  const url = value.url.trim()
  const parsed = new URL(url)
  if (
    !['hm:', 'https:', 'http:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    /[\u0000-\u0020\u007f]/.test(url)
  )
    throw new Error('Expected an hm:// or HTTP(S) URL without credentials')
  return {url: parsed.protocol + url.slice(url.indexOf(':') + 1), newWindow: value.newWindow === true}
}

/** Route ordinary document anchors through the host instead of navigating the sandbox. */
export const DOCUMENT_APP_LINK_SCRIPT = `;(() => {
  const openLink = (event) => {
    if (event.defaultPrevented || (event.type === 'auxclick' ? event.button !== 1 : event.button !== 0)) return;
    const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
    const url = anchor?.getAttribute('href');
    if (!url || !/^(hm|https?):\\/\\//i.test(url)) return;
    event.preventDefault();
    window.seed.open(url, {newWindow: anchor.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1})
      .catch((error) => window.dispatchEvent(new CustomEvent('seed-link-error', {detail: {url, message: error.message}})));
  };
  document.addEventListener('click', openLink);
  document.addEventListener('auxclick', openLink);
})();`

/** Extracts the folder CID from an `app` metadata value (`ipfs://<cid>` or a bare CID). */
export function parseDocumentAppReference(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cid = value.startsWith('ipfs://') ? value.slice('ipfs://'.length) : value
  return /^[a-z2-7]{20,}$/i.test(cid) && !cid.includes('/') ? cid : null
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
  const messageSize = ${documentAppMessageSize.toString()};
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (!host) return reject(new Error('This app is not embedded in Seed'));
      if (pending.size >= 32) return reject(new Error('Too many pending requests'));
      if (messageSize(params) > ${DOCUMENT_APP_MAX_REQUEST_BYTES}) return reject(new Error('Request too large'));
      const id = String(++counter) + '.' + Math.random().toString(36).slice(2);
      pending.set(id, {resolve, reject});
      host.postMessage({seedApp: ${DOCUMENT_APP_PROTOCOL}, id, method, params}, '*');
    });
  window.seed = (${DOCUMENT_APP_API_SCRIPT})(call);
  ${DOCUMENT_APP_LINK_SCRIPT}
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
    size = documentAppMessageSize(message.params ?? null)
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
export type DocumentAppPlatform = (
  | {
      /** Resolves the page URL for a document's app folder, registering it with the host if needed. */
      /** Release an app launch and its native storage when the frame closes. */
      closeAppUrl?: (url: string) => Promise<void>
      resolveAppUrl: (input: {id: string; cid: string; account: string | null}) => Promise<string>
    }
  | {
      /** Fetches an authorized, revision-pinned HTML entry point for the opaque web sandbox. */
      loadAppHtml: (input: {id: string; cid: string; version: string}, signal: AbortSignal) => Promise<string>
    }
) & {
  /** Open an explicit web address without rewriting its server to the current HM gateway. */
  openExternalUrl?: (url: string, newWindow: boolean) => void
}

let platform: DocumentAppPlatform | null = null

/** Install the platform's document-app runtime. */
export function setDocumentAppPlatform(next: DocumentAppPlatform | null) {
  platform = next
}

/** Return the current platform's document-app runtime. */
export function getDocumentAppPlatform(): DocumentAppPlatform | null {
  return platform
}

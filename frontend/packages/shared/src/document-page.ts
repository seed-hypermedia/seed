import type {
  HMBlockNode,
  HMRequest,
  HMResource,
  HMQueryResult,
  HMPublishBlobsInput,
  HMPublishBlobsOutput,
  HMSigner,
} from '@seed-hypermedia/client/hm-types'
import type {DOCUMENT_PAGE_SIGNING_HELPERS} from './document-page-content'
import type {PublishDocumentInput} from './universal-client'

/**
 * Document pages run untrusted HTML through a host-owned SDK. Desktop uses a fresh launch
 * origin; web uses an opaque sandbox on the Seed host. Portable state goes through
 * viewer/document-scoped storage. Content helpers have no authority; reads, writing and signing
 * require host-owned, scoped approvals. Keys stay in the host.
 */

/** The URL scheme the desktop serves page folders under: `seed-page://<document host>/<file>`. */
export const DOCUMENT_PAGE_SCHEME = 'seed-page'

/** The bridge script a page loads with `<script src="/.seed/client.js"></script>`. */
export const DOCUMENT_PAGE_CLIENT_PATH = '/.seed/client.js'

/** Version of the request/response envelope; bumped only for incompatible changes. */
export const DOCUMENT_PAGE_PROTOCOL = 1

/** Version of the SDK contract, independent of the transport envelope version. */
export const DOCUMENT_PAGE_SDK_VERSION = '2.0.0'

/** Largest request a page may send, including binary data. */
export const DOCUMENT_PAGE_MAX_REQUEST_BYTES = 8 * 1024 * 1024

/** Signing helpers available through the page SDK; each uses the current account. */
export const DOCUMENT_PAGE_SIGNING_HELPER_NAMES = [
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
export const DOCUMENT_PAGE_METHODS = [
  'runtime',
  'input.get',
  'input.push',
  'input.replace',
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
  ...DOCUMENT_PAGE_SIGNING_HELPER_NAMES.map((name) => `hm.${name}` as const),
] as const

/** Count UTF-8 metadata and actual binary bytes without expanding typed arrays into JSON entries. */
export function documentPageMessageSize(value: unknown): number {
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
export const DOCUMENT_PAGE_API_SCRIPT = `(call, subscribeInput = () => () => {}) => Object.freeze({
  runtime: () => call('runtime'),
  input: Object.freeze({get: () => call('input.get'), push: (values) => call('input.push', {values}), replace: (values) => call('input.replace', {values}), onChange: (listener) => subscribeInput(listener)}),
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
      DOCUMENT_PAGE_SIGNING_HELPER_NAMES,
    )}.map((name) => [name, (input) => call('hm.' + name, {input})])),
  }),
  comments: Object.freeze({create: (input) => call('comments.create', input)}),
})`

export type DocumentPageMethod = (typeof DOCUMENT_PAGE_METHODS)[number]

export type DocumentPageRequest = {
  seedPage: typeof DOCUMENT_PAGE_PROTOCOL
  id: string
  method: DocumentPageMethod
  params?: unknown
}
export type DocumentPageResponse =
  | {seedPage: typeof DOCUMENT_PAGE_PROTOCOL; id: string; result: unknown}
  | {seedPage: typeof DOCUMENT_PAGE_PROTOCOL; id: string; error: string}

/** What `seed.context()` answers: where the page runs and as whom it reads. */
export type DocumentPageContext = {
  protocol: typeof DOCUMENT_PAGE_PROTOCOL
  /** The document the page belongs to, as `hm://<account>/<path>`. */
  document: string
  /** The version of that document being viewed, when known. */
  version: string | null
  /** The viewer's account, the perspective every read is answered from; null when signed out. */
  account: string | null
  /** The page folder's CID. */
  page: string
}

/** The portable SDK installed as `window.seed` in document pages. */
export type DocumentPageSDK = {
  /** Schema-defined URL input, independent of identity and persisted data. */
  input: {
    get(): Promise<import('./document-page-input').DocumentPageInputState>
    push(values: Record<string, unknown>): Promise<import('./document-page-input').DocumentPageInputState>
    replace(values: Record<string, unknown>): Promise<import('./document-page-input').DocumentPageInputState>
    onChange(listener: (state: import('./document-page-input').DocumentPageInputState) => void): () => void
  }
  /** Discover the running host contract before using newer APIs. */
  runtime(): Promise<Awaited<ReturnType<typeof documentPageRuntime>>>
  /** Open HM content in Seed, or an explicit HTTP(S) address on its original server. */
  open(url: string, options?: {newWindow?: boolean}): Promise<null>
  /** Display bridge values containing BigInt or binary bytes as JSON; not a signing serialization. */
  stringify(value: unknown, space?: number): string | undefined
  context(): Promise<DocumentPageContext>
  profile(): Promise<{id: string; name: string | null} | null>
  storage: {get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<null>}
  /** A resource directly (not the agent read tool's envelope), or a profile for /:profile. */
  resource(url: string): Promise<HMResource | {id: string; name: string | null}>
  /** Direct children by default; each row has id and metadata, without a document wrapper. */
  directory(url: string, options?: {all?: boolean}): Promise<HMQueryResult['results']>
  /** Inspect remembered rules or revoke them; operations themselves trigger consent. */
  permissions: {
    request(): Promise<{grants: import('./document-page-permissions').PagePermissionGrant[]}>
    revoke(): Promise<null>
  }
  signer: HMSigner
  request<K extends HMRequest['key']>(
    key: K,
    input: Extract<HMRequest, {key: K}>['input'],
  ): Promise<Extract<HMRequest, {key: K}>['output']>
  publish(input: HMPublishBlobsInput): Promise<HMPublishBlobsOutput>
  /** Resolve existing viewer write access, publish, and confirm the new version before resolving. */
  publishDocument(input: Omit<PublishDocumentInput, 'signerAccountUid'>): Promise<{document: string}>
  hm: {
    parseMarkdown(markdown: string): Promise<HMBlockNode[]>
    validateContent(content: HMBlockNode[]): Promise<HMBlockNode[]>
    unpackHmId(url: string): Promise<import('@seed-hypermedia/client/hm-types').UnpackedHypermediaId | null>
  } & {
    [K in keyof typeof DOCUMENT_PAGE_SIGNING_HELPERS]: (
      input: Parameters<(typeof DOCUMENT_PAGE_SIGNING_HELPERS)[K]>[0],
    ) => ReturnType<(typeof DOCUMENT_PAGE_SIGNING_HELPERS)[K]>
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
export async function documentPageRuntime(platform: 'web' | 'desktop') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(DOCUMENT_PAGE_API_SCRIPT))
  return {
    sdkVersion: DOCUMENT_PAGE_SDK_VERSION,
    sdkDigest: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
    protocol: DOCUMENT_PAGE_PROTOCOL,
    platform,
    methods: [...DOCUMENT_PAGE_METHODS],
    storage: {
      scope: 'viewer/document',
      persistence: 'device-only',
      synced: false,
      maxKeyLength: 128,
      maxValueBytes: 16384,
      maxKeys: 64,
    },
    limits: {maxRequestBytes: DOCUMENT_PAGE_MAX_REQUEST_BYTES, maxPendingRequests: 32},
    authority: 'scoped-page-permissions',
  } as const
}

/** Validate navigation at the host boundary; never admit executable or local-file schemes. */
export function parseDocumentPageLink(params: unknown): {url: string; newWindow: boolean} {
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
export const DOCUMENT_PAGE_LINK_SCRIPT = `;(() => {
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

/** Extracts the folder CID from an `page` metadata value (`ipfs://<cid>` or a bare CID). */
export function parseDocumentPageReference(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cid = value.startsWith('ipfs://') ? value.slice('ipfs://'.length) : value
  return /^[a-z2-7]{20,}$/i.test(cid) && !cid.includes('/') ? cid : null
}

/** Whether a URL is a document page page, and nothing else, by its scheme and host shape. */
export function isDocumentPageURL(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === `${DOCUMENT_PAGE_SCHEME}:` && /^[0-9a-f]{40}$/.test(url.hostname)
}

/**
 * The origin string Chromium reports for a page URL (`seed-page://<host>`), built by hand because
 * `URL.origin` is `null` for the scheme outside the desktop, where it is registered as standard.
 */
export function documentPageOrigin(pageUrl: string): string {
  const url = new URL(pageUrl)
  if (url.protocol !== `${DOCUMENT_PAGE_SCHEME}:`) throw new Error('Not a document page URL')
  return `${DOCUMENT_PAGE_SCHEME}://${url.hostname}`
}

/**
 * The policy every response from inside a page origin carries. `'self'` is the page's own folder:
 * its scripts, styles and images load; nothing else does, and nothing is fetched elsewhere.
 * `frameAncestors` names who may embed the page, the Seed window.
 */
export function documentPageContentSecurityPolicy(frameAncestors: string[]): string {
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

/** Headers for a response served inside a page origin. */
export function documentPageResponseHeaders(contentType: string, frameAncestors: string[]): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': documentPageContentSecurityPolicy(frameAncestors),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), payment=(), usb=()',
  }
}

/**
 * The script served at {@link DOCUMENT_PAGE_CLIENT_PATH}. It defines `window.seed`, whose methods
 * post a request to the embedding window and resolve with its answer. Responses are accepted only
 * from that window.
 */
export const DOCUMENT_PAGE_CLIENT_SCRIPT = `(() => {
  if (window.seed) return;
  const host = window.parent !== window ? window.parent : null;
  const pending = new Map();
  const inputListeners = new Set();
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  let counter = 0;
  addEventListener('message', (event) => {
    const data = event.data;
    if (!host || event.source !== host || !data || data.seedPage !== ${DOCUMENT_PAGE_PROTOCOL}) return;
    if (data.type === 'seed-ready') { markReady(); return; }
    if (data.type === 'seed-input') { for (const listener of inputListeners) { try { listener(data.state); } catch (error) { console.error(error); } } return; }
    if (typeof data.id !== 'string') return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if ('error' in data) entry.reject(new Error(String(data.error)));
    else entry.resolve(data.result);
  });
  const messageSize = ${documentPageMessageSize.toString()};
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (!host) return reject(new Error('This page is not embedded in Seed'));
      if (pending.size >= 32) return reject(new Error('Too many pending requests'));
      if (messageSize(params) > ${DOCUMENT_PAGE_MAX_REQUEST_BYTES}) return reject(new Error('Request too large'));
      const id = String(++counter) + '.' + Math.random().toString(36).slice(2);
      pending.set(id, {resolve, reject});
      ready.then(() => host.postMessage({seedPage: ${DOCUMENT_PAGE_PROTOCOL}, id, method, params}, '*'));
    });
  window.seed = (${DOCUMENT_PAGE_API_SCRIPT})(call, (listener) => { inputListeners.add(listener); return () => inputListeners.delete(listener); });
  ${DOCUMENT_PAGE_LINK_SCRIPT}
})();
`

/** Parses an untrusted message into a request, or explains why it is not one. */
export function parseDocumentPageRequest(data: unknown): DocumentPageRequest | null {
  if (!data || typeof data !== 'object') return null
  const message = data as Record<string, unknown>
  if (message.seedPage !== DOCUMENT_PAGE_PROTOCOL) return null
  if (typeof message.id !== 'string' || !message.id || message.id.length > 64) return null
  if (typeof message.method !== 'string' || !(DOCUMENT_PAGE_METHODS as readonly string[]).includes(message.method))
    return null
  let size = 0
  try {
    size = documentPageMessageSize(message.params ?? null)
  } catch {
    return null
  }
  if (size > DOCUMENT_PAGE_MAX_REQUEST_BYTES) return null
  return {
    seedPage: DOCUMENT_PAGE_PROTOCOL,
    id: message.id,
    method: message.method as DocumentPageMethod,
    params: message.params,
  }
}

/**
 * A `message` listener for the window that embeds a page. It answers requests that come from the
 * page's frame and origin and ignores everything else, so no other frame can pose as the page and no
 * page can reach a handler through a window it is not in.
 */
export function createDocumentPageMessageListener(options: {
  frame: () => HTMLIFrameElement | null
  origin: string
  handle: (request: DocumentPageRequest) => Promise<unknown>
}): (event: MessageEvent) => void {
  return (event) => {
    const frame = options.frame()
    const source = frame?.contentWindow
    if (!source || event.source !== source || event.origin !== options.origin) return
    const request = parseDocumentPageRequest(event.data)
    if (!request) return
    const reply = (response: DocumentPageResponse) => {
      // The frame may have navigated or unmounted while the request ran.
      if (options.frame()?.contentWindow === source) source.postMessage(response, options.origin)
    }
    options.handle(request).then(
      (result) => reply({seedPage: DOCUMENT_PAGE_PROTOCOL, id: request.id, result}),
      (error) =>
        reply({
          seedPage: DOCUMENT_PAGE_PROTOCOL,
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        }),
    )
  }
}

/** How the host page turns a document page into a page URL it can embed. */
export type DocumentPagePlatform = (
  | {
      /** Resolves the page URL for a document's page folder, registering it with the host if needed. */
      /** Release a page launch and its native storage when the frame closes. */
      closePageUrl?: (url: string) => Promise<void>
      resolvePageUrl: (input: {id: string; cid: string; account: string | null}) => Promise<string>
    }
  | {
      /** Fetches an authorized, revision-pinned HTML entry point for the opaque web sandbox. */
      loadPageHtml: (input: {id: string; cid: string; version: string}, signal: AbortSignal) => Promise<string>
    }
) & {
  /** Open an explicit web address without rewriting its server to the current HM gateway. */
  openExternalUrl?: (url: string, newWindow: boolean) => void
}

let platform: DocumentPagePlatform | null = null

/** Install the platform's document-page runtime. */
export function setDocumentPagePlatform(next: DocumentPagePlatform | null) {
  platform = next
}

/** Return the current platform's document-page runtime. */
export function getDocumentPagePlatform(): DocumentPagePlatform | null {
  return platform
}

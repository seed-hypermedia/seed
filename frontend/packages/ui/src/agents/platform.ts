import type {HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type * as blobs from '@shm/shared/blobs'
import type {NavRoute} from '@shm/shared/routes'
import type {NavMode} from '@shm/shared/utils/navigation'
import type * as React from 'react'

/** Collects rich editor content, letting the caller prepare binary attachments. */
export type AgentsRichEditorGetContent = (
  prepareAttachments: (binaries: Uint8Array[]) => Promise<{
    blobs: {cid: string; data: Uint8Array}[]
    resultCIDs: string[]
  }>,
) => Promise<{
  blockNodes: HMBlockNode[]
  blobs: {cid: string; data: Uint8Array}[]
}>

/** Imperative handle exposed by the injected rich editor. */
export type AgentsRichEditorSubmitHandle = {
  submit: () => void
  reset: () => void
  focus: (options?: {moveCursorToEnd?: boolean}) => void
  /** Emits any pending (debounced) content change synchronously. */
  flush: () => void
  getContent: AgentsRichEditorGetContent
}

/** One attachment the injected editor uploaded on the agents UI's behalf. */
export type AgentsRichEditorAttachment = {
  displaySrc: string
  url?: string
  fileBinary?: Uint8Array
  mediaRef?: {
    draftId: string
    mediaId: string
    name: string
    mime: string
    size: number
  }
}

/**
 * Props the agents UI passes to the injected rich block editor. This is a structural subset of
 * `CommentEditor` from `@shm/editor/comment-editor`; the component is injected through the platform
 * because `@shm/editor` depends on `@shm/ui`, so importing it here would create a package cycle.
 */
export type AgentsRichEditorProps = {
  submitButton: (opts: {reset: () => void; getContent: AgentsRichEditorGetContent}) => React.ReactElement
  handleSubmit: (getContent: AgentsRichEditorGetContent, reset: () => void) => void
  focusOnMount?: boolean
  hideAvatar?: boolean
  hideSubmitToolbar?: boolean
  disableTrailingNode?: boolean
  submitOnEnter?: boolean
  submitHandleRef?: React.MutableRefObject<AgentsRichEditorSubmitHandle | null>
  initialBlocks?: HMBlockNode[]
  onContentChange?: (blocks: HMBlockNode[]) => void
  handleFileAttachment?: (file: File) => Promise<AgentsRichEditorAttachment>
}

/**
 * Sign-in affordance for the case where no account can sign agent actions.
 *
 * Agent servers only accept signed requests, so the agents UI is unusable without an account. How
 * the user gets one is app-specific (desktop opens its auth dialog; web has its own login), so the
 * shared no-account page renders this instead of owning it.
 */
export type AgentsSignInPrompt = {
  /** True when the app has accounts but none is selected — the user picks one instead of signing in. */
  hasAccounts: boolean
  /** Opens the app's sign-in flow. Omitted when the app offers none. */
  signIn?: () => void
  /** Dialog element the app needs mounted for {@link signIn} to render. */
  dialog?: React.ReactNode
}

/**
 * Loopback listener that catches a provider OAuth redirect.
 *
 * Provider OAuth clients redirect to a fixed `localhost` port on the user's machine — not to the
 * (possibly remote) agent server — so an app that can open a local socket catches the redirect and
 * hands it back to the agents UI. Apps that cannot (the browser) omit this, and the sign-in falls
 * back to the user pasting the redirect URL.
 */
export type AgentsOAuthRedirectCatcher = {
  /** Starts listening; `state` ties a captured redirect to this specific sign-in. */
  start: (state: string | null) => Promise<{listening: boolean}>
  /** The captured redirect URL, once the browser has come back. */
  captured: () => Promise<{url: string | null}>
  /** Stops listening (sign-in finished, canceled, or abandoned). */
  stop: () => Promise<void>
}

/**
 * Host-app integration surface for the shared Agents UI.
 *
 * The agents client, models, and pages are platform-neutral; everything that differs between the
 * desktop app (Electron: daemon signing, trpc app settings, embedded local node) and the web app
 * (WebCrypto device key, localStorage, no local node) is injected here. Hook-valued members are
 * safe to store on a singleton because the platform is registered once at app startup, before any
 * agents UI renders, and never swapped afterwards.
 */
/** A published Capability by which an account delegated agent actions to the platform's signing key. */
export type AgentsSignerDelegation = {
  /** CID of the Capability blob (the account's signature over the delegation). */
  capabilityCid: string
  /** The blob's raw bytes when the platform holds them, so servers need not fetch them. */
  capabilityBlob?: Uint8Array
}

export type AgentsPlatform = {
  /** Built-in default agent server URL for this runtime, or null when there is none. */
  defaultServerUrl: () => string | null
  /** Returns a signer whose principal is the given account, used to sign agent actions. */
  getSigner: (accountUid: string) => Promise<blobs.Signer>
  /**
   * The delegation by which {@link getSigner}'s key acts for `accountUid` when it is not that
   * account's own key (web: the vault account delegated to the local device key). It rides inside
   * every signed envelope so any agent server can verify it without prior registration. Omitted
   * on platforms whose signing key is the account itself (desktop's daemon signing); returning
   * null means the key holds no delegation for that account.
   */
  getDelegation?: (accountUid: string) => Promise<AgentsSignerDelegation | null>
  /** Reads one persisted agents setting (JSON-compatible value) by key. */
  getSetting: (key: string) => Promise<unknown>
  /** Persists one agents setting (JSON-compatible value) by key. */
  setSetting: (key: string, value: unknown) => Promise<void>
  /** URL of an app-managed local agents server, when the platform runs one (desktop only). */
  getLocalServerUrl?: () => Promise<string | null>
  /** Asks the platform's local HM node to discover/sync a referenced hm:// resource (desktop only). */
  discoverEntity?: (id: string) => Promise<{state?: string; version?: string}>
  /**
   * Keeps a referenced hm:// resource synced on the platform's local HM node until unsubscribed
   * (desktop only).
   *
   * Distinct from {@link discoverEntity}: a one-shot discover can race the peer connection or return
   * a result cached from before the agent published, so an open session holds a live subscription
   * instead.
   */
  subscribeToEntity?: (
    params: {id: UnpackedHypermediaId; recursive: boolean},
    handlers: {onError: (error: unknown) => void},
  ) => {unsubscribe: () => void}
  /** Peers the platform's local HM node with the agent server's HM node (desktop only). */
  connectToHmServer?: (hmServerUrl: string) => Promise<{peerId: string; addrs: string[]} | null>
  /** Catches provider OAuth browser redirects on a loopback port (see {@link AgentsOAuthRedirectCatcher}). */
  oauthRedirectCatcher?: AgentsOAuthRedirectCatcher
  /** Hook returning the account UID that signs agent actions for the current user. */
  useAccountUid: () => string | null | undefined
  /** Hook returning a navigate function for NavRoutes; `spawn` opens a new window where supported. */
  useNavigate: (mode?: NavMode) => (route: NavRoute) => void
  /** Hook returning a URL opener that routes hm:// links in-app and http links externally. */
  useOpenUrl: () => (url?: string, newWindow?: boolean) => void
  /** Hook returning the configured HM gateway URL for rendering public hm:// hrefs. */
  useGatewayUrl?: () => string | undefined
  /** Hook returning the app's sign-in affordance (see {@link AgentsSignInPrompt}). */
  useSignInPrompt?: () => AgentsSignInPrompt
  /**
   * Hook returning a navigator to the app's own agent-servers settings surface (desktop's Settings
   * window). Omitted when the app has none; the agents list then manages servers in a dialog.
   */
  useOpenServerSettings?: () => () => void
  /** Rich block editor used for prompts and chat composition (see {@link AgentsRichEditorProps}). */
  CommentEditor: React.ComponentType<AgentsRichEditorProps>
  /**
   * Read-only rich block renderer for user messages (structural subset of `ReadOnlyViewer` from
   * `@shm/editor/readonly-viewer`, injected for the same cycle reason as {@link AgentsRichEditorProps}).
   * May suspend — apps typically provide a `React.lazy` wrapper, and callers wrap it in a `Suspense`
   * whose fallback renders the message as markdown. Omitting it entirely renders rich blocks as
   * nothing, so an app that shows messages must provide it.
   */
  ReadOnlyMessageViewer?: React.ComponentType<{
    blocks: HMBlockNode[]
    commentStyle?: boolean
    textUnit?: number
    layoutUnit?: number
    className?: string
  }>
}

let platform: AgentsPlatform | null = null

/** Registers the host app's platform adapter. Must run before any agents UI renders. */
export function setAgentsPlatform(value: AgentsPlatform): void {
  platform = value
}

/** Returns the registered platform adapter, or throws when the host app never registered one. */
export function getAgentsPlatform(): AgentsPlatform {
  if (!platform) {
    throw new Error('Agents platform is not registered — call setAgentsPlatform() at app startup')
  }
  return platform
}

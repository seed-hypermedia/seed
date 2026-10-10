import type * as React from 'react'

/**
 * Signs agent actions for one Seed account.
 *
 * Every request to an agents server is a signed envelope. The host owns the key: it may hold it in
 * the page (a WebCrypto or noble key pair) or keep it elsewhere and sign remotely (a local daemon
 * that only answers its own authenticated UI). The kit never sees key material, only signatures.
 */
export type SeedAgentsSigner = {
  /** The account the actions are for, as a `z6Mk…` principal string. */
  accountUid: string
  /**
   * The principal of the key that produces signatures, when it is not the account's own key (the
   * account delegated agent actions to it). Requires {@link delegation}. Defaults to `accountUid`.
   */
  signerUid?: string
  /** The Capability by which `accountUid` delegated agent actions to `signerUid`. */
  delegation?: SeedAgentsDelegation
  /** Ed25519 signature (64 bytes) by the signing key over exactly these bytes. */
  sign: (data: Uint8Array) => Promise<Uint8Array>
}

/** A published Capability by which an account delegated agent actions to another key. */
export type SeedAgentsDelegation = {
  /** CID of the Capability blob. */
  capabilityCid: string
  /** The Capability blob's raw bytes, so the agents server need not fetch it. */
  capabilityBlob?: Uint8Array
}

/** Persists small JSON values the agents UI remembers (selected models, server list, drafts). */
export type SeedAgentsSettingsStore = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
}

/** Props the agents UI passes to a rich prompt/message editor. Supplied by advanced hosts only. */
export type SeedAgentsEditorProps = {
  submitButton: (opts: {reset: () => void; getContent: SeedAgentsEditorGetContent}) => React.ReactElement
  handleSubmit: (getContent: SeedAgentsEditorGetContent, reset: () => void) => void
  focusOnMount?: boolean
  hideAvatar?: boolean
  hideSubmitToolbar?: boolean
  disableTrailingNode?: boolean
  submitOnEnter?: boolean
  submitHandleRef?: React.MutableRefObject<SeedAgentsEditorHandle | null>
  initialBlocks?: SeedAgentsBlockNode[]
  onContentChange?: (blocks: SeedAgentsBlockNode[]) => void
  handleFileAttachment?: (file: File) => Promise<{displaySrc: string; url?: string}>
}

/** Collects editor content as Seed block nodes. */
export type SeedAgentsEditorGetContent = (
  prepareAttachments: (binaries: Uint8Array[]) => Promise<{
    blobs: {cid: string; data: Uint8Array}[]
    resultCIDs: string[]
  }>,
) => Promise<{blockNodes: SeedAgentsBlockNode[]; blobs: {cid: string; data: Uint8Array}[]}>

/** Imperative handle a rich editor exposes to the composer. */
export type SeedAgentsEditorHandle = {
  submit: () => void
  reset: () => void
  focus: (options?: {moveCursorToEnd?: boolean}) => void
  flush: () => void
  getContent: SeedAgentsEditorGetContent
}

/** A Seed document block with its children (the `HMBlockNode` shape of `@seed-hypermedia/client`). */
export type SeedAgentsBlockNode = {
  block: {id: string; type: string; text?: string; link?: string; [key: string]: unknown}
  children?: SeedAgentsBlockNode[]
}

/** How a navigation should land: in place, replacing the current entry, or in a new window. */
export type SeedAgentsNavigationMode = 'push' | 'replace' | 'spawn'

/**
 * Everything the agents UI needs from the app that embeds it.
 *
 * Only {@link serverUrl} and {@link signer} are required. The rest have browser defaults: settings
 * in localStorage, links opened in a new tab, Seed's own block editor, and Seed's public gateway
 * for account names, avatars and hm:// links.
 */
export type SeedAgentsHost = {
  /**
   * Base URL of the agents server, as the browser can reach it. The kit calls
   * `<serverUrl>/api/message`, `<serverUrl>/agents/ws` and `<serverUrl>/agents/api/*`, so a host
   * may point this at its own reverse proxy of an agents server.
   */
  serverUrl: string
  /** Signs agent actions. `null` while the host has no account; the kit then shows a sign-in notice. */
  signer: SeedAgentsSigner | null
  /**
   * Seed HTTP API used to resolve accounts and documents mentioned in the UI (names, avatars, link
   * previews), e.g. `https://hyper.media`. Defaults to {@link gatewayUrl}.
   */
  hmApiUrl?: string
  /** Public web origin used for hm:// hrefs. Defaults to `https://hyper.media`. */
  gatewayUrl?: string
  /** Where agent settings persist. Defaults to localStorage under `seed.agents.setting.`. */
  settings?: SeedAgentsSettingsStore
  /** Opens a link that leaves the agents UI (http(s) or hm://). Defaults to a new browser tab. */
  openUrl?: (url: string, newWindow?: boolean) => void
  /** Starts the host's sign-in flow when {@link signer} is null. */
  signIn?: () => void
  /** Opens the host's own agent-server settings. Without it, the agents list manages servers in a dialog. */
  openServerSettings?: () => void
  /**
   * Replaces Seed's block editor (`CommentEditor`, loaded on first use) in the composer and the
   * prompt editors. It must round-trip every block it is given: prompts may hold embeds.
   */
  Editor?: React.ComponentType<SeedAgentsEditorProps>
  /** Replaces Seed's read-only block viewer for rich user messages. */
  MessageViewer?: React.ComponentType<{blocks: SeedAgentsBlockNode[]; className?: string}>
}

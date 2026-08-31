/**
 * Platform adapter for the extension host. Each app (web, desktop) provides one
 * of these at the top of an extension page; everything else in the host is
 * platform-agnostic. Reads and writes are NOT here — they go through the
 * existing `useUniversalClient()` (`request`, `getSigner`, `publish`,
 * `publishDocument`), which both apps already implement.
 *
 * See docs/extensions/design.md §4.1.
 */

import {createContext, useContext, type ReactNode} from 'react'

export type ExtensionHostUser = {accountId: string; name?: string}

export type ExtensionHostAdapter = {
  platform: 'web' | 'desktop'
  /** Signed-in viewer for this site, or null. Re-render the provider when it changes. */
  user: ExtensionHostUser | null
  theme: 'light' | 'dark'
  /** Public origin of the site when known (web only). */
  siteOrigin?: string
  /** Fetch the entry HTML by CID. web: /hm/api/file/<cid>; desktop: <daemon http>/ipfs/<cid>. */
  fetchEntryHtml: (cid: string) => Promise<string>
  /** URL an iframe can use for a CID (web: absolute /hm/api/file/<cid>; desktop: daemon URL). */
  fileUrl: (cid: string) => string
  /** Read a file's bytes through the host (for iframes that cannot fetch directly). */
  readFile: (cid: string, maxBytes: number) => Promise<{bytes: Uint8Array; contentType?: string}>
  /** Navigate the host app to an hm:// URL or a site-relative path. */
  navigate: (url: string, opts: {replace?: boolean}) => void
  /** Open an external http(s) URL in a new tab / the system browser. */
  openExternal: (url: string) => void
  /** Update the URL beneath the mount without leaving the page. */
  setRoute: (subPath: string[], query: Record<string, string> | undefined, opts: {replace?: boolean}) => void
  toast: (message: string, kind: 'info' | 'success' | 'error') => void
  /** Storage used for `storage.*` and dev overrides. Defaults to `window.localStorage` when available. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
}

const ExtensionHostContext = createContext<ExtensionHostAdapter | null>(null)

export function ExtensionHostProvider({adapter, children}: {adapter: ExtensionHostAdapter; children: ReactNode}) {
  return <ExtensionHostContext.Provider value={adapter}>{children}</ExtensionHostContext.Provider>
}

export function useExtensionHost(): ExtensionHostAdapter {
  const ctx = useContext(ExtensionHostContext)
  if (!ctx) {
    throw new Error('useExtensionHost must be used inside an ExtensionHostProvider')
  }
  return ctx
}

export function useExtensionHostOrNull(): ExtensionHostAdapter | null {
  return useContext(ExtensionHostContext)
}

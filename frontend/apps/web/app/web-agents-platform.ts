import {keyPairStore, useCreateAccount, useLocalKeyPair} from '@/auth'
import {getStoredLocalKeys} from '@/local-db'
import {CommentEditor} from '@shm/editor/comment-editor'
import {routeToHref, useUniversalAppContext} from '@shm/shared'
import * as blobs from '@shm/shared/blobs'
import {SEED_AGENT_SERVER_URL} from '@shm/shared/constants'
import type {NavRoute} from '@shm/shared/routes'
import type {NavMode} from '@shm/shared/utils/navigation'
import {setAgentsPlatform, type AgentsSignerDelegation} from '@shm/ui/agents/platform'
import React, {useCallback} from 'react'

/**
 * Web adapter for the shared Agents UI in @shm/ui/agents.
 *
 * Signing uses the local web identity (non-extractable WebCrypto Ed25519 device key in IndexedDB).
 * When the vault delegated an account to this device key, the device signs envelopes *as that
 * account* — so web and desktop see the same agents — and {@link getWebAgentsDelegation} names the
 * vault-issued Capability in every envelope so any agent server can verify the delegation itself.
 * Without a delegation the device key is its own account, as before.
 */
async function getWebAgentsSigner(accountUid: string): Promise<blobs.Signer> {
  const stored = await getStoredLocalKeys()
  const keyPair: CryptoKeyPair | null = keyPairStore.get() ?? stored?.keyPair ?? null
  if (!keyPair) throw new Error('Sign in to use agents: no local web identity is available')
  const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const signer = new blobs.WebCryptoKeyPair(keyPair, rawPublicKey)
  const devicePrincipal = blobs.principalToString(signer.principal)
  if (devicePrincipal !== accountUid && stored?.delegatedAccountUid !== accountUid) {
    throw new Error('Agents actions must be signed by the local web identity')
  }
  return signer
}

/**
 * The vault-issued delegation this device key holds for `accountUid` (see the platform seam's
 * getDelegation).
 *
 * The CID has been stored at sign-in since web auth shipped; the blob bytes only since agents
 * came to web, so older sessions hand out the CID alone and the agent server fetches the published
 * blob from its own HM node. Nothing here touches the network.
 */
async function getWebAgentsDelegation(accountUid: string): Promise<AgentsSignerDelegation | null> {
  const stored = await getStoredLocalKeys()
  if (!stored?.delegatedAccountUid || stored.delegatedAccountUid !== accountUid || !stored.capabilityCid) {
    return null
  }
  return {capabilityCid: stored.capabilityCid, capabilityBlob: stored.capabilityBlob}
}

const SETTING_STORAGE_PREFIX = 'seed.agents.setting.'

function settingStorageKey(key: string): string {
  return `${SETTING_STORAGE_PREFIX}${key}`
}

function useWebAgentsNavigate(mode: NavMode = 'push') {
  const {openRoute, originHomeId} = useUniversalAppContext()
  return useCallback(
    (route: NavRoute) => {
      if (mode === 'spawn') {
        const href = routeToHref(route, {originHomeId})
        if (href) window.open(href, '_blank')
        return
      }
      openRoute?.(route, mode === 'replace' || mode === 'backplace')
    },
    [openRoute, originHomeId, mode],
  )
}

function useWebAgentsOpenUrl() {
  const {openUrl} = useUniversalAppContext()
  return useCallback(
    (url?: string, newWindow?: boolean) => {
      if (!url) return
      openUrl(url, newWindow)
    },
    [openUrl],
  )
}

/**
 * Public host for hm:// links the agent writes into chat.
 *
 * `origin` is this deployment's own web URL, which is what a reader should land on; without it the
 * shared renderer falls back to the default gateway and a self-hosted site would hand out
 * hyper.media hrefs. Only the href is affected — clicks are intercepted and routed in-app either
 * way — so this matters for hover, copy-link, and open-in-new-tab.
 */
function useWebAgentsGatewayUrl(): string | undefined {
  return useUniversalAppContext().origin ?? undefined
}

/**
 * The web sign-in affordance for the shared no-account page.
 *
 * `hasAccounts` stays false because the web app has no account picker: an identity either exists
 * (and is therefore the selected one) or the user has to sign in. Reporting true would render the
 * desktop copy telling the user to choose an account from a menu that does not exist here.
 */
function useWebSignInPrompt() {
  const {createAccount, content} = useCreateAccount({})
  return {
    hasAccounts: false,
    signIn: () => createAccount({source: 'login'}),
    dialog: content,
  }
}

let registered = false

/** Registers the web adapter for the shared Agents UI. Safe to call more than once. */
export function registerWebAgentsPlatform() {
  if (registered) return
  registered = true
  setAgentsPlatform({
    defaultServerUrl: () => SEED_AGENT_SERVER_URL ?? null,
    getSigner: getWebAgentsSigner,
    getDelegation: getWebAgentsDelegation,
    getSetting: async (key: string) => {
      if (typeof window === 'undefined') return null
      const raw = window.localStorage.getItem(settingStorageKey(key))
      if (raw == null) return null
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    },
    setSetting: async (key: string, value: unknown) => {
      if (typeof window === 'undefined') return
      if (value === undefined || value === null) {
        window.localStorage.removeItem(settingStorageKey(key))
        return
      }
      window.localStorage.setItem(settingStorageKey(key), JSON.stringify(value))
    },
    // The vault-delegated account when one exists — the same identity desktop signs as, so both
    // surfaces see the same agents — else the device key is its own account.
    useAccountUid: () => {
      const keyPair = useLocalKeyPair()
      return keyPair?.delegatedAccountUid ?? keyPair?.id ?? null
    },
    useNavigate: useWebAgentsNavigate,
    useOpenUrl: useWebAgentsOpenUrl,
    useGatewayUrl: useWebAgentsGatewayUrl,
    useSignInPrompt: useWebSignInPrompt,
    CommentEditor,
    ReadOnlyMessageViewer: React.lazy(() =>
      import('@shm/editor/readonly-viewer').then((module) => ({default: module.ReadOnlyViewer})),
    ),
    // Omitted deliberately — the browser has none of these, and every consumer guards on absence:
    // getLocalServerUrl (no app-managed server), discoverEntity / subscribeToEntity /
    // connectToHmServer (no local HM node), oauthRedirectCatcher (cannot open a loopback socket,
    // so subscription "Sign in with ChatGPT" is never offered on web — API keys only).
  })
}

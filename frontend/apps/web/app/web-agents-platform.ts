import {keyPairStore, useCreateAccount, useLocalKeyPair} from '@/auth'
import {getStoredLocalKeys} from '@/local-db'
import {CommentEditor} from '@shm/editor/comment-editor'
import {routeToHref, useUniversalAppContext} from '@shm/shared'
import * as blobs from '@shm/shared/blobs'
import {SEED_AGENT_SERVER_URL} from '@shm/shared/constants'
import type {NavRoute} from '@shm/shared/routes'
import type {NavMode} from '@shm/shared/utils/navigation'
import {setAgentsPlatform} from '@shm/ui/agents/platform'
import React, {useCallback} from 'react'

/**
 * Web adapter for the shared Agents UI in @shm/ui/agents.
 *
 * Signing uses the local web identity (non-extractable WebCrypto Ed25519 device key in IndexedDB).
 * The agents server only accepts envelopes where the signer is the account — it has no delegation
 * registration API yet — so on web the device key *is* the agents account; `useAccountUid` returns
 * the device key's principal rather than the vault-delegated account UID.
 */
async function getWebAgentsSigner(accountUid: string): Promise<blobs.Signer> {
  const keyPair: CryptoKeyPair | null = keyPairStore.get() ?? (await getStoredLocalKeys())?.keyPair ?? null
  if (!keyPair) throw new Error('Sign in to use agents: no local web identity is available')
  const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey))
  const signer = new blobs.WebCryptoKeyPair(keyPair, rawPublicKey)
  if (blobs.principalToString(signer.principal) !== accountUid) {
    throw new Error('Agents actions must be signed by the local web identity')
  }
  return signer
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
    // The device key is the agents account on web (see module docs), so the account UID is the
    // local web identity's principal.
    useAccountUid: () => useLocalKeyPair()?.id ?? null,
    useNavigate: useWebAgentsNavigate,
    useOpenUrl: useWebAgentsOpenUrl,
    useSignInPrompt: useWebSignInPrompt,
    CommentEditor,
    ReadOnlyMessageViewer: React.lazy(() =>
      import('@shm/editor/readonly-viewer').then((module) => ({default: module.ReadOnlyViewer})),
    ),
    // Omitted deliberately — the browser has none of these, and every consumer guards on absence:
    // getLocalServerUrl (no app-managed server), discoverEntity / subscribeToEntity /
    // connectToHmServer (no local HM node), oauthRedirectCatcher (cannot open a loopback socket;
    // sign-in falls back to pasting the redirect URL).
  })
}

/**
 * Mobile adapter for the shared Agents stack in `@shm/ui/agents`.
 *
 * The agents client, React Query models, and chat row model are platform-neutral and shared with
 * desktop and web; everything that differs per runtime is injected through this seam. Mobile's
 * differences from the other two:
 *
 *   - **Signing.** The vault holds the mnemonic-derived account key itself, so mobile signs agent
 *     envelopes *as the account* — the same position desktop is in with its daemon. `registerSigner`
 *     is therefore omitted; only web needs it, to prove that its delegated device key may act for
 *     the account.
 *   - **No local node.** Like web, mobile runs no HM daemon and no app-managed agents server, so
 *     `getLocalServerUrl`, `discoverEntity`, `subscribeToEntity` and `connectToHmServer` are all
 *     omitted. Every consumer guards on their absence.
 *   - **No block editor.** The shared rich composer is a web component; mobile writes its own
 *     React Native composer and submits plain markdown, which `MessageSessionContentPart` accepts
 *     (its `blocks` field is optional).
 */

import type {NavRoute} from '@shm/shared/routes'
import type {NavMode} from '@shm/shared/utils/navigation'
import {toPrincipalSigner, type PrincipalSigner} from '@seed-hypermedia/client/signer'
import {setAgentsPlatform, type AgentsPlatform} from '@shm/ui/agents/platform'
import {useEffect, useState} from 'react'
import {Linking} from 'react-native'
import {getVaultManager} from '../vault'
import {getStorageItem, removeStorageItem, setStorageItem} from '../store/storage'
import {openDocument} from '../components/doc-navigation'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'

/**
 * Built-in agents server for this build.
 *
 * `SEED_AGENT_SERVER_URL` in @shm/shared/constants falls back to `http://localhost:3051` outside
 * production, which is meaningless on a phone — loopback there is the device itself. Mobile takes
 * the hosted server by default and lets a dev point at their own machine's LAN address through the
 * Expo env var. Either way the user can change it; the value is only the first suggestion.
 */
const DEFAULT_AGENT_SERVER_URL = process.env.EXPO_PUBLIC_SEED_AGENT_SERVER_URL || 'https://agentic.seed.hyper.media'

const SETTING_KEY_PREFIX = 'agents_setting:'

/**
 * The account that signs agent actions: the vault's active identity.
 *
 * Re-reads on every vault change, so switching identity in the sidebar re-points the whole agents
 * UI at that account's agents — the agent server scopes all state by signing account.
 */
function useVaultAccountUid(): string | null | undefined {
  // `undefined` means "still loading" and `null` means "no identity"; the shared UI distinguishes
  // them to avoid flashing a sign-in prompt before the vault has opened.
  const [accountUid, setAccountUid] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    getVaultManager()
      .then((manager) => {
        if (cancelled) return
        const read = () => setAccountUid(manager.getCurrentIdentity()?.accountId ?? null)
        read()
        unsubscribe = manager.subscribe(read)
      })
      .catch(() => {
        if (!cancelled) setAccountUid(null)
      })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return accountUid
}

/** Resolves the vault signer for an account, in the principal-bearing shape the client signs with. */
async function getVaultSigner(accountUid: string): Promise<PrincipalSigner> {
  const manager = await getVaultManager()
  // VaultManager hands out the `getPublicKey()` shape; the agents envelope needs the principal
  // synchronously. The conversion touches no key material — it just resolves and caches the
  // public key.
  return toPrincipalSigner(manager.getSigner(accountUid))
}

/**
 * Opens a URL the way the app should: `hm://` documents route to the Document screen, everything
 * else goes to the system browser.
 */
export function openUrlOnMobile(url?: string): void {
  if (!url) return
  const id = url.startsWith('hm://') ? unpackHmId(url) : null
  if (id) {
    openDocument(id)
    return
  }
  void Linking.openURL(url).catch(() => {
    // A malformed or unsupported scheme is the link's problem, not a crash for the reader.
  })
}

/** Maps the shared NavRoute vocabulary onto mobile's stack screens. */
function navigateToRoute(route: NavRoute): void {
  switch (route.key) {
    case 'document':
      openDocument(route.id)
      return
    default:
      // Mobile has no screen for the remaining desktop routes (drafts, settings panels, explore).
      // Dropping the navigation is the honest outcome; the caller's row simply does not move.
      return
  }
}

let registered = false

/** Registers the mobile adapter. Safe to call more than once; must run before any agents UI renders. */
export function registerMobileAgentsPlatform(): void {
  if (registered) return
  registered = true

  const platform: AgentsPlatform = {
    defaultServerUrl: () => DEFAULT_AGENT_SERVER_URL,
    getSigner: getVaultSigner,
    getSetting: async (key) => getStorageItem<unknown>(SETTING_KEY_PREFIX + key),
    setSetting: async (key, value) => {
      if (value === undefined || value === null) {
        removeStorageItem(SETTING_KEY_PREFIX + key)
        return
      }
      setStorageItem(SETTING_KEY_PREFIX + key, value)
    },
    useAccountUid: useVaultAccountUid,
    useNavigate: (_mode?: NavMode) => navigateToRoute,
    useOpenUrl: () => openUrlOnMobile,
    // Required by the seam but never rendered here: the shared rich composer is a web component,
    // and mobile's composer is its own React Native view. Throwing rather than rendering nothing
    // makes an accidental import of a shared .tsx page fail loudly instead of showing a dead box.
    CommentEditor: () => {
      throw new Error('The shared rich block editor is web-only; mobile composes with its own React Native editor')
    },
    // Omitted deliberately — mobile has none of these:
    // registerSigner (the vault key IS the account), getLocalServerUrl (no app-managed server),
    // discoverEntity / subscribeToEntity / connectToHmServer (no local HM node),
    // oauthRedirectCatcher (cannot open a loopback socket; provider sign-in falls back to pasting
    // the redirect URL).
  }

  setAgentsPlatform(platform)
}

import {useNavigate} from '@remix-run/react'
import {createSeedClient} from '@seed-hypermedia/client'
import {HMDocument, HMPrepareDocumentChangeInput, HMSigner} from '@seed-hypermedia/client/hm-types'
import {hmId, hostnameStripProtocol, queryKeys, useUniversalAppContext} from '@shm/shared'
import {WEB_IDENTITY_ORIGIN} from '@shm/shared/constants'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {useTx, useTxString} from '@shm/shared/translation'
import {Button} from '@shm/ui/button'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {EditProfileForm, SiteMetaFields} from '@shm/ui/edit-profile-form'
import {SeedLogo} from '@shm/ui/seed-logo'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useMutation} from '@tanstack/react-query'
import {LogOut, Settings} from 'lucide-react'
import {base58btc} from 'multiformats/bases/base58'
import {useEffect, useRef, useState, useSyncExternalStore} from 'react'
import {encodeBlock, rawCodec} from './api'
import * as authSession from './auth-session'
import {preparePublicKey, signWithKeyPair} from './auth-utils'
import {
  AUTH_STATE_DELEGATION_RETURN_URL,
  AUTH_STATE_DELEGATION_VAULT_URL,
  clearAllAuthState,
  deleteLocalKeys,
  getPendingIntent,
  getStoredLocalKeys,
  setAuthState,
  setHasPromptedEmailNotifications,
  setPendingIntent,
} from './local-db'
import {reportError} from './report-error'
import {getVaultAccountSettingsUrl} from './vault-links'

const seedClient = createSeedClient('')

function createSignerFromKeyPair(kp: CryptoKeyPair): HMSigner {
  return {
    getPublicKey: async () => preparePublicKey(kp.publicKey),
    sign: async (data: Uint8Array) => {
      return signWithKeyPair(kp, new Uint8Array(data))
    },
  }
}

export async function getCurrentSigner(): Promise<HMSigner | null> {
  const stored = await getStoredLocalKeys()
  if (!stored) return null
  return createSignerFromKeyPair(stored.keyPair)
}

export type LocalWebIdentity = CryptoKeyPair & {
  id: string
  delegatedAccountUid?: string
  capabilityCid?: string
  vaultUrl?: string
  notifyServerUrl?: string
}
let keyPair: LocalWebIdentity | null = null
// Whether the first attempt to load the local identity from IndexedDB has
// completed. Before this flips true we cannot tell "logged out" apart from
// "keys still loading" — consumers that must not act on a premature null
// (e.g. draft resolution) gate on this via `useLocalKeyPairLoaded`.
let keyPairLoaded = false
const keyPairHandlers = new Set<() => void>()

export async function getCurrentAccountUidWithDelegation(): Promise<string | null> {
  const stored = await getStoredLocalKeys()
  return stored?.delegatedAccountUid ?? keyPair?.id ?? null
}

export const keyPairStore = {
  get: () => keyPair,
  set: (kp: LocalWebIdentity | null) => {
    keyPair = kp
    keyPairHandlers.forEach((callback) => callback())
  },
  subscribe: (handler: () => void) => {
    keyPairHandlers.add(handler)
    return () => {
      keyPairHandlers.delete(handler)
    }
  },
}

async function loadLocalWebIdentity(): Promise<LocalWebIdentity | null> {
  const stored = await getStoredLocalKeys()
  if (!stored) return null
  const id = await preparePublicKey(stored.keyPair.publicKey)
  return {
    ...stored.keyPair,
    id: base58btc.encode(id),
    delegatedAccountUid: stored.delegatedAccountUid,
    capabilityCid: stored.capabilityCid,
    vaultUrl: stored.vaultUrl,
    notifyServerUrl: stored.notifyServerUrl,
  }
}

function syncKeyPair(newKeyPair: LocalWebIdentity | null) {
  if (
    (!newKeyPair && keyPair) ||
    newKeyPair?.id !== keyPair?.id ||
    newKeyPair?.delegatedAccountUid !== keyPair?.delegatedAccountUid ||
    newKeyPair?.capabilityCid !== keyPair?.capabilityCid ||
    newKeyPair?.vaultUrl !== keyPair?.vaultUrl ||
    newKeyPair?.notifyServerUrl !== keyPair?.notifyServerUrl
  ) {
    keyPairStore.set(newKeyPair)
  }
}

function markKeyPairLoaded() {
  if (keyPairLoaded) return
  keyPairLoaded = true
  keyPairHandlers.forEach((callback) => callback())
}

function updateKeyPair() {
  loadLocalWebIdentity()
    .then((next) => {
      syncKeyPair(next)
      markKeyPairLoaded()
    })
    .catch((err) => {
      // Even on failure we've settled the initial load: treat as "no identity"
      // rather than hanging draft resolution forever.
      markKeyPairLoaded()
      console.error(err)
      reportError(err, {feature: 'auth', operation: 'load-local-identity'})
    })
}

export function logout() {
  const vaultUrl = keyPairStore.get()?.vaultUrl
  keyPairStore.set(null)
  Promise.all([
    deleteLocalKeys(),
    setHasPromptedEmailNotifications(false),
    vaultUrl ? authSession.clearSession(vaultUrl) : Promise.resolve(),
    clearAllAuthState(),
    fetch('/hm/api/auth', {method: 'DELETE', credentials: 'include'}).catch((e) => {
      console.error('Failed to clear daemon auth cookie', e)
      reportError(e, {feature: 'auth', operation: 'logout-clear-daemon-cookie'})
    }),
  ])
    .then(() => {
      updateKeyPair()
    })
    .catch((e) => {
      console.error('Failed to log out', e)
      reportError(e, {feature: 'auth', operation: 'logout'})
    })
}

export function useLocalKeyPair() {
  return useSyncExternalStore(
    (callback: () => void) => {
      keyPairHandlers.add(callback)
      return () => {
        keyPairHandlers.delete(callback)
      }
    },
    () => keyPair,
    () => null,
  )
}

/**
 * True once the initial IndexedDB identity load has settled (whether it found an
 * identity or not). Use this to avoid treating the pre-load `null` keyPair as
 * "logged out". Always false during SSR.
 */
export function useLocalKeyPairLoaded() {
  return useSyncExternalStore(
    (callback: () => void) => {
      keyPairHandlers.add(callback)
      return () => {
        keyPairHandlers.delete(callback)
      }
    },
    () => keyPairLoaded,
    () => false,
  )
}

export async function updateProfile({
  keyPair,
  document,
  updates,
}: {
  keyPair: CryptoKeyPair
  document: HMDocument
  updates: SiteMetaFields
}) {
  const signer = createSignerFromKeyPair(keyPair)
  const changes: HMPrepareDocumentChangeInput['changes'] = []
  if (updates.name && updates.name !== document.metadata.name) {
    changes.push({op: {case: 'setMetadata', value: {key: 'name', value: updates.name}}})
  }
  if (updates.icon && typeof updates.icon !== 'string') {
    const iconBlock = await encodeBlock(await updates.icon.arrayBuffer(), rawCodec)
    await seedClient.publish({
      blobs: [{data: iconBlock.bytes, cid: iconBlock.cid.toString()}],
    })
    changes.push({op: {case: 'setMetadata', value: {key: 'icon', value: iconBlock.cid.toString()}}})
  }
  await seedClient.publishDocument(
    {
      account: document.account,
      changes,
      baseVersion: document.version,
      genesis: document.genesis,
      generation: document.generationInfo?.generation,
    },
    signer,
  )
}

type CreateAccountDialogInput = {
  source?: 'join' | 'login'
}

export function useCreateAccount(options?: {onClose?: () => void}) {
  const userKeyPair = useLocalKeyPair()
  const isMobileKeyboardOpen = useIsMobileKeyboardOpen()

  const createAccountDialog = useAppDialog(CreateAccountDialog, {
    onClose: options?.onClose,
    className: [
      'w-full sm:max-w-xl',
      'max-sm:w-[calc(100%-1.5rem)]',
      'max-sm:translate-y-0',
      isMobileKeyboardOpen ? 'max-sm:top-[1.5vh] max-sm:max-h-[55vh]' : 'max-sm:top-[4vh] max-sm:max-h-[85vh]',
    ].join(' '),
    contentClassName: [
      'max-sm:scroll-py-4',
      isMobileKeyboardOpen ? 'max-sm:gap-3 max-sm:p-4' : 'max-sm:gap-4 max-sm:p-5',
    ].join(' '),
  })
  return {
    canCreateAccount: !userKeyPair,
    createAccount: (input?: CreateAccountDialogInput) => createAccountDialog.open({source: input?.source ?? 'login'}),
    content: createAccountDialog.content,
    userKeyPair,
  }
}

function useIsMobileKeyboardOpen() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleResize = () => {
      const layoutViewportHeight = window.innerHeight
      const visualViewportHeight = window.visualViewport?.height ?? layoutViewportHeight
      setIsOpen(layoutViewportHeight - visualViewportHeight > 150)
    }

    const visualViewport = window.visualViewport
    visualViewport?.addEventListener('resize', handleResize)
    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)
    handleResize()

    return () => {
      visualViewport?.removeEventListener('resize', handleResize)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [])

  return isOpen
}

/** Display name of the current site from its home document, falling back to the hostname. */
function useSiteName() {
  const {origin, originHomeId} = useUniversalAppContext()
  const homeResource = useResource(originHomeId)
  const homeDocument = homeResource.data?.type === 'document' ? homeResource.data.document : null
  return homeDocument?.metadata?.name || hostnameStripProtocol(origin) || 'this site'
}

function CreateAccountDialog({input}: {input: CreateAccountDialogInput; onClose: () => void}) {
  const {origin, originHomeId} = useUniversalAppContext()
  const tx = useTxString()
  const siteName = useSiteName()
  const defaultVaultOrigin = WEB_IDENTITY_ORIGIN || origin || 'http://localhost'
  const defaultVaultUrl = `${defaultVaultOrigin}/vault/delegate`
  const [customVaultUrl, setCustomVaultUrl] = useState('https://hyper.media')
  const [showCustomVaultInput, setShowCustomVaultInput] = useState(false)
  const customVaultInputRef = useRef<HTMLInputElement>(null)

  const handleVaultSignIn = async (urlOverride?: string, email?: string) => {
    const vaultUrl = urlOverride || defaultVaultUrl
    const source = input.source ?? 'login'
    await setAuthState(
      AUTH_STATE_DELEGATION_RETURN_URL,
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    )
    await setAuthState(AUTH_STATE_DELEGATION_VAULT_URL, vaultUrl)
    const existingIntent = await getPendingIntent()
    console.log('[handleVaultSignIn] existingIntent:', existingIntent)
    console.log('[handleVaultSignIn] originHomeId:', originHomeId)
    console.log('[handleVaultSignIn] source:', source)
    if (source === 'join' && !existingIntent && originHomeId?.uid) {
      await setPendingIntent({type: 'join', subjectUid: originHomeId.uid})
    }
    try {
      const authUrl = await authSession.startAuth({
        vaultUrl,
        clientId: origin || window.location.origin,
        redirectUri: `${origin || window.location.origin}/hm/auth/callback`,
        email: email || undefined,
        siteName,
      })
      window.location.href = authUrl
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const isJoin = input.source === 'join'

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-full bg-emerald-600">
          <SeedLogo className="size-4 text-white" />
        </div>
        <span className="font-semibold">Hypermedia</span>
      </div>
      <DialogTitle className="max-sm:text-base">
        {isJoin ? tx('join_site', ({siteName}) => `Join ${siteName}`, {siteName}) : tx('sign_in', 'Sign in')}
      </DialogTitle>

      <DialogDescription className="max-sm:text-sm">
        {isJoin
          ? tx(
              'join_site_description',
              ({siteName}) =>
                `${siteName} is built with Hypermedia, a platform to create sites to share knowledge. Create your identity to participate, it takes two minutes.`,
              {siteName},
            )
          : 'Sign in or create your identity to get started.'}
      </DialogDescription>

      {/* <SizableText size="xs" className="text-neutral-500 dark:text-neutral-400">
                By continuing, you agree to our{' '}
                <a
                  href="https://hyper.media/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-emerald-600 underline underline-offset-2 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                >
                  Terms and Privacy Policy
                </a>
                .
              </SizableText> */}
      <Button variant="default" type="submit" size="lg" className="w-full" onClick={() => handleVaultSignIn()}>
        {tx('Create identity in Hypermedia')}
      </Button>

      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
        <span className="text-xs text-neutral-400 dark:text-neutral-500">Or</span>
        <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
      </div>

      <Button variant="outline" size="lg" className="w-full" onClick={() => handleVaultSignIn()}>
        {tx('Already have a Hypermedia identity')}
      </Button>

      <div className="text-center text-sm text-neutral-500 dark:text-neutral-400">
        <button
          type="button"
          className="cursor-pointer hover:text-neutral-700 dark:hover:text-neutral-300"
          onClick={() => setShowCustomVaultInput(true)}
        >
          {tx('I have a different identity domain')}
        </button>
      </div>

      {showCustomVaultInput && (
        <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
          <SizableText size="sm" className="font-medium">
            Identity Domain
          </SizableText>
          <input
            ref={customVaultInputRef}
            className="rounded border px-2 py-1.5 text-sm dark:bg-neutral-900"
            value={customVaultUrl}
            onChange={(e) => setCustomVaultUrl(e.target.value)}
            placeholder={defaultVaultUrl}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customVaultUrl.trim()) {
                handleVaultSignIn(customVaultUrl.trim())
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowCustomVaultInput(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={!customVaultUrl.trim()}
              onClick={() => handleVaultSignIn(customVaultUrl.trim())}
            >
              Connect
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
function VaultSuccessDialog({onClose}: {input: {variant: 'comment'}; onClose: () => void}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <>
      <DialogTitle className="flex items-center gap-2">
        You are in <span aria-hidden>🎉</span>
      </DialogTitle>
      <DialogDescription>
        You joined the site, posting your comment now...
        <br />
        This post will be signed by you and shared across the network.
      </DialogDescription>
      <div className="flex justify-center py-2">
        <Spinner />
      </div>
    </>
  )
}

/** Detects `?vault_success=...` in the URL and shows the matching dialog or toast. */
export function useVaultSuccessDialog() {
  const dialog = useAppDialog(VaultSuccessDialog)
  const siteName = useSiteName()

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    const variant = url.searchParams.get('vault_success')
    if (!variant) return

    url.searchParams.delete('vault_success')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)

    if (variant === 'comment') {
      dialog.open({variant})
      return
    }
    if (variant === 'join') {
      toast.success(`You've joined ${siteName} — you can now comment and participate`)
      return
    }
    if (variant === 'login') {
      toast.success(`Welcome to ${siteName}`)
      return
    }
    if (variant === 'welcome-back') {
      toast.success(`Welcome back to ${siteName}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteName])

  return dialog.content
}

async function optimizeImage(file: File): Promise<Blob> {
  const response = await fetch('/hm/api/site-image', {
    method: 'POST',
    body: await file.arrayBuffer(),
  })
  const signature = response.headers.get('signature')
  if (!signature) {
    throw new Error('No signature found')
  }
  if (signature !== 'SIG-TODO') {
    // todo: real signature checking.. not here but at re-upload time
    throw new Error('Invalid signature')
  }
  const contentType = response.headers.get('content-type') || 'image/png'
  const responseBlob = await response.blob()
  return new Blob([responseBlob], {type: contentType})
}

export function LogoutDialog({onClose}: {onClose: () => void}) {
  const keyPair = useLocalKeyPair()
  const account = useAccount(keyPair?.id)
  const navigate = useNavigate()
  const tx = useTx()
  if (!keyPair) return <DialogTitle>No session found</DialogTitle>
  if (account.isLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  const isAccountAliased = !!keyPair.delegatedAccountUid || account.data?.id.uid !== keyPair.id
  return (
    <>
      <DialogTitle>{tx('Really Logout?')}</DialogTitle>
      <DialogDescription>
        {isAccountAliased
          ? tx('logout_account_saved', 'This account will remain accessible on other devices.')
          : tx(
              'logout_account_not_saved',
              'This account key is not saved anywhere else. By logging out, you will lose access to this identity forever. You can always create a new account later.',
            )}
      </DialogDescription>
      <Button
        variant="destructive"
        onClick={() => {
          logout()
          onClose()
          navigate('/', {replace: true})
        }}
      >
        {isAccountAliased ? tx('Log out') : tx('Log out Forever')}
      </Button>
    </>
  )
}

export function EditProfileDialog({onClose, input}: {onClose: () => void; input: {accountUid: string}}) {
  const keyPair = useLocalKeyPair()
  const id = hmId(input.accountUid)
  const tx = useTx()
  const account = useAccount(input.accountUid)
  const accountDocument = useResource(account.data?.id)
  const document = accountDocument?.data?.type === 'document' ? accountDocument.data.document : undefined
  const update = useMutation({
    mutationFn: (updates: SiteMetaFields) => {
      if (!keyPair) {
        throw new Error('No key pair found')
      }
      if (!document) {
        throw new Error('No document found')
      }
      return updateProfile({
        keyPair,
        document: document,
        updates,
      })
    },
    onSuccess: () => {
      // invalidate the activity and discussion for all documents because they may be affected by the profile change
      invalidateQueries([queryKeys.DOCUMENT_ACTIVITY])
      invalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
      invalidateQueries([queryKeys.ENTITY, id.id])
      invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
      invalidateQueries([queryKeys.ACCOUNT])
    },
  })
  return (
    <>
      <DialogTitle>{tx('Edit Profile')}</DialogTitle>
      {account.isInitialLoading ? (
        <Spinner />
      ) : (
        <EditProfileForm
          defaultValues={{
            name: account.data?.metadata?.name || '?',
            icon: account.data?.metadata?.icon || null,
          }}
          onSubmit={(newValues) => {
            update.mutateAsync(newValues).then(() => {
              toast.success(tx('Profile updated'))
              onClose()
            })
          }}
          processImage={optimizeImage}
        />
      )}
    </>
  )
}

/** Renders the own-profile session actions shown in the account header. */
export function LogoutButton() {
  const userKeyPair = useLocalKeyPair()
  const logoutDialog = useAppDialog(LogoutDialog)
  const tx = useTxString()
  const vaultAccountSettingsUrl = getVaultAccountSettingsUrl({
    vaultUrl: userKeyPair?.vaultUrl,
    accountUid: userKeyPair?.delegatedAccountUid,
  })
  if (!userKeyPair) return null
  return (
    <>
      {vaultAccountSettingsUrl ? (
        <Button variant="outline" asChild>
          <a href={vaultAccountSettingsUrl} target="_blank" rel="noopener noreferrer">
            <Settings className="size-4" />
            {tx('Account Settings')}
          </a>
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => logoutDialog.open({})}>
        <LogOut className="size-4" />
        {tx('Logout')}
      </Button>
      {logoutDialog.content}
    </>
  )
}

export function AccountFooterActions() {
  const userKeyPair = useLocalKeyPair()
  const logoutDialog = useAppDialog(LogoutDialog)
  const editProfileDialog = useAppDialog(EditProfileDialog)

  if (!userKeyPair) return null
  return (
    <div className="flex max-w-full flex-wrap justify-end gap-2">
      {logoutDialog.content}
      {editProfileDialog.content}
    </div>
  )
}

if (typeof window !== 'undefined') {
  updateKeyPair()
  setInterval(updateKeyPair, 200)
}

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
import {Spinner} from '@shm/ui/spinner'
import {SeedLogo} from '@shm/ui/seed-logo'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useMutation} from '@tanstack/react-query'
import {LogOut, Monitor, Smartphone} from 'lucide-react'
import {base58btc} from 'multiformats/bases/base58'
import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react'
import {SubmitHandler} from 'react-hook-form'
import {encodeBlock, rawCodec} from './api'
import {createSecretTapUnlock} from './secret-tap-unlock'
import * as authSession from './auth-session'
import {preparePublicKey} from './auth-utils'
import {createDefaultAccountName} from './default-account-name'
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
  writeLocalKeys,
} from './local-db'
import {queryAPI} from './models'

const seedClient = createSeedClient('')

function createSignerFromKeyPair(kp: CryptoKeyPair): HMSigner {
  return {
    getPublicKey: async () => preparePublicKey(kp.publicKey),
    sign: async (data: Uint8Array) => {
      const sig = await crypto.subtle.sign(
        {...kp.privateKey.algorithm, hash: {name: 'SHA-256'}},
        kp.privateKey,
        new Uint8Array(data),
      )
      return new Uint8Array(sig)
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
  vaultUrl?: string
}
let keyPair: LocalWebIdentity | null = null
const keyPairHandlers = new Set<() => void>()
const SECRET_UNLOCK_TAPS = 7
const SECRET_UNLOCK_WINDOW_MS = 3500

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
    vaultUrl: stored.vaultUrl,
  }
}

function syncKeyPair(newKeyPair: LocalWebIdentity | null) {
  if ((!newKeyPair && keyPair) || newKeyPair?.id !== keyPair?.id) {
    keyPairStore.set(newKeyPair)
  }
}

function updateKeyPair() {
  loadLocalWebIdentity().then(syncKeyPair).catch(console.error)
}

export function logout() {
  const vaultUrl = keyPairStore.get()?.vaultUrl
  Promise.all([
    deleteLocalKeys(),
    setHasPromptedEmailNotifications(false),
    vaultUrl ? authSession.clearSession(vaultUrl) : Promise.resolve(),
    clearAllAuthState(),
  ])
    .then(() => {
      keyPairStore.set(null)
    })
    .catch((e) => {
      console.error('Failed to log out', e)
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

export async function createAccount({
  name,
  icon,
}: {
  name: string
  icon: string | Blob | null
}): Promise<LocalWebIdentity> {
  if (typeof icon === 'string') {
    throw new Error('Must provide an image or null for account creation')
  }

  const existingStored = await getStoredLocalKeys()
  if (existingStored?.vaultUrl) {
    await authSession.clearSession(existingStored.vaultUrl).catch((err) => {
      console.error('Failed to clear delegated session while creating local account', err)
    })
  }

  let keyPair = existingStored?.keyPair

  if (keyPair) {
    const id = await preparePublicKey(keyPair.publicKey)
    const uid = base58btc.encode(id)

    try {
      const accountResult = await queryAPI<{type?: string}>(`/api/Account?id=${encodeURIComponent(uid)}`)
      if (accountResult?.type === 'account') {
        const webIdentity = {
          ...keyPair,
          id: uid,
        }
        keyPairStore.set(webIdentity)
        return webIdentity
      }
    } catch (err) {
      console.warn('Failed to verify existing local account, proceeding with account creation', err)
    }
  } else {
    keyPair = await generateAndStoreKeyPair()
  }

  if (!keyPair) {
    throw new Error('Failed to initialize local key pair')
  }
  const signer = createSignerFromKeyPair(keyPair)
  const uid = base58btc.encode(await preparePublicKey(keyPair.publicKey))

  const changes: HMPrepareDocumentChangeInput['changes'] = [
    {op: {case: 'setMetadata', value: {key: 'name', value: name}}},
  ]

  // Publish icon blob first if provided
  if (icon) {
    const iconBlock = await encodeBlock(await icon.arrayBuffer(), rawCodec)
    await seedClient.publish({
      blobs: [{data: iconBlock.bytes, cid: iconBlock.cid.toString()}],
    })
    changes.push({op: {case: 'setMetadata', value: {key: 'icon', value: iconBlock.cid.toString()}}})
  }

  await seedClient.publishDocument({account: uid, changes}, signer)

  keyPairStore.set({...keyPair, id: uid})
  return {...keyPair, id: uid}
}

/**
 * Generates a new key pair and stores it locally
 * @returns The generated key pair
 */
export async function generateAndStoreKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    false, // non-extractable
    ['sign', 'verify'],
  )
  await writeLocalKeys(keyPair)
  return keyPair
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
    createAccount: () => createAccountDialog.open({}),
    content: createAccountDialog.content,
    createDefaultAccount: async () => {
      return await createAccount({name: createDefaultAccountName(), icon: null})
    },
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

function CreateAccountDialog({input, onClose}: {input: {}; onClose: () => void}) {
  const {origin, originHomeId} = useUniversalAppContext()
  const tx = useTxString()
  const siteName = hostnameStripProtocol(origin)
  const defaultVaultOrigin = WEB_IDENTITY_ORIGIN || origin || 'http://localhost'
  const defaultVaultUrl = `${defaultVaultOrigin}/vault/delegate`
  const [customVaultUrl, setCustomVaultUrl] = useState('')
  const [showCustomVaultInput, setShowCustomVaultInput] = useState(false)
  const [localAccountUnlocked, setLocalAccountUnlocked] = useState(false)
  const [vaultEmail, setVaultEmail] = useState('')
  const customVaultInputRef = useRef<HTMLInputElement>(null)

  const secretTap = useMemo(
    () =>
      createSecretTapUnlock({
        requiredTaps: SECRET_UNLOCK_TAPS,
        windowMs: SECRET_UNLOCK_WINDOW_MS,
        onUnlock: () => {
          setLocalAccountUnlocked(true)
          toast.success('Local account creation unlocked for this session')
        },
      }),
    [],
  )

  useEffect(() => {
    return () => secretTap.dispose()
  }, [secretTap])

  const handleVaultSignIn = async (urlOverride?: string, email?: string) => {
    const vaultUrl = urlOverride || defaultVaultUrl
    await setAuthState(AUTH_STATE_DELEGATION_RETURN_URL, window.location.pathname)
    await setAuthState(AUTH_STATE_DELEGATION_VAULT_URL, vaultUrl)
    // If no pending comment intent was already saved, mark this as a join intent
    const existingIntent = await getPendingIntent()
    console.log('[handleVaultSignIn] existingIntent:', existingIntent)
    console.log('[handleVaultSignIn] originHomeId:', originHomeId)
    if (!existingIntent && originHomeId?.uid) {
      await setPendingIntent({type: 'join', subjectUid: originHomeId.uid})
    }
    try {
      const authUrl = await authSession.startAuth({
        vaultUrl,
        clientId: origin || window.location.origin,
        redirectUri: `${origin || window.location.origin}/hm/auth/callback`,
        email: email || undefined,
      })
      window.location.href = authUrl
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const onSubmit: SubmitHandler<SiteMetaFields> = async (data) => {
    try {
      await createAccount({name: data.name, icon: data.icon})
      // onClose triggers processPendingIntent() which publishes the comment
      // from IDB and navigates to it.
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <DialogTitle className="flex items-center gap-2 max-sm:text-base" onClick={secretTap.tap}>
        {localAccountUnlocked ? (
          tx('create_account_title', ({siteName}: {siteName: string}) => `Create Account on ${siteName}`, {
            siteName: siteName || 'this site',
          })
        ) : (
          <>
            <div className="flex size-8 items-center justify-center rounded-full bg-emerald-600">
              <SeedLogo className="size-4 text-white" />
            </div>
            Join the conversation
          </>
        )}
      </DialogTitle>

      {localAccountUnlocked ? (
        <>
          <DialogDescription className="max-sm:text-sm">
            {tx(
              'create_account_description',
              'Hypermedia accounts use public key cryptography. The private key for your account will be securely stored in this browser, and no one else has access to it. The identity will be accessible only on this domain, but you can link it to other domains and devices later.',
            )}
          </DialogDescription>
          <EditProfileForm
            onSubmit={(values) => {
              onSubmit(values)
            }}
            submitLabel={tx('create_account_submit', ({siteName}: {siteName: string}) => `Create ${siteName} Account`, {
              siteName,
            })}
            processImage={optimizeImage}
          />
        </>
      ) : (
        <>
          <DialogDescription className="max-sm:text-sm">
            To comment on <span className="font-medium">{siteName || 'this site'}</span> and join the discussion,
            you&apos;ll need a free Hypermedia account.
          </DialogDescription>

          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (vaultEmail.trim()) {
                handleVaultSignIn(undefined, vaultEmail.trim())
              }
            }}
          >
            <div className="flex flex-col gap-1.5">
              <SizableText size="sm" className="font-medium">
                Enter your email to continue
              </SizableText>
              <input
                type="email"
                className="rounded-md border px-3 py-2 text-sm dark:bg-neutral-900"
                value={vaultEmail}
                onChange={(e) => setVaultEmail(e.target.value)}
                placeholder="Enter your email"
                required
                autoFocus
              />
              <SizableText size="xs" className="text-neutral-500 dark:text-neutral-400">
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
              </SizableText>
            </div>

            <Button variant="default" type="submit" size="lg" className="w-full" disabled={!vaultEmail.trim()}>
              Continue to join
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            <span className="text-xs text-neutral-400 dark:text-neutral-500">
              Or, already have a Hypermedia account?
            </span>
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          </div>

          <Button variant="outline" size="lg" className="w-full" onClick={() => handleVaultSignIn()}>
            Sign in
          </Button>

          <div className="text-center text-sm text-neutral-500 dark:text-neutral-400">
            Do you have another domain?{' '}
            <button
              type="button"
              className="cursor-pointer font-medium text-emerald-600 underline underline-offset-2 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
              onClick={() => setShowCustomVaultInput(true)}
            >
              Sign in with it
            </button>
          </div>

          {showCustomVaultInput && (
            <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
              <SizableText size="sm" className="font-medium">
                Custom Vault URL
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
      )}
    </>
  )
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

function LogoutDialog({onClose}: {onClose: () => void}) {
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
            update.mutateAsync(newValues).then(() => onClose())
          }}
          processImage={optimizeImage}
        />
      )}
    </>
  )
}

export function LinkKeysDialog() {
  const tx = useTx()

  return (
    <>
      <DialogTitle>{tx('Link Keys')}</DialogTitle>
      <DialogDescription>
        <div className="flex flex-col gap-1">
          {tx(
            'link_keys_explainer',
            () => {
              return (
                <>
                  <p>
                    Hypermedia accounts are based on public key cryptography. Your private key is securely stored, but
                    is only available in this browser, on this device.
                  </p>
                  <p>
                    To stay logged in in the future, you should link this signing key to your account using one of the
                    options below.
                  </p>
                </>
              )
            },
            {},
          )}
        </div>
      </DialogDescription>
      <div className="flex flex-wrap gap-2">
        <Button variant="default" asChild>
          <a href="/hm/device-link" target="_blank">
            <Monitor /> {tx('Link with Desktop App')}
          </a>
        </Button>
        <Button variant="default" disabled>
          <Smartphone /> {tx('Link with Mobile App (Soon)')}
        </Button>
      </div>
    </>
  )
}

export function LogoutButton() {
  const userKeyPair = useLocalKeyPair()
  const logoutDialog = useAppDialog(LogoutDialog)
  const tx = useTxString()
  if (!userKeyPair) return null
  return (
    <>
      <Button variant="outline" onClick={() => logoutDialog.open({})}>
        <LogOut className="size-4" />
        {tx('Logout')}
      </Button>
      {logoutDialog.content}
    </>
  )
}

export function AccountFooterActions(props: {hideDeviceLinkToast?: boolean}) {
  const userKeyPair = useLocalKeyPair()
  const logoutDialog = useAppDialog(LogoutDialog)
  const editProfileDialog = useAppDialog(EditProfileDialog)
  const linkKeysDialog = useAppDialog(LinkKeysDialog)

  const tx = useTx()
  const myAccount = useAccount(userKeyPair?.id)

  // TODO(burdiyan): this is not a very robust solution to check whether we need to link keys.
  // For now we request the account info from the backend, which would follow identity redirects to return the final account,
  // in which case the ID of the final account will be different from the requested ID. When it happens, it means we have already linked this key to some other account.
  // Delegated sessions are already linked via the vault, so they never need legacy key linking.
  const needsKeyLinking =
    !props.hideDeviceLinkToast &&
    userKeyPair &&
    !userKeyPair.delegatedAccountUid &&
    myAccount.data?.id?.uid === userKeyPair?.id

  useEffect(() => {
    if (!needsKeyLinking) {
      linkKeysDialog.close()
      return
    }

    const t = toast.warning(
      <div className="flex items-center">
        <SizableText className="p-1">
          {tx(
            'stay_logged_in',
            'Link your identity key to stay logged in! You can dismiss this message and do it later.',
          )}
        </SizableText>
        <Button
          size="xs"
          variant="brand"
          onClick={() => {
            linkKeysDialog.open({})
          }}
        >
          {tx('Link Keys')}
        </Button>
      </div>,
      {
        duration: Infinity,
        dismissible: true,
        closeButton: true,
      },
    )

    return () => {
      toast.dismiss(t)
    }
  }, [needsKeyLinking, tx])

  if (!userKeyPair) return null
  return (
    <div className="flex max-w-full flex-wrap justify-end gap-2">
      {logoutDialog.content}
      {editProfileDialog.content}
      {linkKeysDialog.content}
    </div>
  )
}

if (typeof window !== 'undefined') {
  updateKeyPair()
  setInterval(updateKeyPair, 200)
}

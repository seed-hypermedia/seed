import {zodResolver} from '@hookform/resolvers/zod'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {useNavigate} from '@remix-run/react'
import {hmId, hostnameStripProtocol, queryKeys, useUniversalAppContext} from '@shm/shared'
import {WEB_IDENTITY_ORIGIN} from '@shm/shared/constants'
import {HMDocument, HMDocumentOperation} from '@shm/shared/hm-types'
import * as hmauth from '@shm/shared/hmauth'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {useTx, useTxString} from '@shm/shared/translation'
import {Button} from '@shm/ui/button'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {DropdownMenu, DropdownMenuContent, DropdownMenuTrigger} from '@shm/ui/components/dropdown-menu'
import {Field} from '@shm/ui/form-fields'
import {FormInput} from '@shm/ui/form-input'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {ChevronDown, LogOut, Monitor, Smartphone} from 'lucide-react'
import {BlockView} from 'multiformats'
import {base58btc} from 'multiformats/bases/base58'
import {CID} from 'multiformats/cid'
import {useEffect, useRef, useState, useSyncExternalStore} from 'react'
import {Control, FieldValues, Path, SubmitHandler, useController, useForm} from 'react-hook-form'
import {z} from 'zod'
import {
  blockReference,
  createDocumentGenesisChange,
  createHomeDocumentChange,
  createRef,
  encodeBlock,
  getChangesDepth,
  postCBOR,
  rawCodec,
} from './api'
import {preparePublicKey} from './auth-utils'
import {createDefaultAccountName} from './default-account-name'
import {deleteLocalKeys, getStoredLocalKeys, setHasPromptedEmailNotifications, writeLocalKeys} from './local-db'
import {queryAPI} from './models'
import type {CreateAccountPayload} from './routes/hm.api.create-account'
import type {UpdateDocumentPayload} from './routes/hm.api.document-update'

let AccountWithImage: boolean = false

export type LocalWebIdentity = CryptoKeyPair & {
  id: string
  isDelegated?: boolean
  vaultUrl?: string
}
let keyPair: LocalWebIdentity | null = null
const keyPairHandlers = new Set<() => void>()
const VAULT_SIGN_IN_UNLOCK_TAPS = 7
const VAULT_SIGN_IN_UNLOCK_WINDOW_MS = 3500

export const keyPairStore = {
  get: () => keyPair,
  set: (kp: LocalWebIdentity | null) => {
    keyPair = kp
    keyPairHandlers.forEach((callback) => callback())
  },
}

async function loadLocalWebIdentity(): Promise<LocalWebIdentity | null> {
  const kp = await getStoredLocalKeys()
  if (!kp) return null
  const id = await preparePublicKey(kp.publicKey)
  return {
    ...kp,
    id: base58btc.encode(id),
  }
}

function syncKeyPair(newKeyPair: LocalWebIdentity | null) {
  if ((!newKeyPair && keyPair) || newKeyPair?.id !== keyPair?.id) {
    keyPairStore.set(newKeyPair)
  }
}

function updateKeyPair() {
  const activeVaultUrl = typeof window !== 'undefined' ? localStorage.getItem('hm_active_vault_url') : null
  if (activeVaultUrl) {
    hmauth
      .getSession(activeVaultUrl)
      .then(async (session) => {
        if (session) {
          return {
            privateKey: session.keyPair.privateKey,
            publicKey: session.keyPair.publicKey,
            id: session.principal,
            isDelegated: true,
            vaultUrl: session.vaultUrl,
          } satisfies LocalWebIdentity
        }
        localStorage.removeItem('hm_active_vault_url')
        return await loadLocalWebIdentity()
      })
      .then(syncKeyPair)
      .catch((err) => {
        console.error(err)
        localStorage.removeItem('hm_active_vault_url')
        loadLocalWebIdentity().then(syncKeyPair).catch(console.error)
      })
    return
  }

  loadLocalWebIdentity().then(syncKeyPair).catch(console.error)
}

export function logout() {
  const vaultUrl = keyPairStore.get()?.vaultUrl
  Promise.all([
    deleteLocalKeys(),
    setHasPromptedEmailNotifications(false),
    vaultUrl ? hmauth.clearSession(vaultUrl) : Promise.resolve(),
  ])
    .then(() => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('hm_active_vault_url')
        localStorage.removeItem('hm_delegation_return_url')
        localStorage.removeItem('hm_delegation_vault_url')
      }
      keyPairStore.set(null)
      console.log('Logged out')
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

  const activeVaultUrl = typeof window !== 'undefined' ? localStorage.getItem('hm_active_vault_url') : null
  if (activeVaultUrl) {
    localStorage.removeItem('hm_active_vault_url')
    await hmauth.clearSession(activeVaultUrl).catch((err) => {
      console.error('Failed to clear delegated session while creating local account', err)
    })
  }

  const existingKeyPair = await getStoredLocalKeys()
  let keyPair = existingKeyPair

  if (existingKeyPair) {
    const id = await preparePublicKey(existingKeyPair.publicKey)
    const uid = base58btc.encode(id)

    try {
      const accountResult = await queryAPI<{type?: string}>(`/api/Account?id=${encodeURIComponent(uid)}`)
      if (accountResult?.type === 'account') {
        const webIdentity = {
          ...existingKeyPair,
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
  const genesisChange = await createDocumentGenesisChange({
    keyPair,
  })
  const genesisChangeBlock = await encodeBlock(genesisChange)
  const iconBlock = icon ? await encodeBlock(await icon.arrayBuffer(), rawCodec) : null
  const operations: HMDocumentOperation[] = [
    {
      type: 'SetAttributes',
      attrs: [{key: ['name'], value: name}],
    },
  ]
  if (iconBlock) {
    operations.push({
      type: 'SetAttributes',
      attrs: [{key: ['icon'], value: iconBlock.cid.toString()}],
    })
  }
  const changeHome = await createHomeDocumentChange({
    keyPair,
    genesisChangeCid: genesisChangeBlock.cid,
    operations,
    deps: [genesisChangeBlock.cid],
    depth: 1,
  })
  const changeHomeBlock = await encodeBlock(changeHome)
  const ref = await createRef({
    keyPair,
    genesisCid: genesisChangeBlock.cid,
    head: changeHomeBlock.cid,
    generation: 1,
  })
  const refBlock = await encodeBlock(ref)

  const createAccountPayload: CreateAccountPayload = {
    genesis: {
      data: genesisChangeBlock.bytes,
      cid: genesisChangeBlock.cid.toString(),
    },
    home: {
      data: changeHomeBlock.bytes,
      cid: changeHomeBlock.cid.toString(),
    },
    ref: refBlock.bytes,
    icon: iconBlock
      ? {
          data: iconBlock.bytes,
          cid: iconBlock.cid.toString(),
        }
      : null,
  }
  const createAccountData = cborEncode(createAccountPayload)
  await postCBOR('/hm/api/create-account', createAccountData)
  keyPairStore.set({
    ...keyPair,
    id: base58btc.encode(await preparePublicKey(keyPair.publicKey)),
  })
  return {
    ...keyPair,
    id: base58btc.encode(await preparePublicKey(keyPair.publicKey)),
  }
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

export const siteMetaSchema = z.object({
  name: z.string(),
  icon: z.string().or(z.instanceof(Blob)).nullable(),
})
export type SiteMetaFields = z.infer<typeof siteMetaSchema>

export async function updateProfile({
  keyPair,
  document,
  updates,
}: {
  keyPair: CryptoKeyPair
  document: HMDocument
  updates: SiteMetaFields
}) {
  const depsStrs = document.version.split('.')
  const deps = depsStrs.map((cidStr) => CID.parse(cidStr))
  const genesisStr = document.genesis
  const genesisChangeCid = genesisStr ? CID.parse(genesisStr) : null
  if (!genesisChangeCid) {
    throw new Error('No genesis found on document')
  }
  const lastDepth = await getChangesDepth(depsStrs)
  const operations: HMDocumentOperation[] = []
  if (updates.name && updates.name !== document.metadata.name) {
    operations.push({
      type: 'SetAttributes',
      attrs: [{key: ['name'], value: updates.name}],
    })
  }
  let iconBlock: BlockView<unknown, number, 18, 1> | null = null
  if (updates.icon && typeof updates.icon !== 'string') {
    // we are uploading a new icon
    iconBlock = await encodeBlock(await updates.icon.arrayBuffer(), rawCodec)
    operations.push({
      type: 'SetAttributes',
      attrs: [{key: ['icon'], value: iconBlock.cid.toString()}],
    })
  }
  const changePayload = await createHomeDocumentChange({
    keyPair,
    operations,
    genesisChangeCid,
    deps,
    depth: lastDepth + 1,
  })
  const changeBlock = await encodeBlock(changePayload)
  const refPayload = await createRef({
    keyPair,
    space: base58btc.decode(document.account),
    genesisCid: genesisChangeCid,
    head: changeBlock.cid,
    generation: lastDepth + 1,
  })
  const refBlock = await encodeBlock(refPayload)
  const updatePayload: UpdateDocumentPayload = {
    icon: iconBlock ? blockReference(iconBlock) : null,
    change: blockReference(changeBlock),
    ref: blockReference(refBlock),
  }
  const updateData = cborEncode(updatePayload)
  await postCBOR('/hm/api/document-update', updateData)
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
  const {origin} = useUniversalAppContext()
  const tx = useTxString()
  const siteName = hostnameStripProtocol(origin)

  const defaultVaultOrigin = WEB_IDENTITY_ORIGIN || origin || 'http://localhost'
  const defaultVaultUrl = `${defaultVaultOrigin}/vault/delegate`
  const [customVaultUrl, setCustomVaultUrl] = useState('')
  const [showCustomVaultInput, setShowCustomVaultInput] = useState(false)
  const [vaultSignInUnlocked, setVaultSignInUnlocked] = useState(false)
  const customVaultInputRef = useRef<HTMLInputElement>(null)
  const unlockTapCountRef = useRef(0)
  const unlockTapTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (unlockTapTimeoutRef.current) {
        window.clearTimeout(unlockTapTimeoutRef.current)
      }
    }
  }, [])

  const unlockVaultSignIn = () => {
    setVaultSignInUnlocked(true)
    unlockTapCountRef.current = 0
    if (unlockTapTimeoutRef.current) {
      window.clearTimeout(unlockTapTimeoutRef.current)
      unlockTapTimeoutRef.current = null
    }
    toast.success('Hypermedia sign-in unlocked for this session')
  }

  const handleSecretTitleTap = () => {
    if (vaultSignInUnlocked) return

    unlockTapCountRef.current += 1

    if (unlockTapTimeoutRef.current) {
      window.clearTimeout(unlockTapTimeoutRef.current)
    }

    unlockTapTimeoutRef.current = window.setTimeout(() => {
      unlockTapCountRef.current = 0
      unlockTapTimeoutRef.current = null
    }, VAULT_SIGN_IN_UNLOCK_WINDOW_MS)

    if (unlockTapCountRef.current >= VAULT_SIGN_IN_UNLOCK_TAPS) {
      unlockVaultSignIn()
    }
  }

  const handleVaultSignIn = async (urlOverride?: string) => {
    const vaultUrl = urlOverride || defaultVaultUrl
    localStorage.setItem('hm_delegation_return_url', window.location.pathname)
    localStorage.setItem('hm_delegation_vault_url', vaultUrl)
    try {
      const authUrl = await hmauth.startAuth({
        vaultUrl,
        clientId: origin || window.location.origin,
        redirectUri: `${origin || window.location.origin}/hm/auth/callback`,
      })
      window.location.href = authUrl
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const onSubmit: SubmitHandler<SiteMetaFields> = async (data) => {
    try {
      await createAccount({name: data.name, icon: data.icon})
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <DialogTitle className="max-sm:text-base" onClick={handleSecretTitleTap}>
        {tx('create_account_title', ({siteName}: {siteName: string}) => `Create Account on ${siteName}`, {
          siteName: siteName || 'this site',
        })}
      </DialogTitle>
      <DialogDescription className="max-sm:text-sm">
        {tx(
          'create_account_description',
          'Hypermedia accounts use public key cryptography. The private key for your account will be securely stored in this browser, and no one else has access to it. The identity will be accessible only on this domain, but you can link it to other domains and devices later.',
        )}
      </DialogDescription>
      <EditProfileForm
        onSubmit={(values) => {
          onClose()
          onSubmit(values)
        }}
        submitLabel={tx('create_account_submit', ({siteName}: {siteName: string}) => `Create ${siteName} Account`, {
          siteName,
        })}
      />

      {vaultSignInUnlocked ? (
        <>
          {/* Divider. */}
          <div className="flex items-center gap-1">
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
            <span className="text-xs text-neutral-400 dark:text-neutral-500">or</span>
            <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
          </div>

          {/* Split button: main part triggers vault sign-in, chevron opens dropdown for custom URL. */}
          <div className="flex flex-col gap-1">
            <div className="flex items-stretch">
              <Button
                variant="outline"
                size="lg"
                className="flex-1 rounded-r-none border-r-0"
                onClick={() => handleVaultSignIn()}
              >
                Sign in with Hypermedia
              </Button>
              <DropdownMenu
                open={showCustomVaultInput}
                onOpenChange={(open) => {
                  setShowCustomVaultInput(open)
                  if (open) {
                    // Focus the input after the dropdown renders.
                    setTimeout(() => customVaultInputRef.current?.focus(), 50)
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="lg" className="rounded-l-none border-l px-2">
                    <ChevronDown className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80 p-3">
                  <div className="flex flex-col gap-2">
                    <SizableText size="sm" className="font-medium">
                      Custom Vault URL
                    </SizableText>
                    <input
                      ref={customVaultInputRef}
                      className="rounded border px-2 py-1.5 text-sm dark:bg-neutral-900"
                      value={customVaultUrl}
                      onChange={(e) => setCustomVaultUrl(e.target.value)}
                      placeholder={defaultVaultUrl}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && customVaultUrl.trim()) {
                          handleVaultSignIn(customVaultUrl.trim())
                        }
                      }}
                    />
                    <Button
                      variant="default"
                      size="sm"
                      className="self-end"
                      disabled={!customVaultUrl.trim()}
                      onClick={() => handleVaultSignIn(customVaultUrl.trim())}
                    >
                      Connect
                    </Button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}

function EditProfileForm({
  onSubmit,
  defaultValues,
  submitLabel,
}: {
  onSubmit: (data: SiteMetaFields) => void
  defaultValues?: SiteMetaFields
  submitLabel?: string
}) {
  const tx = useTxString()
  const form = useForm<SiteMetaFields>({
    resolver: zodResolver(siteMetaSchema),
    defaultValues: defaultValues || {
      name: createDefaultAccountName(),
      icon: null,
    },
  })
  useEffect(() => {
    setTimeout(() => {
      form.setFocus('name', {shouldSelect: true})
    }, 300) // wait for animation
  }, [form.setFocus])
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <div className="flex flex-col gap-2">
        <Field id="name" label={tx('Account Name')}>
          <FormInput control={form.control} name="name" placeholder={tx('My New Public Name')} />
        </Field>
        <Field id="icon" label={tx('Profile Icon')}>
          <ImageField control={form.control} name="icon" label={tx('Profile Icon')} />
        </Field>
        <div>
          <Button
            type="submit"
            variant="default"
            size="lg"
            className={`plausible-event-name=finish-create-account w-full plausible-event-image=${
              AccountWithImage || 'false'
            }`}
          >
            {submitLabel || tx('Save')}
          </Button>
        </div>
      </div>
    </form>
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

function ImageField<Fields extends FieldValues>({
  control,
  name,
  label,
}: {
  control: Control<Fields>
  name: Path<Fields>
  label: string
}) {
  const c = useController({control, name})
  const tx = useTxString()
  const currentImgURL = c.field.value
    ? typeof c.field.value === 'string'
      ? getDaemonFileUrl(c.field.value)
      : URL.createObjectURL(c.field.value)
    : null
  return (
    <div className="group relative flex h-[128px] w-[128px] cursor-pointer overflow-hidden rounded-sm border-2 border-dashed border-neutral-300 hover:border-neutral-400 max-sm:h-16 max-sm:w-16 dark:border-neutral-600 dark:hover:border-neutral-500">
      <input
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          AccountWithImage = true
          optimizeImage(file).then((blob) => {
            c.field.onChange(blob)
          })
        }}
        className="absolute inset-0 z-10 cursor-pointer opacity-0"
      />
      {!c.field.value && (
        <div className="pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center bg-neutral-100 dark:bg-neutral-800">
          <SizableText size="xs" className="text-center text-neutral-600 dark:text-neutral-400">
            {tx('add', ({what}: {what: string}) => `Add ${what}`, {
              what: label,
            })}
          </SizableText>
        </div>
      )}
      {c.field.value && (
        <img src={currentImgURL || undefined} alt={label} className="absolute inset-0 h-full w-full object-cover" />
      )}
      {c.field.value && (
        <div className="pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
          <SizableText size="xs" className="text-center text-white">
            Edit {label}
          </SizableText>
        </div>
      )}
    </div>
  )
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
  const isAccountAliased = keyPair.isDelegated || account.data?.id.uid !== keyPair.id
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
  const queryClient = useQueryClient()
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
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_ACTIVITY],
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_DISCUSSION],
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.ENTITY, id.id],
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.RESOLVED_ENTITY, id.id],
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.ACCOUNT],
      })
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
    !props.hideDeviceLinkToast && userKeyPair && !userKeyPair.isDelegated && myAccount.data?.id?.uid === userKeyPair?.id

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

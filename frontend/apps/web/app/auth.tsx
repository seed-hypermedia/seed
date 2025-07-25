import {injectModels} from '@/models'
import {zodResolver} from '@hookform/resolvers/zod'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {
  ENABLE_EMAIL_NOTIFICATIONS,
  hmId,
  hostnameStripProtocol,
  queryKeys,
  useUniversalAppContext,
} from '@shm/shared'
import {HMDocument, HMDocumentOperation} from '@shm/shared/hm-types'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {useTx, useTxString} from '@shm/shared/translation'
import {Button} from '@shm/ui/button'
import {Field} from '@shm/ui/form-fields'
import {FormInput} from '@shm/ui/form-input'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {
  DialogDescription,
  DialogTitle,
  useAppDialog,
} from '@shm/ui/universal-dialog'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {LogOut, Megaphone, Pencil} from 'lucide-react'
import {BlockView} from 'multiformats'
import {base58btc} from 'multiformats/bases/base58'
import {CID} from 'multiformats/cid'
import {useEffect, useSyncExternalStore} from 'react'
import {
  Control,
  FieldValues,
  Path,
  SubmitHandler,
  useController,
  useForm,
} from 'react-hook-form'
import {z} from 'zod'
import {
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
import {NotifSettingsDialog} from './email-notifications'
import {
  deleteLocalKeys,
  getStoredLocalKeys,
  setHasPromptedEmailNotifications,
  writeLocalKeys,
} from './local-db'
import type {CreateAccountPayload} from './routes/hm.api.create-account'
import type {UpdateDocumentPayload} from './routes/hm.api.document-update'

injectModels()

let AccountWithImage: boolean = false

export type LocalWebIdentity = CryptoKeyPair & {
  id: string
}
let keyPair: LocalWebIdentity | null = null
const keyPairHandlers = new Set<() => void>()

const keyPairStore = {
  get: () => keyPair,
  set: (kp: LocalWebIdentity | null) => {
    keyPair = kp
    keyPairHandlers.forEach((callback) => callback())
  },
}

function updateKeyPair() {
  getStoredLocalKeys()
    .then(async (kp) => {
      if (!kp) return null
      const id = await preparePublicKey(kp.publicKey)
      const webIdentity: LocalWebIdentity = {
        ...kp,
        id: base58btc.encode(id),
      }
      return webIdentity
    })
    .then((newKeyPair) => {
      if ((!newKeyPair && keyPair) || newKeyPair?.id !== keyPair?.id) {
        keyPairStore.set(newKeyPair)
      }
    })
}

export function logout() {
  Promise.all([deleteLocalKeys(), setHasPromptedEmailNotifications(false)])
    .then(() => {
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
  const existingKeyPair = await getStoredLocalKeys()
  if (existingKeyPair) {
    throw new Error('Account already exists')
  }
  const keyPair = await generateAndStoreKeyPair()
  const genesisChange = await createDocumentGenesisChange({
    keyPair,
  })
  const genesisChangeBlock = await encodeBlock(genesisChange)
  const iconBlock = icon
    ? await encodeBlock(await icon.arrayBuffer(), rawCodec)
    : null
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
    icon: iconBlock
      ? {
          data: iconBlock.bytes,
          cid: iconBlock.cid.toString(),
        }
      : null,
    change: {
      data: changeBlock.bytes,
      cid: changeBlock.cid.toString(),
    },
    ref: {
      data: refBlock.bytes,
      cid: refBlock.cid.toString(),
    },
  }
  const updateData = cborEncode(updatePayload)
  await postCBOR('/hm/api/document-update', updateData)
}

export function useCreateAccount() {
  const userKeyPair = useLocalKeyPair()
  const createAccountDialog = useAppDialog(CreateAccountDialog)
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

function CreateAccountDialog({
  input,
  onClose,
}: {
  input: {}
  onClose: () => void
}) {
  const {origin} = useUniversalAppContext()
  const onSubmit: SubmitHandler<SiteMetaFields> = (data) => {
    createAccount({name: data.name, icon: data.icon}).then(() => onClose())
  }
  const tx = useTxString()
  const siteName = hostnameStripProtocol(origin)
  return (
    <>
      <DialogTitle>
        {tx(
          'create_account_title',
          ({siteName}: {siteName: string}) => `Create Account on ${siteName}`,
          {siteName},
        )}
      </DialogTitle>
      <DialogDescription>
        {tx(
          'create_account_description',
          'Your account key will be securely stored in this browser. The identity will be accessible only on this domain, but you can link it to other domains and devices.',
        )}
      </DialogDescription>
      <EditProfileForm
        onSubmit={onSubmit}
        submitLabel={tx(
          'create_account_submit',
          ({siteName}: {siteName: string}) => `Create ${siteName} Account`,
          {siteName},
        )}
      />
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
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<SiteMetaFields>({
    resolver: zodResolver(siteMetaSchema),
    defaultValues: defaultValues || {
      name: createDefaultAccountName(),
      icon: null,
    },
  })
  useEffect(() => {
    setTimeout(() => {
      setFocus('name', {shouldSelect: true})
    }, 300) // wait for animation
  }, [setFocus])
  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div className="flex flex-col gap-2">
        <Field id="name" label={tx('Account Name')}>
          <FormInput
            control={control}
            name="name"
            placeholder={tx('My New Public Name')}
          />
        </Field>
        <ImageField control={control} name="icon" label={tx('Site Icon')} />
        <div className="flex justify-center">
          <Button
            type="submit"
            variant="default"
            className={`plausible-event-name=finish-create-account plausible-event-image=${
              AccountWithImage || 'false'
            }`}
          >
            {submitLabel || tx('Save Account')}
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
    <div className="relative flex size-[128px] flex-1 self-stretch overflow-hidden rounded-sm">
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          AccountWithImage = true
          optimizeImage(file).then((blob) => {
            c.field.onChange(blob)
          })
        }}
        style={{
          opacity: 0,
          display: 'flex',
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
        }}
      />
      {!c.field.value && (
        <div className="bg-muted pointer-none absolute z-5 flex h-full w-full items-center justify-center gap-2 opacity-100">
          <SizableText size="xs" className="text-center text-white">
            {tx('add', ({what}: {what: string}) => `Add ${what}`, {
              what: label,
            })}
          </SizableText>
        </div>
      )}
      {c.field.value && (
        <img
          src={currentImgURL}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            position: 'absolute',
            left: 0,
            top: 0,
          }}
        />
      )}
      {c.field.value && (
        <div className="bg-muted pointer-none absolute z-5 flex h-full w-full items-center justify-center gap-2 opacity-100">
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
  const tx = useTx()
  if (!keyPair) return <DialogTitle>No session found</DialogTitle>
  if (account.isLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  const isAccountAliased = account.data?.id.uid !== keyPair.id
  return (
    <>
      <DialogTitle>{tx('Really Logout?')}</DialogTitle>
      <DialogDescription>
        {isAccountAliased
          ? tx(
              'logout_account_saved',
              'This account will remain accessible on other devices.',
            )
          : tx(
              'logout_account_not_saved',
              'This account key is not saved anywhere else. By logging out, you will loose access to this identity forever.',
            )}
      </DialogDescription>
      <Button
        variant="destructive"
        onClick={() => {
          logout()
          onClose()
        }}
      >
        {isAccountAliased ? tx('Log out') : tx('Log out Forever')}
      </Button>
    </>
  )
}

function EditProfileDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {accountUid: string}
}) {
  console.log('EditProfileDialog', input)
  const keyPair = useLocalKeyPair()
  const id = hmId(input.accountUid)
  const tx = useTx()
  const account = useAccount(input.accountUid)
  const accountDocument = useResource(account?.data?.id)
  const document =
    accountDocument?.data?.type === 'document'
      ? accountDocument.data.document
      : undefined
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
    },
  })
  return (
    <>
      <DialogTitle>{tx('Edit Profile')}</DialogTitle>
      {document && (
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

export function AccountFooterActions() {
  const userKeyPair = useLocalKeyPair()
  const logoutDialog = useAppDialog(LogoutDialog)
  const editProfileDialog = useAppDialog(EditProfileDialog)
  const notifSettingsDialog = useAppDialog(NotifSettingsDialog)
  const tx = useTx()
  if (!userKeyPair) return null
  return (
    <div className="flex max-w-full flex-wrap justify-end gap-2">
      {ENABLE_EMAIL_NOTIFICATIONS && (
        <Button size="xs" onClick={() => notifSettingsDialog.open({})}>
          <Megaphone className="size-4" />
          {tx('Notification Settings')}
        </Button>
      )}
      <Button
        size="xs"
        onClick={() => editProfileDialog.open({accountUid: userKeyPair.id})}
      >
        <Pencil className="size-4" />
        {tx('Edit Profile')}
      </Button>
      <Button size="xs" onClick={() => logoutDialog.open({})}>
        <LogOut className="size-4" />
        {tx('Logout')}
      </Button>
      {logoutDialog.content}
      {editProfileDialog.content}
      {notifSettingsDialog.content}
    </div>
  )
}

if (typeof window !== 'undefined') {
  updateKeyPair()
  setInterval(updateKeyPair, 200)
}

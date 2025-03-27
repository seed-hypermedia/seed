import {injectModels} from '@/models'
import {zodResolver} from '@hookform/resolvers/zod'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {
  hmId,
  hostnameStripProtocol,
  queryKeys,
  useUniversalAppContext,
} from '@shm/shared'
import {HMDocument, HMDocumentOperation} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {Field} from '@shm/ui/form-fields'
import {FormInput} from '@shm/ui/form-input'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {
  DialogDescription,
  DialogTitle,
  useAppDialog,
} from '@shm/ui/universal-dialog'
import {LogOut, Megaphone, Pencil} from '@tamagui/lucide-icons'
import {useMutation, useQueryClient} from '@tanstack/react-query'
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
import {Form, SizableText, Stack, XStack, YStack} from 'tamagui'
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
import {Ability} from './auth-abilities'
import {preparePublicKey} from './auth-utils'
import {NotifSettingsDialog} from './email-notifications'
import {
  deleteAbility,
  deleteAllAbilities,
  deleteLocalKeys,
  getAllAbilities,
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

updateKeyPair()
setInterval(updateKeyPair, 200)

export function logout() {
  Promise.all([
    deleteLocalKeys(),
    deleteAllAbilities(),
    setHasPromptedEmailNotifications(false),
  ])
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
}) {
  if (typeof icon === 'string') {
    throw new Error('Must provide an image or null for account creation')
  }
  const existingKeyPair = await getStoredLocalKeys()
  if (existingKeyPair) {
    throw new Error('Account already exists')
  }
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    false, // non-extractable
    ['sign', 'verify'],
  )
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
  await writeLocalKeys(keyPair)
  keyPairStore.set({
    ...keyPair,
    id: base58btc.encode(await preparePublicKey(keyPair.publicKey)),
  })
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
  const siteName = hostnameStripProtocol(origin)
  return (
    <>
      <DialogTitle>Create Account on {siteName}</DialogTitle>
      <DialogDescription>
        Your account key will be securely stored in this browser. The identity
        will be accessible only on this domain, but you can link it to other
        domains and devices.
      </DialogDescription>
      <EditProfileForm
        onSubmit={onSubmit}
        submitLabel={`Create ${siteName} Account`}
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
  console.log('~~ EditProfileForm')
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<SiteMetaFields>({
    resolver: zodResolver(siteMetaSchema),
    defaultValues: defaultValues || {
      name: '',
      icon: null,
    },
  })
  useEffect(() => {
    setTimeout(() => {
      setFocus('name')
    }, 300) // wait for animation
  }, [setFocus])
  return (
    <Form onSubmit={handleSubmit(onSubmit)}>
      <YStack gap="$2">
        <Field id="name" label="Account Name">
          <FormInput control={control} name="name" placeholder="Account Name" />
        </Field>
        <ImageField control={control} name="icon" label="Site Icon" />
        <XStack jc="center">
          <Form.Trigger asChild>
            <Button
              className={`plausible-event-name=finish-create-account plausible-event-image=${
                AccountWithImage || 'false'
              }`}
            >
              {submitLabel || 'Save Account'}
            </Button>
          </Form.Trigger>
        </XStack>
      </YStack>
    </Form>
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
  const currentImgURL = c.field.value
    ? typeof c.field.value === 'string'
      ? getDaemonFileUrl(c.field.value)
      : URL.createObjectURL(c.field.value)
    : null
  return (
    <Stack
      position="relative"
      group="icon"
      overflow="hidden"
      height={128}
      width={128}
      borderRadius="$2"
      alignSelf="stretch"
      flex={1}
    >
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
        <XStack
          bg="rgba(0,0,0,0.3)"
          position="absolute"
          gap="$2"
          zi="$zIndex.5"
          w="100%"
          $group-icon-hover={{opacity: 0.5}}
          h="100%"
          opacity={1}
          ai="center"
          jc="center"
          pointerEvents="none"
        >
          <SizableText textAlign="center" size="$1" color="white">
            Add {label}
          </SizableText>
        </XStack>
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
        <XStack
          bg="rgba(0,0,0,0.3)"
          position="absolute"
          gap="$2"
          zi="$zIndex.5"
          w="100%"
          $group-icon-hover={{opacity: 1}}
          h="100%"
          opacity={0}
          ai="center"
          jc="center"
          pointerEvents="none"
        >
          <SizableText textAlign="center" size="$1" color="white">
            Edit {label}
          </SizableText>
        </XStack>
      )}
    </Stack>
  )
}

function LogoutDialog({onClose}: {onClose: () => void}) {
  return (
    <>
      <DialogTitle>Really Logout?</DialogTitle>
      <DialogDescription>
        This account key is not saved anywhere else. By logging out, you will
        loose access to this identity forever.
      </DialogDescription>
      <Button
        onPress={() => {
          logout()
          onClose()
        }}
        theme="red"
      >
        Log out Forever
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
  const id = hmId('d', input.accountUid)
  console.log('id', id)
  const account = useEntity(id)
  const queryClient = useQueryClient()
  const document = account.data?.document
  console.log('account doc', document)
  const update = useMutation({
    mutationFn: (updates: SiteMetaFields) => {
      if (!keyPair) {
        throw new Error('No key pair found')
      }
      if (!document) {
        throw new Error('No document found')
      }
      return updateProfile({keyPair, document, updates})
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
    },
  })
  return (
    <>
      <DialogTitle>Edit Profile</DialogTitle>
      {document && (
        <EditProfileForm
          defaultValues={{
            name: account.data?.document?.metadata?.name || '?',
            icon: account.data?.document?.metadata?.icon || null,
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
  console.log('AccountFooterActions', userKeyPair?.id)
  if (!userKeyPair) return null
  return (
    <XStack gap="$2">
      <Button
        size="$2"
        onPress={() => notifSettingsDialog.open({})}
        backgroundColor="$color4"
        icon={Megaphone}
      >
        Notification Settings
      </Button>
      <Button
        size="$2"
        onPress={() => editProfileDialog.open({accountUid: userKeyPair.id})}
        backgroundColor="$color4"
        icon={Pencil}
      >
        Edit Profile
      </Button>
      <Button
        size="$2"
        onPress={() => logoutDialog.open({})}
        backgroundColor="$color4"
        icon={LogOut}
      >
        Logout
      </Button>
      {logoutDialog.content}
      {editProfileDialog.content}
      {notifSettingsDialog.content}
    </XStack>
  )
}

let allAbilities: Ability[] | null = null
let allAbilitiesJson: string | null = null
const allAbilitiesSubscribers = new Set<() => void>()
export const allAbilitiesStore = {
  subscribe: (onUpdate: () => void) => {
    allAbilitiesSubscribers.add(onUpdate)
    return () => {
      allAbilitiesSubscribers.delete(onUpdate)
    }
  },
  getSnapshot: () => allAbilities,
} as const

export function useAbilities() {
  return useSyncExternalStore(
    allAbilitiesStore.subscribe,
    allAbilitiesStore.getSnapshot,
    () => null,
  )
}

function updateAbilities() {
  getAllAbilities().then((abilities) => {
    const jsonCheck = JSON.stringify(abilities)
    if (allAbilitiesJson !== jsonCheck) {
      allAbilities = abilities
      allAbilitiesJson = jsonCheck
      allAbilitiesSubscribers.forEach((onUpdate) => onUpdate())
    }
  })
}

updateAbilities()
setInterval(updateAbilities, 200)

export function useDeleteAbility() {
  return useMutation({
    mutationFn: (id: string) => deleteAbility(id),
    onSuccess: () => {
      updateAbilities()
    },
  })
}

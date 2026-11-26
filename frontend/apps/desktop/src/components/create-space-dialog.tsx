import {fetchResource} from '@/models/entities'
import {useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {fileUpload} from '@/utils/file-upload'
import {useNavigate} from '@/utils/useNavigate'
import {hmId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {Dialog, DialogSideContent, DialogTitle} from '@shm/ui/components/dialog'
import {SPACE_EXISTS_BODY, SPACE_EXISTS_TITLE} from '@shm/ui/create-space-context'
import {CreateSpaceForm, type CreateSpaceFormState} from '@shm/ui/create-space-form'
import {createSpaceMetadata} from '@shm/ui/create-space-platform'
import {AVATAR_IMAGE_POLICY, COVER_IMAGE_POLICY} from '@shm/ui/image-processing'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {nanoid} from 'nanoid'
import {useCallback, useState, type ReactNode} from 'react'
import {useCreateAccountDialog} from './create-account'
import {useDesktopAccountIntent} from './desktop-intents'

// Imperative opener for the "Create a space" panel.
export function useCreateSpaceDialog() {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  const content = (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogSideContent>
        <DialogTitle className="sr-only">Create a space</DialogTitle>
        {isOpen ? <CreateSpaceFlow onClose={close} /> : null}
      </DialogSideContent>
    </Dialog>
  )
  return {open, close, content}
}

/** True once the account's home document exists, so creating another space would replace it. */
async function accountHasSpace(accountUid: string) {
  const home = await fetchResource(hmId(accountUid, {path: []}))
  return home.type === 'document' || home.type === 'redirect'
}

/**
 * The form with its desktop commit: populate a home document draft under
 * the selected identity with the collected metadata, then open the home editor.
 */
export function CreateSpaceFlow({onClose}: {onClose: () => void}) {
  const navigate = useNavigate()
  const selectedAccountId = useSelectedAccountId()
  const home = useResource(selectedAccountId ? hmId(selectedAccountId) : undefined)
  const accountIntent = useDesktopAccountIntent()
  const createAccountDialog = useCreateAccountDialog()
  const [busy, setBusy] = useState(false)

  async function writeHomeDraft(state: CreateSpaceFormState, accountUid: string) {
    setBusy(true)
    try {
      // An identity just signed in may already have a space; the panel then offers it instead.
      if (await accountHasSpace(accountUid)) {
        setBusy(false)
        return
      }
      // Upload images to IPFS, then write a populated home draft for the identity.
      const [coverCid, logoCid, faviconCid] = await Promise.all([
        state.cover ? fileUpload(state.cover, COVER_IMAGE_POLICY) : Promise.resolve(undefined),
        state.logo ? fileUpload(state.logo, AVATAR_IMAGE_POLICY) : Promise.resolve(undefined),
        state.favicon ? fileUpload(state.favicon, AVATAR_IMAGE_POLICY) : Promise.resolve(undefined),
      ])
      const metadata = createSpaceMetadata(state, {coverCid, logoCid, faviconCid})
      await client.drafts.write.mutate({
        id: nanoid(10),
        editUid: accountUid,
        editPath: [],
        metadata,
        content: [],
        deps: [],
        visibility: 'PUBLIC',
      })
      // Open the home editor so the user can add content and publish.
      navigate({key: 'document', id: hmId(accountUid, {path: []})})
      onClose()
    } catch (e) {
      toast.error('Failed to set up space: ' + (e instanceof Error ? e.message : String(e)))
      setBusy(false)
    }
  }

  const homeType = home.data?.type
  let body: ReactNode
  if (busy) {
    body = <CenteredStatus title="Setting up your space…" />
  } else if (selectedAccountId && home.isLoading) {
    body = <CenteredStatus title="Checking for your space…" />
  } else if (selectedAccountId && (homeType === 'document' || homeType === 'redirect')) {
    body = (
      <SpaceExists
        onUseDifferentAccount={() => createAccountDialog.open({})}
        onGoToSpace={() => {
          navigate({key: 'document', id: hmId(selectedAccountId)})
          onClose()
        }}
      />
    )
  } else {
    body = (
      <CreateSpaceForm
        onComplete={(state) => accountIntent.requireAccount((accountUid) => writeHomeDraft(state, accountUid))}
        onClose={onClose}
      />
    )
  }

  return (
    <>
      {body}
      {accountIntent.content}
      {createAccountDialog.content}
    </>
  )
}

function SpaceExists({
  onUseDifferentAccount,
  onGoToSpace,
}: {
  onUseDifferentAccount: () => void
  onGoToSpace: () => void
}) {
  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex flex-col gap-4">
        <SizableText size="2xl" weight="bold" asChild>
          <h2>{SPACE_EXISTS_TITLE}</h2>
        </SizableText>
        <SizableText className="text-muted-foreground">{SPACE_EXISTS_BODY}</SizableText>
      </div>
      <div className="mt-auto flex gap-2 pt-6">
        <Button variant="outline" size="lg" className="flex-1" onClick={onUseDifferentAccount}>
          Use a different account
        </Button>
        <Button variant="default" size="lg" className="flex-1" onClick={onGoToSpace}>
          Go to your space
        </Button>
      </div>
    </div>
  )
}

function CenteredStatus({title}: {title: string}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Spinner />
      <SizableText size="sm" className="text-muted-foreground">
        {title}
      </SizableText>
    </div>
  )
}

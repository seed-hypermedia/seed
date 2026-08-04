import {useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {fileUpload} from '@/utils/file-upload'
import {useNavigate} from '@/utils/useNavigate'
import {hmId} from '@shm/shared'
import {Dialog, DialogSideContent, DialogTitle} from '@shm/ui/components/dialog'
import {createSpaceMetadata} from '@shm/ui/create-space-platform'
import {CreateSpaceForm, type CreateSpaceFormState} from '@shm/ui/create-space-form'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {nanoid} from 'nanoid'
import {useCallback, useState} from 'react'

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

/**
 * The form with its desktop commit: populate a home document draft under
 * the selected identity with the collected metadata, then open the home editor.
 */
export function CreateSpaceFlow({onClose}: {onClose: () => void}) {
  const navigate = useNavigate()
  const selectedAccountId = useSelectedAccountId()
  const [busy, setBusy] = useState(false)

  async function handleComplete(state: CreateSpaceFormState) {
    if (!selectedAccountId) {
      toast.error('Create or select an identity before creating a space.')
      return
    }
    setBusy(true)
    try {
      // Upload images to IPFS, then write a populated home draft for
      // the selected identity.
      const [coverCid, logoCid, faviconCid] = await Promise.all([
        state.cover ? fileUpload(state.cover) : Promise.resolve(undefined),
        state.logo ? fileUpload(state.logo) : Promise.resolve(undefined),
        state.favicon ? fileUpload(state.favicon) : Promise.resolve(undefined),
      ])
      const metadata = createSpaceMetadata(state, {coverCid, logoCid, faviconCid})
      await client.drafts.write.mutate({
        id: nanoid(10),
        editUid: selectedAccountId,
        editPath: [],
        metadata,
        content: [],
        deps: [],
        visibility: 'PUBLIC',
      })
      // Open the home editor so the user can add content and publish.
      navigate({key: 'document', id: hmId(selectedAccountId, {path: []})})
      onClose()
    } catch (e) {
      toast.error('Failed to set up space: ' + (e instanceof Error ? e.message : String(e)))
      setBusy(false)
    }
  }

  if (busy) {
    return <CenteredStatus title="Setting up your space…" />
  }

  return <CreateSpaceForm onComplete={handleComplete} onClose={onClose} />
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

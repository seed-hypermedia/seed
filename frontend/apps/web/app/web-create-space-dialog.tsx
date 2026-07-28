import {useLocalKeyPair} from '@/auth'
import {createSpaceHomeDraft} from '@/document-edit/web-create-space-draft'
import {makeWebFileUpload} from '@/document-edit/web-image-upload'
import {webUniversalClient} from '@/universal-client'
import {useNavigate} from '@remix-run/react'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Dialog, DialogSideContent, DialogTitle} from '@shm/ui/components/dialog'
import {CreateSpaceForm, type CreateSpaceFormState} from '@shm/ui/create-space-form'
import {createSpaceMetadata} from '@shm/ui/create-space-platform'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useQuery} from '@tanstack/react-query'
import {useCallback, useMemo, useState} from 'react'

/** Whether the account already has a published home document. */
export function useHasExistingSpace(accountUid: string | null | undefined) {
  return useQuery({
    queryKey: ['create-space-existing-home', accountUid],
    enabled: !!accountUid,
    queryFn: async () => {
      if (!accountUid) return false
      try {
        const res = (await webUniversalClient.request('Resource', hmId(accountUid, {path: []}))) as {type?: string}
        return res?.type === 'document'
      } catch {
        return false
      }
    },
  })
}

/** Imperative opener for the web "Create a space" side panel. */
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
 * The form with its web commit: upload cover/logo to IPFS, write a home draft
 * under the signed-in account, and open the editor. Publishing that draft
 * creates the space. Same path as the `/hm/create-site` route.
 */
function CreateSpaceFlow({onClose}: {onClose: () => void}) {
  const navigate = useNavigate()
  const userKeyPair = useLocalKeyPair()
  const accountUid = userKeyPair?.delegatedAccountUid ?? userKeyPair?.id ?? null
  const [busy, setBusy] = useState(false)
  const fileUpload = useMemo(() => makeWebFileUpload(webUniversalClient), [])

  async function handleComplete(state: CreateSpaceFormState) {
    setBusy(true)
    try {
      const [coverCid, logoCid] = await Promise.all([
        state.cover ? fileUpload(state.cover) : Promise.resolve(undefined),
        state.logo ? fileUpload(state.logo) : Promise.resolve(undefined),
      ])
      const metadata = createSpaceMetadata(state, {coverCid, logoCid})
      const {webPath} = await createSpaceHomeDraft(metadata, accountUid)
      navigate(webPath)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create space')
      setBusy(false)
    }
  }

  if (busy) return <CenteredStatus title="Setting up your space…" />
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

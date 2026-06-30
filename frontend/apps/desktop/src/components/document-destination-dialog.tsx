import {useSelectedAccountWritableDocuments} from '@/models/access-control'
import {useMoveDocument, useRepublishDocument} from '@/models/documents'
import {useSelectedAccount} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  DocumentDestinationDialog as SharedDocumentDestinationDialog,
  type DocumentDestinationDialogInput,
  type DocumentDestinationMode,
  type DocumentDestinationSubmitInput,
  type WritableDocumentDestination,
} from '@shm/ui/document-destination-dialog'

export type {DocumentDestinationDialogInput, DocumentDestinationMode}

/** Adapts the shared destination dialog to desktop move and republish mutations. */
export function DocumentDestinationDialog({
  input,
  onClose,
}: {
  input: DocumentDestinationDialogInput
  onClose: () => void
}) {
  const selectedAccount = useSelectedAccount()
  const selectedAccountUid = selectedAccount?.id.uid
  const writableDocuments = useSelectedAccountWritableDocuments()
  const moveDocument = useMoveDocument()
  const republishDocument = useRepublishDocument()
  const navigate = useNavigate()

  async function onSubmit(submitInput: DocumentDestinationSubmitInput) {
    const mutation = submitInput.mode === 'move' ? moveDocument : republishDocument
    await mutation.mutateAsync({
      from: submitInput.from,
      to: submitInput.to,
      signingAccountId: submitInput.signingAccountId,
      origin: submitInput.origin,
    })
  }

  return (
    <SharedDocumentDestinationDialog
      input={input}
      onClose={onClose}
      selectedAccountUid={selectedAccountUid}
      writableDocuments={writableDocuments.map(toWritableDestination)}
      enabledModes={['move', 'republish']}
      onSubmit={onSubmit}
      onSuccess={({to}) => navigate({key: 'document', id: to})}
    />
  )
}

function toWritableDestination(document: {
  entity: {id: UnpackedHypermediaId; document?: any}
  accountsWithWrite: string[]
}): WritableDocumentDestination {
  return {
    id: document.entity.id,
    accountsWithWrite: document.accountsWithWrite,
    document: document.entity.document ?? null,
  }
}

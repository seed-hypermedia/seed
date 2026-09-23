import {useSelectedAccountWritableDocuments} from '@/models/access-control'
import {useCreateDraft, useMoveDocument, useMoveDraft, useRepublishDocument} from '@/models/documents'
import {useSelectedAccount} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  DOCUMENT_CREATE_MODES,
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
  const moveDraft = useMoveDraft()
  const republishDocument = useRepublishDocument()
  const navigate = useNavigate()
  const createDraft = useCreateDraft()

  async function onSubmit(submitInput: DocumentDestinationSubmitInput) {
    if (submitInput.mode === 'extend-schema') {
      // A new document draft at the chosen location, carrying a working schema rooted on the
      // base (`ref`); the Schema tab edits it, and publish freezes it into an IPFS blob.
      const baseCid = submitInput.extendSchema?.baseSchemaCid
      if (!baseCid) throw new Error('Missing base schema')
      await createDraft({
        location: {locationUid: submitInput.to.uid, locationPath: submitInput.to.path?.slice(0, -1) ?? []},
        initialMetadata: {name: submitInput.name || 'Extended Schema'},
        initialSchemaDraft: {type: `ipfs://${baseCid}`, properties: {}},
      })
      return
    }
    if (submitInput.mode === 'new-typed-document' || submitInput.mode === 'new-typed-collection') {
      // A new document draft at the chosen location, bound to the schema page: its own attributes
      // follow the schema (`attributesSchema`), or its children's do (`childAttributesSchema`).
      const schemaUrl = submitInput.typed?.schemaUrl
      if (!schemaUrl) throw new Error('Missing schema')
      const bindingKey = submitInput.mode === 'new-typed-document' ? 'attributesSchema' : 'childAttributesSchema'
      await createDraft({
        location: {locationUid: submitInput.to.uid, locationPath: submitInput.to.path?.slice(0, -1) ?? []},
        initialMetadata: {name: submitInput.name || 'Untitled', [bindingKey]: schemaUrl},
      })
      return
    }
    if (submitInput.draft?.draftId) {
      await moveDraft.mutateAsync({
        draftId: submitInput.draft.draftId,
        from: submitInput.from,
        to: submitInput.to,
        signingAccountId: submitInput.signingAccountId,
        origin: submitInput.origin,
      })
      return
    }
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
      enabledModes={['move', 'republish', 'extend-schema', 'new-typed-document', 'new-typed-collection']}
      onSubmit={onSubmit}
      // create modes: useCreateDraft already navigated to the new draft; `to` is the final
      // published path, which does not exist yet.
      onSuccess={({mode, to}) => {
        if (!DOCUMENT_CREATE_MODES.includes(mode)) navigate({key: 'document', id: to})
      }}
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

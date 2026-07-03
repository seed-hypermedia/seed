import {DocumentDestinationDialog} from '@/components/document-destination-dialog'
import {draftDocumentRouteId} from '@/utils/draft-route'
import {useChildDrafts, useCreateInlineDraft, useDeleteDraft, useUpdateDraftMetadata} from '@/models/documents'
import {useNavigate} from '@/utils/useNavigate'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {roleCanWrite, useSelectedAccountCapability} from '@shm/shared/models/capabilities'
import {useResource} from '@shm/shared/models/entity'
import {QueryBlockDraftSlotProps, useQueryBlockDrafts} from '@shm/shared/query-block-drafts-context'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useMemo} from 'react'

export function DesktopQueryBlockDraftSlot({targetId, children}: QueryBlockDraftSlotProps) {
  const navigate = useNavigate()
  const moveDraftDialog = useAppDialog(DocumentDestinationDialog, {className: 'w-full max-w-2xl'})
  const capability = useSelectedAccountCapability(targetId ?? undefined)
  const canEdit = roleCanWrite(capability?.role)
  const resource = useResource(targetId)
  const doc = resource.data?.type === 'document' ? resource.data.document : undefined
  const isPrivate = doc?.visibility === 'PRIVATE'

  const childDrafts = useChildDrafts(targetId ?? undefined)
  const createInlineDraft = useCreateInlineDraft(targetId ?? undefined)
  const deleteDraft = useDeleteDraft()
  const updateDraftMetadata = useUpdateDraftMetadata()
  const {lastCreatedDraftId, setLastCreatedDraftId} = useQueryBlockDrafts()

  const drafts = useMemo(
    () =>
      childDrafts
        .slice()
        .reverse()
        .map((draft) => ({draft, autoFocus: draft.id === lastCreatedDraftId})),
    [childDrafts, lastCreatedDraftId],
  )

  const onCreateDraft = useMemo(() => {
    if (!targetId || !canEdit || isPrivate) return undefined
    return () => {
      createInlineDraft.mutate(
        {},
        {
          onSuccess: ({draftId}) => {
            setLastCreatedDraftId?.(draftId)
          },
        },
      )
    }
  }, [targetId, canEdit, isPrivate, createInlineDraft, setLastCreatedDraftId])

  return (
    <>
      {children({
        drafts,
        onCreateDraft,
        onOpenDraft: (draftId) => {
          const draft = childDrafts.find((d) => d.id === draftId)
          if (!draft) return
          const targetId = draftDocumentRouteId(draft)
          if (!targetId) return
          navigate({
            key: 'document',
            id: targetId,
          })
        },
        onDeleteDraft: (draftId) => deleteDraft.mutate(draftId),
        onMoveDraft: (draftId) => {
          const draft = childDrafts.find((draft) => draft.id === draftId)
          if (!draft) return
          const sourceId = draftDocumentRouteId(draft)
          if (!sourceId) return
          moveDraftDialog.open({
            id: sourceId,
            mode: 'move',
            origin: draft.locationUid
              ? {parentDocumentId: hmId(draft.locationUid, {path: draft.locationPath ?? []})}
              : undefined,
            draft: {draftId, title: draft.metadata?.name, icon: draft.metadata?.icon},
          })
        },
        onUpdateDraftName: (draftId, name) => updateDraftMetadata.mutate({draftId, metadata: {name}}),
      })}
      {moveDraftDialog.content}
    </>
  )
}

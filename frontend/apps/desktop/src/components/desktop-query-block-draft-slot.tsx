import {useChildDrafts, useCreateInlineDraft, useDeleteDraft, useUpdateDraftMetadata} from '@/models/documents'
import {useNavigate} from '@/utils/useNavigate'
import {roleCanWrite, useSelectedAccountCapability} from '@shm/shared/models/capabilities'
import {useResource} from '@shm/shared/models/entity'
import {QueryBlockDraftSlotProps} from '@shm/shared/query-block-drafts-context'
import {useMemo, useState} from 'react'

export function DesktopQueryBlockDraftSlot({targetId, children}: QueryBlockDraftSlotProps) {
  const navigate = useNavigate()
  const capability = useSelectedAccountCapability(targetId ?? undefined)
  const canEdit = roleCanWrite(capability?.role)
  const resource = useResource(targetId)
  const doc = resource.data?.type === 'document' ? resource.data.document : undefined
  const isPrivate = doc?.visibility === 'PRIVATE'

  const childDrafts = useChildDrafts(targetId ?? undefined)
  const createInlineDraft = useCreateInlineDraft(targetId ?? undefined)
  const deleteDraft = useDeleteDraft()
  const updateDraftMetadata = useUpdateDraftMetadata()
  const [lastCreatedDraftId, setLastCreatedDraftId] = useState<string | null>(null)

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
            setLastCreatedDraftId(draftId)
          },
        },
      )
    }
  }, [targetId, canEdit, isPrivate, createInlineDraft])

  return (
    <>
      {children({
        drafts,
        onCreateDraft,
        onOpenDraft: (draftId) => navigate({key: 'draft', id: draftId}),
        onDeleteDraft: (draftId) => deleteDraft.mutate(draftId),
        onUpdateDraftName: (draftId, name) => updateDraftMetadata.mutate({draftId, metadata: {name}}),
      })}
    </>
  )
}

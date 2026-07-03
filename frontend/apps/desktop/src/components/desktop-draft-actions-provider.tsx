import {useDraft} from '@/models/accounts'
import {client} from '@/trpc'
import {useNavigate} from '@/utils/useNavigate'
import {DocumentDestinationDialog} from '@/components/document-destination-dialog'
import {DraftActions, DraftActionsContext} from '@shm/editor/draft-actions-context'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {buildInlineDraftWrite} from '@shm/shared/utils/inline-draft'
import {nanoid} from 'nanoid'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {PropsWithChildren, useMemo, useState} from 'react'

/**
 * Provides DraftActions to the editor: creates / fetches / deletes / navigates
 * to inline child drafts. Pass `canCreateInlineDraft={false}` when the parent
 * is an upublished draft to avoid orphaning the child draft under a placeholder path segment.
 */
export function DesktopDraftActionsProvider({
  canCreateInlineDraft = true,
  children,
}: PropsWithChildren<{canCreateInlineDraft?: boolean}>) {
  const navigate = useNavigate()
  const moveDraftDialog = useAppDialog(DocumentDestinationDialog, {className: 'w-full max-w-2xl'})
  const [lastCreatedInlineDraftId, setLastCreatedInlineDraftId] = useState<string | null>(null)

  const value = useMemo<DraftActions>(
    () => ({
      // Mirrors useCreateInlineDraft. Inlined here because the slash menu's
      // execute runs imperatively outside React, so it consumes a plain async function.
      onCreateInlineDraft: canCreateInlineDraft
        ? async (parentId, options) => {
            const writeParams = buildInlineDraftWrite({
              parentId,
              draftId: nanoid(10),
              options,
            })
            await client.drafts.write.mutate(writeParams)
            invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT, parentId.uid])
            invalidateQueries([queryKeys.DRAFTS_LIST])
            setLastCreatedInlineDraftId(writeParams.id)
            return {draftId: writeParams.id, draftPath: writeParams.editPath}
          }
        : undefined,
      useInlineDraft: useDraft,
      onDeleteDraft: async (id) => {
        await client.drafts.delete.mutate(id)
        invalidateQueries([queryKeys.DRAFT, id])
        invalidateQueries([queryKeys.DRAFTS_LIST])
        invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
      },
      onOpenDraft: (draftId, draftPath) => {
        // Resolve editUid via stored draft data, then navigate to the document route.
        client.drafts.get.query(draftId).then((draft) => {
          if (!draft) return
          const editUid = draft.editUid ?? draft.locationUid
          if (!editUid) return
          const editPath = draft.editPath?.length ? draft.editPath : draftPath
          navigate({key: 'document', id: hmId(editUid, {path: editPath})})
        })
      },
      onMoveDraft: (draftId, origin) => {
        client.drafts.get.query(draftId).then((draft) => {
          if (!draft) return
          const editUid = draft.editUid ?? draft.locationUid
          if (!editUid) return
          const editPath = draft.editPath?.length ? draft.editPath : [...(draft.locationPath ?? []), `-${draftId}`]
          moveDraftDialog.open({
            id: hmId(editUid, {path: editPath}),
            mode: 'move',
            origin: draft.locationUid
              ? {
                  parentDocumentId: hmId(draft.locationUid, {path: draft.locationPath ?? []}),
                  embedBlockId: origin?.embedBlockId,
                }
              : undefined,
            draft: {draftId, title: draft.metadata?.name, icon: draft.metadata?.icon},
          })
        })
      },
      onUpdateDraftName: async (draftId, name) => {
        const draft = await client.drafts.get.query(draftId)
        if (!draft) throw new Error(`Draft ${draftId} not found`)
        await client.drafts.write.mutate({
          id: draft.id,
          locationUid: draft.locationUid,
          locationPath: draft.locationPath,
          editUid: draft.editUid,
          editPath: draft.editPath,
          metadata: {...draft.metadata, name},
          content: draft.content,
          deps: draft.deps,
          navigation: draft.navigation,
          visibility: draft.visibility,
        })
        invalidateQueries([queryKeys.DRAFT, draftId])
        invalidateQueries([queryKeys.DRAFTS_LIST])
        invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
      },
      lastCreatedInlineDraftId,
      clearLastCreatedInlineDraftId: (draftId) => {
        setLastCreatedInlineDraftId((current) => (current === draftId ? null : current))
      },
    }),
    [navigate, canCreateInlineDraft, lastCreatedInlineDraftId, moveDraftDialog],
  )

  return (
    <DraftActionsContext.Provider value={value}>
      {children}
      {moveDraftDialog.content}
    </DraftActionsContext.Provider>
  )
}

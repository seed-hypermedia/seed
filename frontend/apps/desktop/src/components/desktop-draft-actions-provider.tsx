import {useDraft} from '@/models/accounts'
import {client} from '@/trpc'
import {useNavigate} from '@/utils/useNavigate'
import {DraftActions, DraftActionsContext} from '@shm/editor/draft-actions-context'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {nanoid} from 'nanoid'
import {PropsWithChildren, useMemo} from 'react'

/**
 * Provides DraftActions to the editor: creates / fetches / deletes / navigates
 * to inline child drafts.
 */
export function DesktopDraftActionsProvider({children}: PropsWithChildren) {
  const navigate = useNavigate()

  const value = useMemo<DraftActions>(
    () => ({
      // Mirrors useCreateInlineDraft. Inlined here because the slash menu's
      // execute runs imperatively outside React, so it consumes a plain async function.
      onCreateInlineDraft: async (parentId, options) => {
        const draftId = nanoid(10)
        const parentPath = parentId.path || []
        const draftPath = [...parentPath, `-${draftId}`]
        await client.drafts.write.mutate({
          id: draftId,
          locationUid: parentId.uid,
          locationPath: parentPath,
          editUid: parentId.uid,
          editPath: draftPath,
          metadata: {name: options?.name ?? ''},
          content: options?.initialContent ?? [],
          deps: [],
          visibility: 'PUBLIC',
        })
        invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT, parentId.uid])
        invalidateQueries([queryKeys.DRAFTS_LIST])
        return {draftId, draftPath}
      },
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
    }),
    [navigate],
  )

  return <DraftActionsContext.Provider value={value}>{children}</DraftActionsContext.Provider>
}

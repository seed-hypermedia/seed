import {BranchDialog} from '@/components/branch-dialog'
import {useDeleteDialog} from '@/components/delete-dialog'
import {MoveDialog} from '@/components/move-dialog'
import {useBookmarks} from '@/models/bookmarks'
import {useMyAccountIds} from '@/models/daemon'
import {useAccountDraftList} from '@/models/documents'
import {useSelectedAccountId} from '@/selected-account'
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {HMBlockNode, HMDocument, HMListedDraft, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {pathMatches} from '@shm/shared/utils/entity-id-url'
import {hmBlocksToEditorContent} from '@shm/shared/client/hmblock-to-editorblock'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import {useUniversalAppContext} from '@shm/shared'
import {useAppContext} from '@/app-context'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useNavigate} from '@shm/shared/utils/navigation'
import {nanoid} from 'nanoid'
import {PropsWithChildren, useCallback, useMemo} from 'react'
import {useMutation} from '@tanstack/react-query'
import {SizableText} from '@shm/ui/text'
import {toast} from 'sonner'

export function DesktopDocumentActionsProvider({children}: PropsWithChildren) {
  const selectedAccountId = useSelectedAccountId()
  const myAccountIds = useMyAccountIds()
  const bookmarks = useBookmarks()
  const navigate = useNavigate()
  const {exportDocument, openDirectory} = useAppContext()
  const {onCopyReference} = useUniversalAppContext()
  const drafts = useAccountDraftList(selectedAccountId ?? undefined)

  const moveDialog = useAppDialog(MoveDialog)
  const branchDialog = useAppDialog(BranchDialog)
  const deleteDialog = useDeleteDialog()

  const setBookmark = useMutation({
    mutationFn: (input: {url: string; isBookmark: boolean}) => client.bookmarks.setBookmark.mutate(input),
    onSuccess: () => {
      invalidateQueries([queryKeys.BOOKMARKS])
    },
  })

  const isBookmarked = useCallback(
    (id: UnpackedHypermediaId) => {
      return bookmarks?.some((bookmark) => bookmark && bookmark.id === id.id) ?? false
    },
    [bookmarks],
  )

  const onBookmarkToggle = useCallback(
    (id: UnpackedHypermediaId) => {
      const bookmarked = bookmarks?.some((bookmark) => bookmark && bookmark.id === id.id) ?? false
      setBookmark.mutate({url: id.id, isBookmark: !bookmarked})
    },
    [bookmarks, setBookmark],
  )

  const onEditDocument = useCallback(
    (id: UnpackedHypermediaId, existingDraftId?: string) => {
      if (existingDraftId) {
        navigate({key: 'draft', id: existingDraftId, panel: null})
      } else {
        navigate({
          key: 'draft',
          id: nanoid(10),
          editUid: id.uid,
          editPath: id.path || [],
          deps: id.version ? [id.version] : undefined,
          panel: null,
        })
      }
    },
    [navigate],
  )

  const onMoveDocument = useCallback(
    (id: UnpackedHypermediaId) => {
      moveDialog.open({id})
    },
    [moveDialog],
  )

  const onDeleteDocument = useCallback(
    (id: UnpackedHypermediaId, onSuccess?: () => void) => {
      deleteDialog.open({id, onSuccess})
    },
    [deleteDialog],
  )

  const onBranchDocument = useCallback(
    (id: UnpackedHypermediaId) => {
      branchDialog.open(id)
    },
    [branchDialog],
  )

  const onExportDocument = useCallback(
    async (doc: HMDocument) => {
      const title = doc.metadata.name || 'document'
      const blocks: HMBlockNode[] | undefined = doc.content || undefined
      const editorBlocks = hmBlocksToEditorContent(blocks, {childrenType: 'Group'})
      const {markdownContent, mediaFiles} = await convertBlocksToMarkdown(editorBlocks, doc)
      exportDocument(title, markdownContent, mediaFiles)
        .then((res) => {
          toast.success(
            <div className="flex max-w-[700px] flex-col gap-1.5">
              <SizableText className="text-wrap break-all">
                Successfully exported document &quot;{title}&quot; to: <b>{`${res}`}</b>.
              </SizableText>
              <SizableText
                className="text-current underline"
                onClick={() => {
                  // @ts-expect-error
                  openDirectory(res)
                }}
              >
                Show directory
              </SizableText>
            </div>,
          )
        })
        .catch((err) => {
          toast.error(err)
        })
    },
    [exportDocument, openDirectory],
  )

  const onCopyLink = useCallback(
    (id: UnpackedHypermediaId) => {
      onCopyReference?.(id)
    },
    [onCopyReference],
  )

  const getDraftId = useCallback(
    (id: UnpackedHypermediaId) => {
      const draft = drafts.data?.find((d: HMListedDraft) => {
        if (!d.editUid) return false
        return id.uid === d.editUid && pathMatches(d.editPath || [], id.path)
      })
      return draft?.id
    },
    [drafts.data],
  )

  const value = useMemo(
    () => ({
      selectedAccountUid: selectedAccountId ?? undefined,
      myAccountIds: myAccountIds.data,
      isBookmarked,
      onBookmarkToggle,
      onEditDocument,
      onMoveDocument,
      onDeleteDocument,
      onBranchDocument,
      onExportDocument,
      onCopyLink,
      getDraftId,
    }),
    [
      selectedAccountId,
      myAccountIds.data,
      isBookmarked,
      onBookmarkToggle,
      onEditDocument,
      onMoveDocument,
      onDeleteDocument,
      onBranchDocument,
      onExportDocument,
      onCopyLink,
      getDraftId,
    ],
  )

  return (
    <DocumentActionsProvider {...value}>
      {children}
      {moveDialog.content}
      {branchDialog.content}
      {deleteDialog.content}
    </DocumentActionsProvider>
  )
}

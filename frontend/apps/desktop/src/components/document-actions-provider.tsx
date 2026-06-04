import {useAppContext} from '@/app-context'
import {BranchDialog} from '@/components/branch-dialog'
import {useDeleteDialog} from '@/components/delete-dialog'
import {MoveDialog} from '@/components/move-dialog'
import {useBookmarks} from '@/models/bookmarks'
import {useMyAccountIds} from '@/models/daemon'
import {useAccountDraftList} from '@/models/documents'
import {useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {HMBlockNode, HMDocument, HMListedDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import {queryResource} from '@shm/shared/models/queries'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId, latestId, pathMatches} from '@shm/shared/utils/entity-id-url'
import {useNavigate} from '@shm/shared/utils/navigation'
import {SizableText} from '@shm/ui/text'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useMutation} from '@tanstack/react-query'
import {nanoid} from 'nanoid'
import {PropsWithChildren, useCallback, useMemo} from 'react'
import {ResourceVisibility} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {buildRestoreVersionChanges} from '@shm/shared/utils/restore-document-version'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {toast} from 'sonner'

export function DesktopDocumentActionsProvider({children}: PropsWithChildren) {
  const selectedAccountId = useSelectedAccountId()
  const myAccountIds = useMyAccountIds()
  const bookmarks = useBookmarks()
  const navigate = useNavigate()
  const {exportDocument, openDirectory} = useAppContext()
  const {onCopyReference} = useUniversalAppContext()
  const universalClient = useUniversalClient()
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
      return bookmarks?.some((bookmark) => bookmark.url === id.id) ?? false
    },
    [bookmarks],
  )

  const onBookmarkToggle = useCallback(
    (id: UnpackedHypermediaId) => {
      const bookmarked = bookmarks?.some((bookmark) => bookmark.url === id.id) ?? false
      setBookmark.mutate({url: id.id, isBookmark: !bookmarked})
    },
    [bookmarks, setBookmark],
  )

  const onEditDocument = useCallback(
    async (id: UnpackedHypermediaId, existingDraftId?: string) => {
      if (existingDraftId) {
        navigate({key: 'document', id, panel: null})
        return
      }
      const draftId = nanoid(10)
      await client.drafts.write.mutate({
        id: draftId,
        editUid: id.uid,
        editPath: id.path || [],
        metadata: {},
        content: [],
        deps: id.version ? [id.version] : [],
        visibility: 'PUBLIC',
      })
      navigate({key: 'document', id, panel: null})
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

  const onDuplicateDocument = useCallback(
    async (id: UnpackedHypermediaId) => {
      try {
        const resource = await queryClient.fetchQuery(queryResource(universalClient, id))
        const doc = resource?.type === 'document' ? resource.document : null
        if (!doc) {
          toast.error('Could not load document to duplicate')
          return
        }

        const editorContent = hmBlocksToEditorContent(doc.content || [], {childrenType: 'Group'})
        const sourceName = doc.metadata?.name || 'Untitled'
        const copyName = `${sourceName} Copy`
        const draftId = nanoid(10)
        const parentPath = id.path?.slice(0, -1) || []

        const draftEditPath = [...parentPath, `-${draftId}`]
        await client.drafts.write.mutate({
          id: draftId,
          locationUid: id.uid,
          locationPath: parentPath,
          editUid: id.uid,
          editPath: draftEditPath,
          metadata: {...doc.metadata, name: copyName},
          content: editorContent,
          deps: [],
          visibility: doc.visibility,
        })

        sessionStorage.setItem('duplicate-draft-focus', draftId)
        navigate({
          key: 'document',
          id: hmId(id.uid, {path: draftEditPath}),
          panel: null,
        })
        toast.success(`Duplicated "${sourceName}"`)
      } catch (error) {
        console.error('Error duplicating document:', error)
        toast.error('Failed to duplicate document')
      }
    },
    [navigate, universalClient],
  )

  const onCopyLink = useCallback(
    (id: UnpackedHypermediaId) => {
      onCopyReference?.(id)
    },
    [onCopyReference],
  )

  const getDraft = useCallback(
    (id: UnpackedHypermediaId) => {
      return drafts.data?.find((d: HMListedDraft) => {
        if (!d.editUid) return false
        return id.uid === d.editUid && pathMatches(d.editPath || [], id.path)
      })
    },
    [drafts.data],
  )

  const getDraftId = useCallback((id: UnpackedHypermediaId) => getDraft(id)?.id, [getDraft])

  const onRestoreDocumentVersion = useCallback(
    async (id: UnpackedHypermediaId, selectedVersion: HMDocument) => {
      if (!selectedAccountId) {
        toast.error('Select an account before restoring a version')
        return
      }
      if (!universalClient.publishDocument) {
        toast.error('Restore is not available in this client')
        return
      }

      try {
        const targetId = latestId(id)
        const latestResource = await queryClient.fetchQuery(queryResource(universalClient, targetId))
        const latestDocument = latestResource?.type === 'document' ? latestResource.document : null
        if (!latestDocument?.version) throw new Error('Could not load the latest document version')
        if (latestDocument.version === selectedVersion.version) {
          toast.info('This version is already the latest version')
          return
        }

        const changes = buildRestoreVersionChanges(latestDocument, selectedVersion)
        if (!changes.length) {
          toast.info('This version matches the latest version')
          return
        }

        let capability = ''
        if (selectedAccountId !== targetId.uid) {
          const result = await universalClient.request('ListCapabilities', {targetId})
          const rawCapability = result.capabilities.find(
            (cap: any) => cap.delegate === selectedAccountId && String(cap.role || '').toUpperCase() === 'WRITER',
          )
          if (!rawCapability?.id) throw new Error('Could not find write capability for selected account')
          capability = rawCapability.id
        }

        await universalClient.publishDocument({
          signerAccountUid: selectedAccountId,
          account: targetId.uid,
          path: hmIdPathToEntityQueryPath(targetId.path || []),
          baseVersion: latestDocument.version,
          changes,
          capability,
          visibility: ResourceVisibility.UNSPECIFIED,
          genesis: latestDocument.genesis,
          generation: latestDocument.generationInfo?.generation,
        })

        const draftId = getDraftId(targetId)
        if (draftId) {
          await client.drafts.delete.mutate(draftId)
        }

        invalidateQueries([queryKeys.ENTITY])
        invalidateQueries([queryKeys.ACTIVITY_FEED])
        invalidateQueries([queryKeys.DRAFTS_LIST])
        invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
        if (draftId) invalidateQueries([queryKeys.DRAFT, draftId])

        navigate({key: 'document', id: targetId})
        toast.success('Document restored successfully')
      } catch (error) {
        console.error('Failed to restore document version:', error)
        toast.error(error instanceof Error ? error.message : 'Failed to restore document version')
        throw error
      }
    },
    [getDraftId, navigate, selectedAccountId, universalClient],
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
      onDuplicateDocument,
      onRestoreDocumentVersion,
      onExportDocument,
      onCopyLink,
      getDraftId,
      getDraft,
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
      onDuplicateDocument,
      onRestoreDocumentVersion,
      onExportDocument,
      onCopyLink,
      getDraftId,
      getDraft,
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

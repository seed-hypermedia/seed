import {useAppContext} from '@/app-context'
import {BranchDialog} from '@/components/branch-dialog'
import {AddCollaboratorForm} from '@/components/collaborators-panel'
import {CommentBox, triggerCommentDraftFocus} from '@/components/commenting'
import {CreateDocumentButton} from '@/components/create-doc-button'
import {useDeleteDialog} from '@/components/delete-dialog'
import {DesktopDocumentActionsProvider} from '@/components/document-actions-provider'
import {InlineNewDocumentCard} from '@/components/inline-new-document-card'
import {MoveDialog} from '@/components/move-dialog'
import {roleCanWrite, useSelectedAccountCapability} from '@/models/access-control'
import {useMyAccountIds} from '@/models/daemon'
import {useChildDrafts, useCreateInlineDraft} from '@/models/documents'
import {useExistingDraft} from '@/models/drafts'
import {useSelectedAccount} from '@/selected-account'
import {client} from '@/trpc'
import {useHackyAuthorsSubscriptions} from '@/use-hacky-authors-subscriptions'
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {useNavigate} from '@/utils/useNavigate'
import {hmId} from '@shm/shared'
import {hmBlocksToEditorContent} from '@shm/shared/client/hmblock-to-editorblock'
import {CommentsProvider, isRouteEqualToCommentTarget, useDeleteComment} from '@shm/shared/comments-service-provider'
import {HMBlockNode, HMComment} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {useNavRoute, useNavigationDispatch} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {useDeleteCommentDialog} from '@shm/ui/comments'
import {Download, SubscribeSpace, Trash} from '@shm/ui/icons'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {ResourcePage} from '@shm/ui/resource-page-common'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {SubscriptionButton} from '@/components/subscription'
import {useSubscription} from '@/models/subscription'
import {Copy, ForwardIcon, GitFork, Pencil} from 'lucide-react'
import {nanoid} from 'nanoid'
import {useCallback, useMemo, useState} from 'react'

export default function DesktopResourcePage() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const replace = useNavigate('replace')

  // Only handle document-related routes
  const supportedKeys = ['document', 'directory', 'collaborators', 'activity', 'comments']
  if (!supportedKeys.includes(route.key)) {
    throw new Error(`DesktopResourcePage: unsupported route ${route.key}`)
  }

  // @ts-expect-error - route.id exists on all supported route types
  const docId = route.id
  if (!docId) throw new Error('No document ID in route')

  const dispatch = useNavigationDispatch()
  const existingDraft = useExistingDraft(route)
  const capability = useSelectedAccountCapability(docId)
  const canEdit = roleCanWrite(capability?.role)
  const myAccountIds = useMyAccountIds()

  // Get site URL for CreateDocumentButton
  const siteHomeResource = useResource(hmId(docId.uid), {subscribed: true})
  const siteUrl =
    siteHomeResource.data?.type === 'document' ? siteHomeResource.data.document?.metadata?.siteUrl : undefined

  // Hooks for options dropdown
  const resource = useResource(docId)
  const doc = resource.data?.type === 'document' ? resource.data.document : undefined
  const isPrivate = doc?.visibility === 'PRIVATE'
  const siteId = hmId(docId.uid)
  const subscription = useSubscription(siteId)
  const docIsInMyAccount = myAccountIds.data?.includes(docId.uid)
  const isSubscribedToSite = subscription.subscription === 'space' || subscription.subscription === 'parent'

  // Inline document creation
  const childDrafts = useChildDrafts(docId)
  const createInlineDraft = useCreateInlineDraft(docId)
  const [lastCreatedDraftId, setLastCreatedDraftId] = useState<string | null>(null)
  const inlineCards = useMemo(() => {
    if (!childDrafts.length) return null
    return (
      <div className="mt-6 grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:grid-cols-3">
        {childDrafts.map((draft) => (
          <InlineNewDocumentCard key={draft.id} draft={draft} autoFocus={draft.id === lastCreatedDraftId} />
        ))}
      </div>
    )
  }, [childDrafts, lastCreatedDraftId])

  // Comment deletion
  const selectedAccount = useSelectedAccount()
  const deleteComment = useDeleteComment()
  const deleteCommentDialog = useDeleteCommentDialog()
  const currentAccountId = selectedAccount?.id.uid
  const onCommentDelete = useCallback(
    (commentId: string, signingAccountId?: string) => {
      if (!signingAccountId) return
      deleteCommentDialog.open({
        onConfirm: () => {
          deleteComment.mutate({
            commentId,
            targetDocId: docId,
            signingAccountId,
          })
        },
      })
    },
    [docId, currentAccountId],
  )

  const {exportDocument, openDirectory} = useAppContext()
  const deleteEntity = useDeleteDialog()
  const branchDialog = useAppDialog(BranchDialog)
  const moveDialog = useAppDialog(MoveDialog)

  const menuItems: MenuItemType[] = []

  if (canEdit && myAccountIds.data?.length && docId.path?.length) {
    menuItems.push({
      key: 'move',
      label: 'Move Document',
      icon: <ForwardIcon className="size-4" />,
      onClick: () => moveDialog.open({id: docId}),
    })
  }

  if (canEdit && docId.path?.length) {
    menuItems.push({
      key: 'duplicate',
      label: 'Duplicate Document',
      icon: <Copy className="size-4" />,
      onClick: async () => {
        if (!doc) return
        try {
          const editorContent = hmBlocksToEditorContent(doc.content || [], {childrenType: 'Group'})
          const sourceName = doc.metadata?.name || 'Untitled'
          const copyName = `${sourceName} Copy`
          const draftId = nanoid(10)
          const parentPath = docId.path?.slice(0, -1) || []

          await client.drafts.write.mutate({
            id: draftId,
            locationUid: docId.uid,
            locationPath: parentPath,
            metadata: {...doc.metadata, name: copyName},
            content: editorContent,
            deps: [],
            visibility: doc.visibility,
          })

          sessionStorage.setItem('duplicate-draft-focus', draftId)
          navigate({key: 'draft', id: draftId, panel: null})
          toast.success(`Duplicated "${sourceName}"`)
        } catch (error) {
          console.error('Error duplicating document:', error)
          toast.error('Failed to duplicate document')
        }
      },
    })
  }

  menuItems.push({
    key: 'export',
    label: 'Export Document',
    icon: <Download className="size-4" />,
    onClick: async () => {
      if (!doc) return
      const title = doc?.metadata.name || 'document'
      const blocks: HMBlockNode[] | undefined = doc?.content || undefined
      const editorBlocks = hmBlocksToEditorContent(blocks, {
        childrenType: 'Group',
      })
      const markdownWithFiles = await convertBlocksToMarkdown(editorBlocks, doc)
      const {markdownContent, mediaFiles} = markdownWithFiles
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
  })

  if (myAccountIds.data?.length) {
    menuItems.push({
      key: 'branch',
      label: 'Create Document Branch',
      icon: <GitFork className="size-4" />,
      onClick: () => branchDialog.open(docId),
    })
  }

  if (!docIsInMyAccount && !isSubscribedToSite && !subscription.isLoading) {
    menuItems.push({
      key: 'subscribe-site',
      label: 'Subscribe to Site',
      icon: <SubscribeSpace size={16} />,
      onClick: () => {
        subscription.setSubscription('space')
      },
    })
  }

  if (canEdit && docId.path?.length) {
    menuItems.push({
      key: 'delete',
      label: 'Delete Document',
      icon: <Trash className="size-4" />,
      variant: 'destructive',
      onClick: () => {
        deleteEntity.open({
          id: docId,
          onSuccess: () => {
            dispatch({
              type: 'backplace',
              route: {
                key: 'document',
                id: hmId(docId.uid, {
                  path: docId.path?.slice(0, -1),
                }),
              } as any,
            })
          },
        })
      },
    })
  }

  const editActions = canEdit ? (
    <>
      <Tooltip content={existingDraft ? 'Resume Editing' : 'Edit'}>
        <Button
          size="icon"
          variant="outline"
          className={cn(existingDraft ? 'bg-yellow-200 hover:bg-yellow-300' : '')}
          onClick={() => {
            if (existingDraft) {
              navigate({
                key: 'draft',
                id: existingDraft.id,
                panel: null,
              })
            } else {
              navigate({
                key: 'draft',
                id: nanoid(10),
                editUid: docId.uid,
                editPath: docId.path || [],
                deps: docId.version ? [docId.version] : undefined,
                panel: null,
              })
            }
          }}
        >
          <Pencil className="size-3.5" />
        </Button>
      </Tooltip>
      {!isPrivate && (
        <CreateDocumentButton
          locationId={docId}
          siteUrl={siteUrl}
          onInlineCreate={(opts) => {
            createInlineDraft.mutate(
              {visibility: opts?.visibility},
              {
                onSuccess: ({draftId}) => {
                  setLastCreatedDraftId(draftId)
                },
              },
            )
          }}
        />
      )}
    </>
  ) : null

  const onReplyClick = useCallback(
    (replyComment: HMComment) => {
      const targetRoute = isRouteEqualToCommentTarget({
        id: docId,
        comment: replyComment,
      })
      if (targetRoute) {
        navigate({
          key: 'document',
          id: targetRoute,
          panel: {
            key: 'comments',
            id: targetRoute,
            openComment: replyComment.id,
            isReplying: true,
          },
        })
      } else if (route.key === 'comments') {
        // Already viewing discussions in main — update in place
        replace({...route, openComment: replyComment.id, isReplying: true})
      } else {
        replace({
          ...route,
          panel: {
            key: 'comments',
            id: docId,
            openComment: replyComment.id,
            isReplying: true,
          },
        } as any)
      }
      triggerCommentDraftFocus(docId.id, replyComment.id)
    },
    [route, docId, navigate, replace],
  )

  const onReplyCountClick = useCallback(
    (replyComment: HMComment) => {
      const targetRoute = isRouteEqualToCommentTarget({
        id: docId,
        comment: replyComment,
      })
      if (targetRoute) {
        navigate({
          key: 'document',
          id: targetRoute,
          panel: {
            key: 'comments',
            id: targetRoute,
            openComment: replyComment.id,
          },
        })
      } else if (route.key === 'comments') {
        replace({...route, openComment: replyComment.id})
      } else {
        replace({
          ...route,
          panel: {
            key: 'comments',
            id: docId,
            openComment: replyComment.id,
          },
        } as any)
      }
    },
    [route, docId, navigate, replace],
  )

  return (
    <div className="h-full max-h-full overflow-hidden rounded-lg border bg-white">
      <CommentsProvider
        useHackyAuthorsSubscriptions={useHackyAuthorsSubscriptions}
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
      >
        <DesktopDocumentActionsProvider>
          <ResourcePage
            docId={docId}
            CommentEditor={CommentBox}
            extraMenuItems={menuItems}
            editActions={editActions}
            existingDraft={existingDraft}
            collaboratorForm={<AddCollaboratorForm id={docId} />}
            inlineCards={inlineCards}
            rightActions={<SubscriptionButton id={docId} />}
            currentAccountId={currentAccountId}
            onCommentDelete={onCommentDelete}
            deleteCommentDialogContent={deleteCommentDialog.content}
          />
        </DesktopDocumentActionsProvider>
      </CommentsProvider>
      {deleteEntity.content}
      {branchDialog.content}
      {moveDialog.content}
    </div>
  )
}

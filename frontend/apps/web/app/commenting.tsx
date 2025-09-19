import {createComment, postCBOR} from '@/api'
import {LocalWebIdentity, useCreateAccount} from '@/auth'
import {injectModels} from '@/models'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {CommentEditor} from '@shm/editor/comment-editor'
import {
  ENABLE_EMAIL_NOTIFICATIONS,
  HMBlockNode,
  hostnameStripProtocol,
  idToUrl,
  packHmId,
  queryKeys,
  UnpackedHypermediaId,
  unpackHmId,
  useUniversalAppContext,
  WEB_IDENTITY_ORIGIN,
} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {EditProfileDialog} from '@/auth'
import {useTx, useTxString} from '@shm/shared/translation'
import {Button, buttonVariants} from '@shm/ui/button'
import {DialogTitle} from '@shm/ui/components/dialog'
import {DocContentProvider} from '@shm/ui/document-content'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {MemoryBlockstore} from 'blockstore-core/memory'
import {importer as unixFSImporter} from 'ipfs-unixfs-importer'
import {SendHorizontal} from 'lucide-react'
import type {CID} from 'multiformats'
import {useEffect, useState} from 'react'
import {useCommentDraftPersistence} from './comment-draft-utils'
import {redirectToWebIdentityCommenting} from './commenting-utils'
import {EmailNotificationsForm} from './email-notifications'
import {useEmailNotifications} from './email-notifications-models'
import {
  hasPromptedEmailNotifications,
  setHasPromptedEmailNotifications,
} from './local-db'
import type {
  CommentPayload,
  CommentResponsePayload,
} from './routes/hm.api.comment'
import {EmbedDocument, EmbedInline, QueryBlockWeb} from './web-embeds'
injectModels()

export type WebCommentingProps = {
  docId: UnpackedHypermediaId
  replyCommentVersion?: string | null
  replyCommentId?: string | null
  rootReplyCommentVersion?: string | null
  quotingBlockId?: string
  onDiscardDraft?: () => void
  onSuccess?: (successData: {
    id: string
    response: CommentResponsePayload
    commentPayload: CommentPayload
  }) => void
  enableWebSigning: boolean
  commentingOriginUrl?: string
  autoFocus?: boolean
}

/**
 * This is the main commenting component. It is used to create a new comment.
 */
export default function WebCommenting(props: WebCommentingProps) {
  return <LocalWebCommenting {...props} />
}

export function ExternalWebCommenting(props: WebCommentingProps) {
  const tx = useTx()
  return (
    <Button
      variant="default"
      onClick={() => {
        redirectToWebIdentityCommenting(props.docId, {
          replyCommentId: props.replyCommentId,
          replyCommentVersion: props.replyCommentVersion,
          rootReplyCommentVersion: props.rootReplyCommentVersion,
          quotingBlockId: props.quotingBlockId,
        })
      }}
      className="w-full"
    >
      {tx(
        'comment_with_identity',
        (args: {host: string}) => `Comment with ${args.host} Identity`,
        {
          host: hostnameStripProtocol(WEB_IDENTITY_ORIGIN),
        },
      )}
    </Button>
  )
}

export function LocalWebCommenting({
  docId,
  replyCommentVersion,
  rootReplyCommentVersion,
  replyCommentId,
  quotingBlockId,
  onDiscardDraft,
  onSuccess,
  commentingOriginUrl,
  autoFocus,
}: WebCommentingProps) {
  const openUrl = useOpenUrlWeb()
  const queryClient = useQueryClient()
  const tx = useTxString()

  // Use draft persistence
  const {
    draft,
    isLoading: isDraftLoading,
    saveDraft,
    removeDraft,
  } = useCommentDraftPersistence(docId.id, replyCommentId, quotingBlockId)

  const postComment = useMutation({
    mutationFn: async (commentPayload: {
      comment: Uint8Array
      blobs: {cid: string; data: Uint8Array}[]
    }) => {
      const result = await postCBOR(
        '/hm/api/comment',
        cborEncode(commentPayload),
      )
      return result as CommentResponsePayload
    },
    onSuccess: (result, commentPayload) => {
      onSuccess?.({
        response: result,
        commentPayload: commentPayload,
        id: result.commentId,
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_ACTIVITY], // all docs
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_DISCUSSION], // all docs
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_COMMENTS], // all docs
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_INTERACTION_SUMMARY], // all docs
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOC_CITATIONS], // all docs
      })

      queryClient.invalidateQueries({
        queryKey: [queryKeys.BLOCK_DISCUSSIONS], // all docs
      })
    },
  })

  const docVersion = docId.version

  if (!docVersion) return null

  const {
    content: createAccountContent,
    userKeyPair,
    createAccount,
  } = useCreateAccount()

  const myAccount = useAccount(userKeyPair?.id || undefined)

  console.log(`🔍 LocalWebCommenting ~ myAccount:`, {
    data: myAccount.data?.metadata,
    isLoading: myAccount.isLoading,
    dataUpdatedAt: myAccount.dataUpdatedAt,
    queryKey: ['ACCOUNT', userKeyPair?.id],
  })

  const {
    content: emailNotificationsPromptContent,
    open: openEmailNotificationsPrompt,
  } = useAppDialog(EmailNotificationsPrompt)

  function promptEmailNotifications() {
    if (!ENABLE_EMAIL_NOTIFICATIONS) return
    hasPromptedEmailNotifications().then((hasPrompted) => {
      if (hasPrompted) {
        return
      }
      openEmailNotificationsPrompt({})
    })
  }

  const editProfileDialog = useAppDialog(EditProfileDialog)

  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (
    getContent: (
      prepareAttachments: (binaries: Uint8Array[]) => Promise<{
        blobs: {cid: string; data: Uint8Array}[]
        resultCIDs: string[]
      }>,
    ) => Promise<{
      blockNodes: HMBlockNode[]
      blobs: {cid: string; data: Uint8Array}[]
    }>,
    reset: () => void,
  ) => {
    if (isSubmitting) return // Prevent double submission

    if (!userKeyPair || !myAccount) {
      createAccount()
      return
    }

    try {
      setIsSubmitting(true)
      const commentPayload = await prepareComment(
        getContent,
        {
          docId,
          docVersion,
          keyPair: userKeyPair,
          replyCommentVersion,
          rootReplyCommentVersion,
          quotingBlockId,
        },
        commentingOriginUrl,
      )
      await postComment.mutateAsync(commentPayload)
      reset()
      removeDraft() // Remove draft after successful submission
      onDiscardDraft?.()
      await promptEmailNotifications()
    } finally {
      setIsSubmitting(false)
    }
  }

  const onAvatarPress = async () => {
    if (!userKeyPair) {
      createAccount()
      return
    }
    editProfileDialog.open({accountUid: userKeyPair.id})
    return
  }

  // Don't render until draft is loaded
  if (isDraftLoading) {
    return <div className="w-full">Loading...</div>
  }

  return (
    <div className="w-full">
      <DocContentProvider
        entityComponents={{
          Document: EmbedDocument,
          Comment: () => null,
          // @ts-expect-error
          Inline: EmbedInline,
          Query: QueryBlockWeb,
        }}
        importWebFile={importWebFile}
        openUrl={openUrl}
        handleFileAttachment={handleFileAttachment}
        debug={false}
        comment
        entityId={docId}
        onBlockCopy={null}
        layoutUnit={18}
        textUnit={12}
        collapsedBlocks={new Set()}
        setCollapsedBlocks={() => {}}
      >
        <CommentEditor
          autoFocus={autoFocus}
          handleSubmit={handleSubmit}
          initialBlocks={draft || undefined}
          onContentChange={saveDraft}
          onAvatarPress={onAvatarPress}
          onDiscardDraft={() => {
            removeDraft()
            onDiscardDraft?.()
          }}
          submitButton={({getContent, reset}) => {
            return (
              <Tooltip
                content={tx(
                  'publish_comment_as',
                  ({name}: {name: string | undefined}) =>
                    name ? `Publish Comment as ${name}` : 'Publish Comment',
                  {name: myAccount.data?.metadata?.name},
                )}
              >
                <button
                  disabled={isSubmitting}
                  className={cn(
                    buttonVariants({size: 'icon', variant: 'ghost'}),
                    'plausible-event-name=start-create-account flex items-center justify-center rounded-sm p-2 text-neutral-800 hover:bg-neutral-200 dark:text-neutral-200 dark:hover:bg-neutral-700',
                    isSubmitting && 'cursor-not-allowed opacity-50',
                  )}
                  onClick={() => handleSubmit(getContent, reset)}
                >
                  <SendHorizontal className="size-4" />
                </button>
              </Tooltip>
            )
          }}
          account={myAccount.data}
          perspectiveAccountUid={myAccount.data?.id.uid} // TODO: figure out if this is the correct value
        />
      </DocContentProvider>
      {createAccountContent}
      {editProfileDialog.content}
      {emailNotificationsPromptContent}
    </div>
  )
}

async function prepareAttachment(
  binary: Uint8Array,
  blockstore: MemoryBlockstore,
): Promise<CID> {
  // const fileBlock = await encodeBlock(fileBinary, rawCodec)
  const results = unixFSImporter([{content: binary}], blockstore)

  const result = await results.next()
  if (!result.value) {
    throw new Error('Failed to prepare attachment')
  }
  return result.value.cid
}

async function prepareAttachments(binaries: Uint8Array[]) {
  const blockstore = new MemoryBlockstore()
  const resultCIDs: string[] = []
  for (const binary of binaries) {
    const cid = await prepareAttachment(binary, blockstore)
    resultCIDs.push(cid.toString())
  }
  const allAttachmentBlobs = blockstore.getAll()
  const blobs: {cid: string; data: Uint8Array}[] = []
  for await (const blob of allAttachmentBlobs) {
    blobs.push({
      cid: blob.cid.toString(),
      data: blob.block,
    })
  }
  return {blobs, resultCIDs}
}

function generateBlockId(length: number = 8): string {
  const characters =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return result
}

async function prepareComment(
  getContent: (
    prepareAttachments: (binaries: Uint8Array[]) => Promise<{
      blobs: {cid: string; data: Uint8Array}[]
      resultCIDs: string[]
    }>,
  ) => Promise<{
    blockNodes: HMBlockNode[]
    blobs: {cid: string; data: Uint8Array}[]
  }>,
  commentMeta: {
    docId: UnpackedHypermediaId
    docVersion: string
    keyPair: LocalWebIdentity
    replyCommentVersion: string | null | undefined
    rootReplyCommentVersion: string | null | undefined
    quotingBlockId?: string
  },
  commentingOriginUrl: string | undefined,
): Promise<CommentPayload> {
  const {blockNodes, blobs} = await getContent(prepareAttachments)

  // If quotingBlockId is provided, wrap content in an embed block like desktop version
  const publishContent = commentMeta.quotingBlockId
    ? [
        {
          block: {
            id: generateBlockId(8),
            type: 'Embed',
            text: '',
            attributes: {
              childrenType: 'Group',
              view: 'Content',
            },
            annotations: [],
            link: packHmId({
              ...commentMeta.docId,
              blockRef: commentMeta.quotingBlockId,
            }),
          },
          children: blockNodes,
        } as HMBlockNode,
      ]
    : blockNodes

  const signedComment = await createComment({
    content: publishContent,
    ...commentMeta,
  })
  const result: CommentPayload = {
    comment: cborEncode(signedComment),
    blobs,
  }
  if (commentingOriginUrl) result.commentingOriginUrl = commentingOriginUrl
  return result
}

async function handleFileAttachment(file: Blob) {
  const fileBuffer = await file.arrayBuffer()
  const fileBinary = new Uint8Array(fileBuffer)
  return {
    displaySrc: URL.createObjectURL(file),
    fileBinary,
  }
}

async function importWebFile(url: string) {
  try {
    const res = await fetch(url, {method: 'GET', mode: 'cors'})

    if (!res.ok) {
      throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`)
    }

    const contentType =
      res.headers.get('content-type') || 'application/octet-stream'
    const blob = await res.blob()

    const {displaySrc, fileBinary} = await handleFileAttachment(blob)

    return {
      displaySrc,
      fileBinary,
      type: contentType,
      size: blob.size,
    }
  } catch (err: any) {
    throw new Error(err?.message || 'Could not download file.')
  }
}

export function useOpenUrlWeb() {
  const {originHomeId} = useUniversalAppContext()

  return (url?: string, newWindow?: boolean) => {
    if (!url) return

    const unpacked = unpackHmId(url)
    const newUrl = unpacked ? idToUrl(unpacked, {originHomeId}) : url

    if (!newUrl) {
      console.error('URL is empty', newUrl)
      return
    }

    if (newWindow) {
      window.open(newUrl, '_blank')
    } else {
      window.location.href = newUrl
    }
  }
}

// @ts-expect-error
function EmailNotificationsPrompt({onClose}: {onClose: () => void}) {
  useEffect(() => {
    setHasPromptedEmailNotifications(true)
  }, [])
  const [mode, setMode] = useState<'prompt' | 'form' | 'success'>('prompt')
  const {data: emailNotifications, isLoading: isEmailNotificationsLoading} =
    useEmailNotifications()
  if (isEmailNotificationsLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    ) // todo: make it look better
  if (mode === 'prompt') {
    return (
      <div className="flex flex-col gap-3">
        <DialogTitle>Email Notifications</DialogTitle>
        <SizableText>
          Do you want to receive an email when someone mentions your or replies
          to your comments?
        </SizableText>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => onClose()}>
            No Thanks
          </Button>
          <Button variant="default" onClick={() => setMode('form')}>
            Yes, Notify Me
          </Button>
        </div>
      </div>
    )
  }
  if (mode === 'form') {
    return (
      <div className="flex flex-col gap-3">
        <DialogTitle>Email Notifications</DialogTitle>
        <EmailNotificationsForm
          onClose={onClose}
          onComplete={() => {
            setMode('success')
          }}
          defaultValues={emailNotifications?.account}
        />
      </div>
    )
  }
  if (mode === 'success') {
    return (
      <div className="flex flex-col gap-3">
        <DialogTitle>Email Notifications</DialogTitle>
        <SizableText>
          Email notifications have been set for{' '}
          <SizableText weight="bold">
            {emailNotifications?.account?.email}
          </SizableText>
          .
        </SizableText>
        <SizableText>
          You can edit your notification preferences by pressing "Notification
          Settings" in the footer.
        </SizableText>
        <Button variant="default" onClick={() => onClose()}>
          Done
        </Button>
      </div>
    )
  }
}

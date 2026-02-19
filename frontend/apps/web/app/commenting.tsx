import {postCBOR} from '@/api'
import {useCreateAccount} from '@/auth'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {CommentEditor} from '@shm/editor/comment-editor'
import {
  HMBlockNode,
  idToUrl,
  queryKeys,
  UnpackedHypermediaId,
  unpackHmId,
  useUniversalAppContext,
  useUniversalClient,
} from '@shm/shared'
import {prepareComment} from '@shm/shared/comment-creation'
import {useCommentsService} from '@shm/shared/comments-service-provider'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {useAccount} from '@shm/shared/models/entity'
import {useTxString} from '@shm/shared/translation'
import {Button, buttonVariants} from '@shm/ui/button'
import {DialogTitle} from '@shm/ui/components/dialog'
import {EmailNotificationsSuccess} from '@shm/ui/email-notifications'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {MemoryBlockstore} from 'blockstore-core/memory'
import {importer as unixFSImporter} from 'ipfs-unixfs-importer'
import {SendHorizontal} from 'lucide-react'
import type {CID} from 'multiformats'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {ClientOnly} from './client-lazy'
import {useCommentDraftPersistence} from './comment-draft-utils'
import {EmailNotificationsForm} from './email-notifications'
import {hasPromptedEmailNotifications, setHasPromptedEmailNotifications} from './local-db'
import type {CommentPayload, CommentResponsePayload} from './routes/hm.api.comment'

export type WebCommentingProps = {
  docId: UnpackedHypermediaId
  /** Comment ID from CommentEditorProps - used to resolve reply parent */
  commentId?: string | null
  isReplying?: boolean
  replyCommentVersion?: string | null
  replyCommentId?: string | null
  rootReplyCommentVersion?: string | null
  quotingBlockId?: string
  onSuccess?: (successData: {id: string; response: CommentResponsePayload; commentPayload: CommentPayload}) => void
  commentingOriginUrl?: string
  autoFocus?: boolean
}

export default function WebCommenting({
  docId,
  commentId,
  isReplying,
  replyCommentVersion: replyCommentVersionProp,
  rootReplyCommentVersion: rootReplyCommentVersionProp,
  replyCommentId: replyCommentIdProp,
  quotingBlockId,
  onSuccess,
  commentingOriginUrl,
  autoFocus,
}: WebCommentingProps) {
  const openUrl = useOpenUrlWeb()
  const queryClient = useQueryClient()
  const tx = useTxString()
  const {getSigner} = useUniversalClient()

  // Resolve reply parent from commentId when explicit version props aren't provided
  const commentsService = useCommentsService({targetId: docId})
  const resolvedReply = useMemo(() => {
    const id = replyCommentIdProp || commentId
    if (!id) return null
    const comment = commentsService.data?.comments?.find((c) => c.id === id)
    if (!comment) return null
    return {
      replyCommentId: comment.id,
      replyCommentVersion: comment.version,
      rootReplyCommentVersion: comment.threadRootVersion || comment.version,
    }
  }, [replyCommentIdProp, commentId, commentsService.data?.comments])

  const replyCommentId = replyCommentIdProp || resolvedReply?.replyCommentId
  const replyCommentVersion = replyCommentVersionProp || resolvedReply?.replyCommentVersion
  const rootReplyCommentVersion = rootReplyCommentVersionProp || resolvedReply?.rootReplyCommentVersion
  const isReplyEditor = isReplying || !!replyCommentId || !!commentId

  // Use draft persistence
  const {
    draft,
    isLoading: isDraftLoading,
    saveDraft,
    removeDraft,
  } = useCommentDraftPersistence(docId.id, replyCommentId, quotingBlockId)

  // Generate a stable draftId for IndexedDB media storage
  const draftId = useMemo(() => {
    const parts = ['comment-draft', docId.id]
    if (replyCommentId) parts.push(`reply-${replyCommentId}`)
    if (quotingBlockId) parts.push(`quote-${quotingBlockId}`)
    return parts.join('-')
  }, [docId.id, replyCommentId, quotingBlockId])

  // Cleanup old draft media on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('./draft-media-db')
        .then(({cleanupOldDraftMedia}) => cleanupOldDraftMedia())
        .catch((err) => console.error('Failed to cleanup old draft media:', err))
    }
  }, [])

  const postComment = useMutation({
    mutationFn: async (commentPayload: {comment: Uint8Array; blobs: {cid: string; data: Uint8Array}[]}) => {
      const result = await postCBOR('/hm/api/comment', cborEncode(commentPayload))
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
      queryClient.invalidateQueries({
        queryKey: [queryKeys.ACTIVITY_FEED], // all Feed
      })
    },
  })

  const docVersion = docId.version

  const pendingSubmitRef = useRef<(() => Promise<void>) | null>(null)

  const {
    content: createAccountContent,
    userKeyPair,
    createAccount,
  } = useCreateAccount({
    onClose: () => {
      // After account creation, retry pending submission
      if (pendingSubmitRef.current) {
        pendingSubmitRef.current()
        pendingSubmitRef.current = null
      }
    },
  })

  const myAccount = useAccount(userKeyPair?.id || undefined)

  const {content: emailNotificationsPromptContent, open: openEmailNotificationsPrompt} =
    useAppDialog(EmailNotificationsPrompt)

  function promptEmailNotifications() {
    console.log('🔔 promptEmailNotifications called', {
      NOTIFY_SERVICE_HOST,
    })
    if (!NOTIFY_SERVICE_HOST) {
      console.log('❌ Email notifications disabled')
      return
    }
    hasPromptedEmailNotifications().then((hasPrompted) => {
      console.log('🔔 hasPrompted check:', hasPrompted)
      if (hasPrompted) {
        console.log('❌ User already prompted, skipping')
        return
      }
      console.log('✅ Opening email notifications prompt')
      openEmailNotificationsPrompt({})
    })
  }

  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = useCallback(
    async (
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
      if (isSubmitting || !docVersion) return // Prevent double submission

      if (!userKeyPair) {
        // Store the pending submission to retry after account creation
        pendingSubmitRef.current = async () => {
          await handleSubmit(getContent, reset)
        }
        createAccount()
        return
      }

      try {
        setIsSubmitting(true)
        if (!getSigner) throw new Error('getSigner not available')
        const signer = getSigner(userKeyPair.id)
        const commentPayload = await prepareComment(
          getContent,
          {
            docId,
            docVersion,
            signer,
            replyCommentVersion,
            rootReplyCommentVersion,
            quotingBlockId,
            prepareAttachments,
          },
          commentingOriginUrl,
        )
        await postComment.mutateAsync(commentPayload)
        console.log('✅ Comment posted successfully, calling promptEmailNotifications')
        reset()
        removeDraft() // Remove draft after successful submission
        // Clean up associated media from IndexedDB after successful publish
        if (typeof window !== 'undefined') {
          import('./draft-media-db')
            .then(({deleteAllDraftMediaForDraft, revokeHMBlockObjectURLs}) => {
              // Revoke object URLs before cleanup to free memory
              if (draft) revokeHMBlockObjectURLs(draft)
              return deleteAllDraftMediaForDraft(draftId)
            })
            .catch((err) => console.error('Failed to cleanup draft media:', err))
        }
        promptEmailNotifications()
      } finally {
        setIsSubmitting(false)
      }
    },
    [
      isSubmitting,
      userKeyPair,
      docId,
      docVersion,
      replyCommentVersion,
      rootReplyCommentVersion,
      quotingBlockId,
      commentingOriginUrl,
      createAccount,
      postComment,
      removeDraft,
      promptEmailNotifications,
    ],
  )
  const onAvatarPress = useMemo(() => {
    if (!userKeyPair) {
      return createAccount
    }
    return undefined
  }, [userKeyPair])

  const publishButtonEventClass = userKeyPair
    ? 'plausible-event-name=Publish+Comment'
    : 'plausible-event-name=start-create-account'

  // Don't render until draft is loaded or doc version is missing
  if (isDraftLoading || !docVersion) {
    return !docVersion ? null : <div className="w-full">Loading...</div>
  }

  return (
    <div className="w-full">
      <ClientOnly>
        <CommentEditor
          autoFocus={autoFocus}
          isReplying={isReplyEditor}
          handleSubmit={handleSubmit}
          initialBlocks={draft || undefined}
          onContentChange={saveDraft}
          onAvatarPress={onAvatarPress}
          importWebFile={importWebFile}
          handleFileAttachment={(file) => handleFileAttachment(file, draftId)}
          getDraftMediaBlob={async (draftId, mediaId) => {
            if (typeof window === 'undefined') return null
            try {
              const {getDraftMedia} = await import('./draft-media-db')
              const mediaData = await getDraftMedia(draftId, mediaId)
              if (!mediaData) {
                console.warn(`Media not found in IndexedDB: ${draftId}/${mediaId}`)
              }
              return mediaData?.blob || null
            } catch (error) {
              console.error('Failed to get draft media blob:', error)
              return null
            }
          }}
          submitButton={({getContent, reset}) => {
            return (
              <Tooltip
                content={tx(
                  'publish_comment_as',
                  ({name}: {name: string | undefined}) => (name ? `Publish Comment as ${name}` : 'Publish Comment'),
                  {name: myAccount.data?.metadata?.name},
                )}
              >
                <button
                  disabled={isSubmitting}
                  className={cn(
                    buttonVariants({size: 'icon', variant: 'ghost'}),
                    publishButtonEventClass,
                    'flex items-center justify-center rounded-sm p-2 text-neutral-800 hover:bg-neutral-200 dark:text-neutral-200 dark:hover:bg-neutral-700',
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
      </ClientOnly>
      {createAccountContent}
      {emailNotificationsPromptContent}
    </div>
  )
}

async function prepareAttachment(binary: Uint8Array, blockstore: MemoryBlockstore): Promise<CID> {
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

// UUID v4 with safe fallback for browsers without crypto.randomUUID (Safari < 15.4)
function generateUUID(): string {
  // Native UUID
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  // Fallback to crypto.getRandomValues
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)

    // RFC4122 v4 bits
    bytes[6] = (bytes[6]! & 0x0f) | 0x40
    bytes[8] = (bytes[8]! & 0x3f) | 0x80

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  // Last resort fallback. Not cryptographically strong, but avoids hard failure
  return `fallback-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

async function handleFileAttachment(
  file: Blob,
  draftId?: string,
): Promise<{
  displaySrc: string
  fileBinary?: Uint8Array
  mediaRef?: {
    draftId: string
    mediaId: string
    name: string
    mime: string
    size: number
  }
}> {
  const fileBuffer = await file.arrayBuffer()
  const fileBinary = new Uint8Array(fileBuffer)

  // If draftId provided and we're in browser, use IndexedDB
  if (draftId && typeof window !== 'undefined') {
    try {
      const {putDraftMedia} = await import('./draft-media-db')
      const mediaId = generateUUID()
      const name = (file as File).name || `media-${Date.now()}`
      const mime = file.type || 'application/octet-stream'
      const size = file.size

      await putDraftMedia(draftId, mediaId, file, {name, mime, size})

      return {
        displaySrc: URL.createObjectURL(file),
        mediaRef: {
          draftId,
          mediaId,
          name,
          mime,
          size,
        },
      }
    } catch (error) {
      // Enhanced error logging to diagnose iOS Safari issues
      const errorName = error instanceof Error ? error.name : 'Unknown'
      const errorMsg = error instanceof Error ? error.message : String(error)

      console.warn(`IndexedDB storage failed (${errorName}), falling back to binary:`, errorMsg)

      // Log specific Safari issues
      if (errorName === 'QuotaExceededError') {
        console.warn('Storage quota exceeded. Consider clearing old drafts.')
      } else if (errorName === 'SecurityError') {
        console.warn('Private browsing or cross-origin restriction detected.')
      }

      // Fall through to legacy behavior
    }
  }

  // Legacy behavior: store as binary in the block
  return {
    displaySrc: URL.createObjectURL(file),
    fileBinary,
  }
}

const importWebFile: (url: string) => Promise<{
  displaySrc: string
  fileBinary?: Uint8Array
  type: string
  size: number
}> = async (url: string) => {
  try {
    const res = await fetch(url, {method: 'GET', mode: 'cors'})

    if (!res.ok) {
      throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`)
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const blob = await res.blob()

    const result = await handleFileAttachment(blob)

    return {
      displaySrc: result.displaySrc,
      fileBinary: result.fileBinary,
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

function EmailNotificationsPrompt({onClose}: {onClose: () => void}) {
  useEffect(() => {
    console.log('📧 EmailNotificationsPrompt mounted')
    setHasPromptedEmailNotifications(true)
  }, [])
  const [mode, setMode] = useState<'prompt' | 'form' | 'success'>('prompt')
  const [subscribedEmail, setSubscribedEmail] = useState<string | null>(null)

  if (mode === 'prompt') {
    return (
      <>
        <DialogTitle>Email Notifications</DialogTitle>
        <SizableText>
          Do you want to receive an email when someone mentions your or replies to your comments?
        </SizableText>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={() => onClose()}>
            No Thanks
          </Button>
          <Button variant="default" onClick={() => setMode('form')}>
            Yes, Notify Me
          </Button>
        </div>
      </>
    )
  }
  if (mode === 'form') {
    return (
      <>
        <DialogTitle>Email Notifications</DialogTitle>
        <EmailNotificationsForm
          onClose={onClose}
          onComplete={(email: string) => {
            setMode('success')
            setSubscribedEmail(email)
          }}
        />
      </>
    )
  }
  if (mode === 'success') {
    return (
      <>
        <DialogTitle>Subscription Complete!</DialogTitle>
        <EmailNotificationsSuccess email={subscribedEmail} onClose={onClose} />
      </>
    )
  }
  return null
}

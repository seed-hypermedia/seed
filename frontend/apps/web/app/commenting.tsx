import {useCreateAccount} from '@/auth'
import {useNavigate} from '@remix-run/react'
import {createComment} from '@seed-hypermedia/client'
import {HMBlockNode, HMPublishBlobsOutput, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {CommentEditor} from '@shm/editor/comment-editor'
import {idToUrl, queryKeys, unpackHmId, useUniversalAppContext, useUniversalClient} from '@shm/shared'
import {useCommentsService} from '@shm/shared/comments-service-provider'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {useAccount} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {useTxString} from '@shm/shared/translation'
import {Button, buttonVariants} from '@shm/ui/button'
import {DialogTitle} from '@shm/ui/components/dialog'
import {EmailNotificationsSuccess} from '@shm/ui/email-notifications'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {useMutation} from '@tanstack/react-query'
import {filesToIpfsBlobs} from '@seed-hypermedia/client'
import {SendHorizontal} from 'lucide-react'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useCommentDraftPersistence} from './comment-draft-utils'
import {EmailNotificationsForm} from './email-notifications'
import {hasPromptedEmailNotifications, setHasPromptedEmailNotifications, setPendingIntent} from './local-db'
import {processPendingIntent} from './pending-intent'
import {isPerfEnabled, markCommentSubmitEnd, markCommentSubmitStart, markEditorLoadEnd} from './web-perf-marks'

type PublishCommentInput = Awaited<ReturnType<typeof createComment>>

export type WebCommentingProps = {
  docId: UnpackedHypermediaId
  /** Comment ID from CommentEditorProps - used to resolve reply parent */
  commentId?: string | null
  isReplying?: boolean
  replyCommentVersion?: string | null
  replyCommentId?: string | null
  rootReplyCommentVersion?: string | null
  quotingBlockId?: string
  onSuccess?: (successData: {id: string; response: HMPublishBlobsOutput; commentPayload: PublishCommentInput}) => void
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
  autoFocus,
}: WebCommentingProps) {
  const tx = useTxString()
  const {getSigner, publish} = useUniversalClient()
  const {originHomeId} = useUniversalAppContext()

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
    draftMediaRefs,
    isLoading: isDraftLoading,
    saveDraft,
    removeDraft,
  } = useCommentDraftPersistence(docId.id, replyCommentId, quotingBlockId)

  // Track latest editor content for non-destructive reads (e.g. persisting intent to IDB)
  const latestBlocksRef = useRef<HMBlockNode[] | null>(null)

  // Generation counter: bumped on clearDraft to force editor remount via key
  const [editorGeneration, setEditorGeneration] = useState(0)
  const clearDraft = useCallback(() => {
    removeDraft()
    setEditorGeneration((g) => g + 1)
  }, [removeDraft])

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
    mutationFn: async (commentPayload: PublishCommentInput) => {
      const response = await publish(commentPayload)
      const commentId = response.cids[0]
      if (!commentId) throw new Error('Failed to publish comment blob')
      return {response, commentId, commentPayload}
    },
    onSuccess: ({response, commentId, commentPayload}) => {
      if (isPerfEnabled()) markCommentSubmitEnd()
      onSuccess?.({
        response,
        commentPayload: commentPayload,
        id: commentId,
      })
      invalidateQueries([queryKeys.DOCUMENT_ACTIVITY])
      invalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
      invalidateQueries([queryKeys.DOCUMENT_COMMENTS])
      invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY])
      invalidateQueries([queryKeys.DOC_CITATIONS])
      invalidateQueries([queryKeys.BLOCK_DISCUSSIONS])
      invalidateQueries([queryKeys.ACTIVITY_FEED])
    },
  })

  const docVersion = docId.version
  const navigate = useNavigate()

  const {
    content: createAccountContent,
    userKeyPair,
    createAccount,
  } = useCreateAccount({
    onClose: () => {
      console.log('[commenting] onClose fired, calling processPendingIntent')
      processPendingIntent(originHomeId)
        .then((commentUrl) => {
          console.log('[commenting] processPendingIntent result:', commentUrl)
          if (commentUrl) {
            clearDraft()
            navigate(commentUrl)
          }
        })
        .catch((e) => {
          console.error('Failed to process pending intent after account creation:', e)
        })
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
      _reset: () => void,
    ) => {
      if (isSubmitting || !docVersion) return // Prevent double submission

      if (!userKeyPair) {
        // Persist intent to IDB so it can be processed after account creation
        // (works for both local and vault flows).
        // Use latestBlocksRef (updated on every editor change) instead of getContent(),
        // because getContent() destructively mutates editor blocks.
        try {
          const blocks = latestBlocksRef.current
          console.log('[commenting] saving intent, blocks:', blocks?.length ?? 'null')
          if (blocks) {
            await setPendingIntent({
              type: 'comment',
              docId,
              docVersion,
              content: blocks,
              replyCommentId: replyCommentId || undefined,
              replyCommentVersion: replyCommentVersion || undefined,
              rootReplyCommentVersion: rootReplyCommentVersion || undefined,
              quotingBlockId,
            })
            console.log('[commenting] intent saved to IDB')
          }
        } catch (e) {
          console.warn('Failed to persist pending comment intent:', e)
        }
        createAccount()
        return
      }

      try {
        setIsSubmitting(true)
        if (isPerfEnabled()) markCommentSubmitStart()
        if (!getSigner) throw new Error('getSigner not available')
        const signer = getSigner(userKeyPair.id)
        const commentPayload = await createComment(
          {
            getContent,
            docId,
            docVersion,
            replyCommentVersion,
            rootReplyCommentVersion,
            quotingBlockId,
            prepareAttachments,
          },
          signer,
        )
        await postComment.mutateAsync(commentPayload)
        console.log('✅ Comment posted successfully, calling promptEmailNotifications')
        clearDraft()
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
        // TODO: bring back email notifications prompt for new notification system - only prompt if the user does not already notifs set up on the notify service.
        // promptEmailNotifications()
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
      createAccount,
      postComment,
      clearDraft,
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

  // Re-inject mediaRefs into draft blocks so the editor can restore IndexedDB media
  const initialBlocks = useMemo(() => {
    if (!draft) return undefined
    if (!draftMediaRefs) return draft
    return draft.map((node) => {
      const block = node.block as any
      const blockId = block?.id
      if (!blockId || !draftMediaRefs[blockId]) return node
      return {
        ...node,
        block: {
          ...block,
          attributes: {
            ...block.attributes,
            mediaRef: JSON.parse(draftMediaRefs[blockId]),
          },
        },
      }
    }) as HMBlockNode[]
  }, [draft, draftMediaRefs])

  // Mark editor as loaded for performance measurement (only in perf test environment)
  // isPerfEnabled() is static at runtime, so this conditional hook is safe
  if (isPerfEnabled()) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      markEditorLoadEnd()
    }, [])
  }

  // Don't render until draft is loaded or doc version is missing
  if (isDraftLoading || !docVersion) {
    return !docVersion ? null : <div className="w-full">Loading...</div>
  }

  return (
    <div className="w-full">
      <CommentEditor
        key={`${draftId}-${editorGeneration}`}
        autoFocus={autoFocus}
        isReplying={isReplyEditor}
        handleSubmit={handleSubmit}
        initialBlocks={initialBlocks}
        onContentChange={(blocks, mediaRefs) => {
          latestBlocksRef.current = blocks
          saveDraft(blocks, mediaRefs)
        }}
        onAvatarPress={onAvatarPress}
        importWebFile={(url) => importWebFile(url, draftId)}
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
      {createAccountContent}
      {emailNotificationsPromptContent}
    </div>
  )
}

async function prepareAttachments(binaries: Uint8Array[]) {
  return filesToIpfsBlobs(binaries)
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

async function importWebFile(
  url: string,
  draftId?: string,
): Promise<{
  displaySrc: string
  fileBinary?: Uint8Array
  type: string
  size: number
}> {
  try {
    const res = await fetch(url, {method: 'GET', mode: 'cors'})

    if (!res.ok) {
      throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`)
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const blob = await res.blob()

    const result = await handleFileAttachment(blob, draftId)

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

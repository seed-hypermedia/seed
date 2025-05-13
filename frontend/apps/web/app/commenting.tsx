import {createComment, postCBOR} from '@/api'
import {LocalWebIdentity, useCreateAccount, useLocalKeyPair} from '@/auth'
import {injectModels} from '@/models'
import {encode as cborEncode} from '@ipld/dag-cbor'
import CommentEditor from '@shm/editor/comment-editor'
import {
  ENABLE_EMAIL_NOTIFICATIONS,
  HMBlockNode,
  hmId,
  hostnameStripProtocol,
  idToUrl,
  queryKeys,
  UnpackedHypermediaId,
  unpackHmId,
  useUniversalAppContext,
  WEB_IDENTITY_ORIGIN,
} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {DocContentProvider} from '@shm/ui/document-content'
import {HMIcon} from '@shm/ui/hm-icon'
import {toast} from '@shm/ui/toast'
import {DialogTitle, useAppDialog} from '@shm/ui/universal-dialog'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {MemoryBlockstore} from 'blockstore-core/memory'
import {importer as unixFSImporter} from 'ipfs-unixfs-importer'
import type {CID} from 'multiformats'
import {useEffect, useState} from 'react'
import {SizableText, Spinner, XStack, YStack} from 'tamagui'
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
  replyCommentId: string | null
  rootReplyCommentId: string | null
  onDiscardDraft?: () => void
  onSuccess?: (successData: {
    id: string
    response: CommentResponsePayload
    commentPayload: CommentPayload
  }) => void
  enableWebSigning: boolean
  commentingOriginUrl?: string
}

/**
 * This is the main commenting component. It is used to create a new comment.
 */
export default function WebCommenting(props: WebCommentingProps) {
  if (!props.enableWebSigning) {
    return (
      <Button
        onPress={() => {
          redirectToWebIdentityCommenting(
            props.docId,
            props.replyCommentId,
            props.rootReplyCommentId,
          )
          // const url = new URL(`${WEB_IDENTITY_ORIGIN}/hm/comment`)
          // url.searchParams.set(
          //   'target',
          //   `${props.docId.uid}${hmIdPathToEntityQueryPath(props.docId.path)}`,
          // )
          // url.searchParams.set('targetVersion', props.docId.version || '')
          // url.searchParams.set('reply', props.replyCommentId || '')
          // url.searchParams.set('rootReply', props.rootReplyCommentId || '')
          // url.searchParams.set('originUrl', window.location.toString())
          // window.open(url.toString(), '_blank')
        }}
      >
        {`Comment with ${hostnameStripProtocol(WEB_IDENTITY_ORIGIN)} Identity`}
      </Button>
    )
  }
  return <LocalWebCommenting {...props} />
}

export function LocalWebCommenting({
  docId,
  replyCommentId,
  rootReplyCommentId,
  onDiscardDraft,
  onSuccess,
  enableWebSigning,
  commentingOriginUrl,
}: WebCommentingProps) {
  const userKeyPair = useLocalKeyPair()
  const openUrl = useOpenUrlWeb()
  const queryClient = useQueryClient()
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
        queryKey: [queryKeys.DOCUMENT_ACTIVITY, docId.id],
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_DISCUSSION, docId.id],
      })
    },
  })

  const docVersion = docId.version

  if (!docVersion) return null

  const {
    content: createAccountContent,
    canCreateAccount,
    createAccount,
  } = useCreateAccount()
  const myAccountId = userKeyPair ? hmId('d', userKeyPair.id) : null
  const myAccount = useAccount(userKeyPair?.id || undefined)
  const myName = myAccount.data?.metadata?.name
  const authenticatedActionMessage = myName
    ? `Comment as ${myName}`
    : 'Submit Comment'
  const unauthenticatedActionMessage = enableWebSigning
    ? 'Create Account'
    : `Submit Comment`
  const commentActionMessage = userKeyPair
    ? authenticatedActionMessage
    : unauthenticatedActionMessage
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
    if (!enableWebSigning) {
      toast.error('Cannot sign comments on this domain.')
      return
    }

    if (canCreateAccount || !userKeyPair) {
      createAccount()
      return
    }

    const commentPayload = await prepareComment(
      getContent,
      {
        docId,
        docVersion,
        keyPair: userKeyPair,
        replyCommentId,
        rootReplyCommentId,
      },
      commentingOriginUrl,
    )
    await postComment.mutateAsync(commentPayload)
    reset()
    onDiscardDraft?.()
    await promptEmailNotifications()
  }

  return (
    <>
      <DocContentProvider
        entityComponents={{
          Document: EmbedDocument,
          Comment: () => null,
          Inline: EmbedInline,
          Query: QueryBlockWeb,
        }}
        importWebFile={importWebFile}
        openUrl={openUrl}
        handleFileAttachment={handleFileAttachment}
        debug={false}
        comment
      >
        <CommentEditor
          handleSubmit={handleSubmit}
          submitButton={({getContent, reset}) => {
            return (
              <Button
                size="$2"
                bg="$brand5"
                color="white"
                hoverStyle={{bg: '$brand4', borderColor: '$colorTransparent'}}
                focusStyle={{bg: '$brand3', borderColor: '$colorTransparent'}}
                className={`plausible-event-name=${
                  userKeyPair ? 'comment' : 'start-create-account'
                }`}
                icon={
                  myAccountId ? (
                    <HMIcon
                      id={myAccountId}
                      metadata={myAccount.data?.metadata}
                      size={18}
                    />
                  ) : undefined
                }
                onPress={() => handleSubmit(getContent, reset)}
              >
                {commentActionMessage}
              </Button>
            )
          }}
          onDiscardDraft={onDiscardDraft}
        />
      </DocContentProvider>
      {createAccountContent}
      {emailNotificationsPromptContent}
    </>
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
    replyCommentId: string | null | undefined
    rootReplyCommentId: string | null | undefined
  },
  commentingOriginUrl: string | undefined,
): Promise<CommentPayload> {
  const {blockNodes, blobs} = await getContent(prepareAttachments)
  const signedComment = await createComment({
    content: blockNodes,
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

function EmailNotificationsPrompt({onClose}: {onClose: () => void}) {
  useEffect(() => {
    setHasPromptedEmailNotifications(true)
  }, [])
  const [mode, setMode] = useState<'prompt' | 'form' | 'success'>('prompt')
  const {data: emailNotifications, isLoading: isEmailNotificationsLoading} =
    useEmailNotifications()
  if (isEmailNotificationsLoading) return <Spinner /> // todo: make it look better
  if (mode === 'prompt') {
    return (
      <YStack gap="$3">
        <DialogTitle>Email Notifications</DialogTitle>
        <SizableText>
          Do you want to receive an email when someone mentions your or replies
          to your comments?
        </SizableText>
        <XStack gap="$3" jc="flex-end">
          <Button onPress={() => onClose()}>No Thanks</Button>
          <Button onPress={() => setMode('form')} theme="blue">
            Yes, Notify Me
          </Button>
        </XStack>
      </YStack>
    )
  }
  if (mode === 'form') {
    return (
      <YStack gap="$3">
        <DialogTitle>Email Notifications</DialogTitle>
        <EmailNotificationsForm
          onClose={onClose}
          onComplete={() => {
            setMode('success')
          }}
          defaultValues={emailNotifications?.account}
        />
      </YStack>
    )
  }
  if (mode === 'success') {
    return (
      <YStack gap="$3">
        <DialogTitle>Email Notifications</DialogTitle>
        <SizableText>
          Email notifications have been set for{' '}
          <SizableText fontWeight="bold">
            {emailNotifications?.account?.email}
          </SizableText>
          .
        </SizableText>
        <SizableText>
          You can edit your notification preferences by pressing "Notification
          Settings" in the footer.
        </SizableText>
        <Button onPress={() => onClose()}>Done</Button>
      </YStack>
    )
  }
}

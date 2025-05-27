import {createComment, postCBOR} from '@/api'
import {LocalWebIdentity, useCreateAccount, useLocalKeyPair} from '@/auth'
import {injectModels} from '@/models'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {CommentEditor2} from '@shm/editor/comment-editor'
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
import {Button} from '@shm/ui/button'
import {DocContentProvider} from '@shm/ui/document-content'
import {toast} from '@shm/ui/toast'
import {DialogTitle, useAppDialog} from '@shm/ui/universal-dialog'
import {SendHorizontal} from '@tamagui/lucide-icons'
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
  replyCommentId?: string
  rootReplyCommentId?: string
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
  console.log('WebCommenting', props)
  if (!props.enableWebSigning) {
    return <ExternalWebCommenting {...props} />
  }
  return <LocalWebCommenting {...props} />
}

export function ExternalWebCommenting(props: {
  docId: UnpackedHypermediaId
  replyCommentId?: string
  rootReplyCommentId?: string
  quotingBlockId?: string
}) {
  return (
    <Button
      bg="$brand5"
      color="white"
      hoverStyle={{bg: '$brand4'}}
      focusStyle={{bg: '$brand4'}}
      onPress={() => {
        redirectToWebIdentityCommenting(props.docId, {
          replyCommentId: props.replyCommentId,
          rootReplyCommentId: props.rootReplyCommentId,
          quotingBlockId: props.quotingBlockId,
        })
      }}
    >
      {`Comment with ${hostnameStripProtocol(WEB_IDENTITY_ORIGIN)} Identity`}
    </Button>
  )
}

export function LocalWebCommenting({
  docId,
  replyCommentId,
  rootReplyCommentId,
  quotingBlockId,
  onDiscardDraft,
  onSuccess,
  enableWebSigning,
  commentingOriginUrl,
  autoFocus,
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
        queryKey: [queryKeys.DOCUMENT_ACTIVITY], // all docs
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_DISCUSSION], // all docs
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_INTERACTION_SUMMARY], // all docs
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOC_CITATIONS], // all docs
      })
    },
  })

  const docVersion = docId.version

  if (!docVersion) return null

  const {content: createAccountContent, createDefaultAccount} =
    useCreateAccount()

  const myAccount = useAccount(userKeyPair?.id || undefined)

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

    const commentPayload = await prepareComment(
      getContent,
      {
        docId,
        docVersion,
        keyPair: userKeyPair || (await createDefaultAccount()),
        replyCommentId,
        rootReplyCommentId,
        quotingBlockId,
      },
      commentingOriginUrl,
    )
    await postComment.mutateAsync(commentPayload)
    reset()
    onDiscardDraft?.()
    await promptEmailNotifications()
  }

  return (
    <XStack width="100%">
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
        entityId={docId}
        onBlockCopy={null}
        layoutUnit={18}
        textUnit={12}
        collapsedBlocks={new Set()}
        setCollapsedBlocks={() => {}}
      >
        <CommentEditor2
          autoFocus={autoFocus}
          handleSubmit={handleSubmit}
          submitButton={({getContent, reset}) => {
            return (
              <Button
                className={`plausible-event-name=start-create-account`}
                size="$3"
                chromeless
                onPress={() => handleSubmit(getContent, reset)}
                icon={SendHorizontal}
              />
            )
          }}
          account={myAccount.data}
          onDiscardDraft={onDiscardDraft}
        />
      </DocContentProvider>
      {createAccountContent}
      {emailNotificationsPromptContent}
    </XStack>
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
    replyCommentId: string | null | undefined
    rootReplyCommentId: string | null | undefined
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

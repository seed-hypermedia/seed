import {createComment, postCBOR} from '@/api'
import {useCreateAccount, useLocalKeyPair} from '@/auth'
import {injectModels} from '@/models'
import {encode as cborEncode} from '@ipld/dag-cbor'
import CommentEditor from '@shm/editor/comment-editor'
import {
  hmId,
  hostnameStripProtocol,
  idToUrl,
  queryKeys,
  SITE_IDENTITY_DEFAULT_ORIGIN,
  UnpackedHypermediaId,
  unpackHmId,
  useUniversalAppContext,
} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {DocContentProvider} from '@shm/ui/document-content'
import {HMIcon} from '@shm/ui/hm-icon'
import {toast} from '@shm/ui/toast'
import {DialogTitle, useAppDialog} from '@shm/ui/universal-dialog'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {useEffect, useState} from 'react'
import {SizableText, Spinner, XStack, YStack} from 'tamagui'
import {getValidAbility} from './auth-abilities'
import {
  createDelegatedComment,
  delegatedIdentityOriginStore,
  useDelegatedAbilities,
} from './auth-delegation'
import type {AuthFragmentOptions} from './auth-page'
import {EmailNotificationsForm} from './email-notifications'
import {useEmailNotifications} from './email-notifications-models'
import {
  hasPromptedEmailNotifications,
  setHasPromptedEmailNotifications,
} from './local-db'
import {EmbedDocument, EmbedInline, QueryBlockWeb} from './web-embeds'
injectModels()

export type WebCommentingProps = {
  docId: UnpackedHypermediaId
  replyCommentId: string | null
  rootReplyCommentId: string | null
  onDiscardDraft?: () => void
  onReplied?: () => void
  enableWebSigning: boolean
}

export default function WebCommenting({
  docId,
  replyCommentId,
  rootReplyCommentId,
  onDiscardDraft,
  onReplied,
  enableWebSigning,
}: WebCommentingProps) {
  const userKeyPair = useLocalKeyPair()
  const delegatedAbilities = useDelegatedAbilities()
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
    },
    onSuccess: () => {
      onReplied?.()
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_ACTIVITY, docId.id],
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_DISCUSSION, docId.id],
      })
    },
  })

  const docVersion = docId.version
  const {
    content: createAccountContent,
    canCreateAccount,
    createAccount,
  } = useCreateAccount()
  const myAccountId = userKeyPair ? hmId('d', userKeyPair.id) : null
  const myAccount = useEntity(myAccountId || undefined)
  const myName = myAccount.data?.document?.metadata?.name
  const commentActionMessage = myName
    ? `Comment as ${myName}`
    : 'Submit Comment'

  const validAbility = getValidAbility(
    delegatedAbilities,
    docId,
    'comment',
    window.location.origin,
  )

  const unauthenticatedActionMessage = enableWebSigning
    ? 'Create Account'
    : validAbility
    ? `Submit Comment`
    : `Sign in with ${hostnameStripProtocol(SITE_IDENTITY_DEFAULT_ORIGIN)}`

  const {
    content: emailNotificationsPromptContent,
    open: openEmailNotificationsPrompt,
  } = useAppDialog(EmailNotificationsPrompt)

  function promptEmailNotifications() {
    hasPromptedEmailNotifications().then((hasPrompted) => {
      if (hasPrompted) {
        return
      }
      openEmailNotificationsPrompt({})
    })
  }

  if (!docVersion) return null
  return (
    <>
      <CommentDocContentProvider handleFileAttachment={handleFileAttachment}>
        <CommentEditor
          submitButton={({getContent, reset}) => {
            return (
              <Button
                size="$2"
                theme="blue"
                className={`plausible-event-name=${
                  userKeyPair ? 'comment' : 'start-create-account'
                }`}
                icon={
                  myAccountId ? (
                    <HMIcon
                      id={myAccountId}
                      metadata={myAccount.data?.document?.metadata}
                      size={24}
                    />
                  ) : undefined
                }
                onPress={() => {
                  if (!enableWebSigning) {
                    // this origin cannot sign for itself. so we require a valid ability to comment
                    if (validAbility) {
                      createDelegatedComment({
                        ability: validAbility,
                        content: getContent(),
                        docId,
                        docVersion,
                        replyCommentId,
                        rootReplyCommentId,
                      })
                        .then((signedComment) => {
                          if (signedComment) {
                            postComment.mutateAsync(signedComment)
                          }
                          return signedComment
                        })
                        .then((comment) => {
                          if (comment) {
                            reset()
                            onDiscardDraft?.()
                          } else {
                            toast.error(
                              'Signing identity provider failed. Please try again.',
                            )
                          }
                        })
                        .catch((error) => {
                          toast.error(
                            `Failed to sign and publish your comment. Please try again. (${error.message})`,
                          )
                        })
                      return
                    } else {
                      // we don't have the ability to sign, and origin signing is disabled. so we need to request ability from another origin
                      // currently, we only support signing with the default origin
                      delegatedIdentityOriginStore.add(
                        SITE_IDENTITY_DEFAULT_ORIGIN,
                      )
                      const params = {
                        requestOrigin: window.location.origin,
                        targetUid: docId.uid,
                      } satisfies AuthFragmentOptions
                      const encodedParams = new URLSearchParams(
                        params,
                      ).toString()
                      window.open(
                        `${SITE_IDENTITY_DEFAULT_ORIGIN}/hm/auth#${encodedParams}`,
                        '_blank',
                      )
                      return
                    }
                  }
                  const content = getContent()
                  if (canCreateAccount || !userKeyPair) {
                    createAccount()
                    return
                  }
                  createComment({
                    content,
                    docId,
                    docVersion,
                    keyPair: userKeyPair,
                    replyCommentId,
                    rootReplyCommentId,
                  })
                    .then((signedComment) => {
                      postComment.mutateAsync(signedComment)
                    })
                    .then(() => {
                      reset()
                      onDiscardDraft?.()
                      promptEmailNotifications()
                    })
                }}
              >
                {userKeyPair
                  ? commentActionMessage
                  : unauthenticatedActionMessage}
              </Button>
            )
          }}
          onDiscardDraft={onDiscardDraft}
        />
      </CommentDocContentProvider>
      {createAccountContent}
      {emailNotificationsPromptContent}
    </>
  )
}

async function handleFileAttachment(file: File) {
  const fileBuffer = await file.arrayBuffer()
  const fileBinary = new Uint8Array(fileBuffer)
  return {
    displaySrc: URL.createObjectURL(file),
    fileBinary,
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

function CommentDocContentProvider({
  handleFileAttachment,
  children,
  comment, // originHomeId,
  // id,
} // supportQueries,
// siteHost,
// supportDocuments,
// routeParams,
: {
  children: React.ReactNode | JSX.Element
  // TODO: specify return type
  handleFileAttachment: (
    file: File,
  ) => Promise<{displaySrc: string; fileBinary: Uint8Array}>
  comment?: boolean
  // siteHost: string | undefined
  // id: UnpackedHypermediaId
  // originHomeId: UnpackedHypermediaId
  // supportDocuments?: HMEntityContent[]
  // supportQueries?: HMQueryResult[]
  // routeParams?: {
  //   documentId?: string
  //   version?: string
  //   blockRef?: string
  //   blockRange?: BlockRange
  // }
}) {
  const openUrl = useOpenUrlWeb()
  // const importWebFile = trpc.webImporting.importWebFile.useMutation()
  // const navigate = useNavigate()
  return (
    <DocContentProvider
      entityComponents={{
        Document: EmbedDocument,
        Comment: () => null,
        Inline: EmbedInline,
        Query: QueryBlockWeb,
      }}
      disableEmbedClick={true}
      // entityId={id}
      // supportDocuments={supportDocuments}
      // supportQueries={supportQueries}
      // onCopyBlock={(blockId, blockRange) => {
      //   const blockHref = getHref(
      //     originHomeId,
      //     {
      //       ...id,
      //       hostname: siteHost || null,
      //       blockRange: blockRange || null,
      //       blockRef: blockId,
      //     },
      //     id.version || undefined,
      //   )
      //   window.navigator.clipboard.writeText(blockHref)
      //   navigate(
      //     window.location.pathname +
      //       window.location.search +
      //       `#${blockId}${
      //         'start' in blockRange && 'end' in blockRange
      //           ? `[${blockRange.start}:${blockRange.end}]`
      //           : ''
      //       }`,
      //     {replace: true, preventScrollReset: true},
      //   )
      // }}
      // routeParams={routeParams}
      textUnit={18}
      layoutUnit={24}
      openUrl={openUrl}
      handleFileAttachment={handleFileAttachment}
      debug={false}
      comment
    >
      {children}
    </DocContentProvider>
  )
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

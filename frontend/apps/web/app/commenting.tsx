import {createComment, postCBOR, SignedComment} from '@/api'
import {useCreateAccount, useLocalKeyPair} from '@/auth'
import {injectModels} from '@/models'
import {encode as cborEncode} from '@ipld/dag-cbor'
import CommentEditor from '@shm/editor/comment-editor'
import {
  hmId,
  hostnameStripProtocol,
  queryKeys,
  SITE_IDENTITY_DEFAULT_ORIGIN,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
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
    mutationFn: async (signedComment: SignedComment) => {
      const result = await postCBOR(
        '/hm/api/comment',
        cborEncode(signedComment),
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
                    const encodedParams = new URLSearchParams(params).toString()
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
      {createAccountContent}
      {emailNotificationsPromptContent}
    </>
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

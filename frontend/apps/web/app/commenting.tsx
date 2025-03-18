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
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {getValidAbility} from './auth-abilities'
import {
  createDelegatedComment,
  delegatedIdentityOriginStore,
  useDelegatedAbilities,
} from './auth-delegation'
import type {AuthFragmentOptions} from './auth-page'

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

  if (!docVersion) return null
  return (
    <>
      <CommentEditor
        submitButton={({getContent, reset}) => {
          return (
            <Button
              size="$2"
              theme="blue"
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
    </>
  )
}

import {createComment, postCBOR, SignedComment} from '@/api'
import {useCreateAccount, useLocalKeyPair} from '@/auth'
import {Ability} from '@/local-db'
import {injectModels} from '@/models'
import {encode as cborEncode} from '@ipld/dag-cbor'
import CommentEditor from '@shm/editor/comment-editor'
import {
  HMBlockNode,
  hmId,
  hostnameStripProtocol,
  queryKeys,
  SITE_IDENTITY_DEFAULT_ORIGIN,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {
  createDelegatedComment,
  delegatedIdentityOriginStore,
  useDelegatedAbilities,
} from './identity-delegation'

injectModels()

type CreateCommentPayload = {
  content: HMBlockNode[]
  docId: UnpackedHypermediaId
  docVersion: string
  userKeyPair: CryptoKeyPair
  replyCommentId?: string
  rootReplyCommentId?: string
}

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

  const validAbility = getValidAbility(delegatedAbilities, docId, 'comment')

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
                  if (validAbility) {
                    console.log(
                      'WE HAVE THE ABILITY! NOW TIME TO REQUEST SIGNATURE?!',
                      validAbility,
                    )
                    createDelegatedComment({
                      ability: validAbility,
                      content: getContent(),
                      docId,
                      docVersion,
                    })
                      .then((signedComment) =>
                        postComment.mutateAsync(signedComment),
                      )
                      .then(() => {
                        reset()
                        onDiscardDraft?.()
                      })
                    return
                  }
                  // currently, we only support signing with the default origin
                  delegatedIdentityOriginStore.add(SITE_IDENTITY_DEFAULT_ORIGIN)
                  console.log('MY ORIGIN', window.location.origin)
                  const params = {
                    requestOrigin: window.location.origin,
                  }
                  const encodedParams = new URLSearchParams(params).toString()
                  window.open(
                    `${SITE_IDENTITY_DEFAULT_ORIGIN}/hm/auth#${encodedParams}`,
                    '_blank',
                  )
                  console.log('DELEGATING!! WEB IDENTITY!!')
                  return
                }
                const content = getContent()
                if (canCreateAccount || !userKeyPair) {
                  createAccount()
                  return
                }
                const createCommentPayload: Parameters<
                  typeof createComment
                >[0] = {
                  content,
                  docId,
                  docVersion,
                  keyPair: userKeyPair,
                }
                if (replyCommentId && rootReplyCommentId) {
                  createCommentPayload.replyCommentId = replyCommentId
                  createCommentPayload.rootReplyCommentId = rootReplyCommentId
                }
                createComment(createCommentPayload)
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

function getValidAbility(
  abilities: Ability[],
  docId: UnpackedHypermediaId,
  abilityType: 'comment',
) {
  return abilities.find((ability) => {
    return true // todo
  })
}

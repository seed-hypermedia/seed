import {
  createComment,
  encodeBlock,
  postCBOR,
  rawCodec,
  SignedComment,
} from '@/api'
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
import {DocContentProvider} from '@shm/ui/document-content'
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
                    console.log(
                      'WE HAVE THE ABILITY! NOW TIME TO REQUEST SIGNATURE?!',
                      validAbility,
                    )
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

// TODO web editor: this is code of how I understood it should work. I don't know if that's valid.
async function getFileCID(file: File) {
  const fileBuffer = await file.arrayBuffer()
  const fileBinary = new Uint8Array(fileBuffer)
  const fileBlock = await encodeBlock(fileBinary, rawCodec)
  return {
    cid: fileBlock.cid.toString(), // CID for the file
    previewUrl: URL.createObjectURL(file), // Temporary URL for preview
  }
}

function CommentDocContentProvider({
  getFileCID,
  children,
  comment, // originHomeId,
  // supportQueries,
} // id,
// siteHost,
// supportDocuments,
// routeParams,
: {
  children: React.ReactNode | JSX.Element
  // TODO: specify return type
  getFileCID: (file: File) => Promise<{cid: string; previewUrl: string}>
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
      debug={false}
      comment
    >
      {children}
    </DocContentProvider>
  )
}

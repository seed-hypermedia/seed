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
import {DocContentProvider} from '@shm/ui/document-content'
import {Field} from '@shm/ui/form-fields'
import {FormInput} from '@shm/ui/form-input'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {HMIcon} from '@shm/ui/hm-icon'
import {toast} from '@shm/ui/toast'
import {DialogTitle, useAppDialog} from '@shm/ui/universal-dialog'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {
  Control,
  FieldValues,
  Path,
  SubmitHandler,
  useController,
  useForm,
} from 'react-hook-form'
import {Form, SizableText, Stack, XStack, YStack} from 'tamagui'
import {z} from 'zod'
import {getValidAbility} from './auth-abilities'
import {useDelegatedAbilities} from './auth-delegation'
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
      <CommentDocContentProvider>
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
      {createAccountDialog.content}
    </>
  )
}
const siteMetaSchema = z.object({
  name: z.string(),
  icon: z.string().or(z.instanceof(Blob)).nullable(),
})
type SiteMetaFields = z.infer<typeof siteMetaSchema>
function CreateAccountDialog({
  input,
  onClose,
}: {
  input: {}
  onClose: () => void
}) {
  const {origin} = useUniversalAppContext()
  const onSubmit: SubmitHandler<SiteMetaFields> = (data) => {
    createAccount({name: data.name, icon: data.icon}).then(() => onClose())
  }
  const siteName = hostnameStripProtocol(origin)
  return (
    <>
      <DialogTitle>Create Account on {siteName}</DialogTitle>
      <DialogDescription>
        Your account key will be securely stored in this browser. The identity
        will be accessible only on this domain, but you can link it to other
        domains and devices.
      </DialogDescription>
      <EditProfileForm
        onSubmit={onSubmit}
        submitLabel={`Create ${siteName} Account`}
      />
    </>
  )
}

function CommentDocContentProvider({
  children,
  // id,
  originHomeId,
  siteHost, // supportDocuments,
  // routeParams,
} // supportQueries,
: {
  siteHost: string | undefined
  // id: UnpackedHypermediaId
  originHomeId: UnpackedHypermediaId
  children: React.ReactNode | JSX.Element
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
    >
      {children}
    </DocContentProvider>
  )
}

function EditProfileForm({
  onSubmit,
  defaultValues,
  submitLabel,
}: {
  onSubmit: (data: SiteMetaFields) => void
  defaultValues?: SiteMetaFields
  submitLabel?: string
}) {
  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<SiteMetaFields>({
    resolver: zodResolver(siteMetaSchema),
    defaultValues: defaultValues || {
      name: '',
      icon: null,
    },
  })
  useEffect(() => {
    setTimeout(() => {
      setFocus('name')
    }, 300) // wait for animation
  }, [setFocus])
  return (
    <Form onSubmit={handleSubmit(onSubmit)}>
      <YStack gap="$2">
        <Field id="name" label="Account Name">
          <FormInput control={control} name="name" placeholder="Account Name" />
        </Field>
        <ImageField control={control} name="icon" label="Site Icon" />
        <XStack jc="center">
          <Form.Trigger asChild>
            <Button>{submitLabel || 'Save Account'}</Button>
          </Form.Trigger>
        </XStack>
      </YStack>
    </Form>
  )
}

async function optimizeImage(file: File): Promise<Blob> {
  const response = await fetch('/hm/api/site-image', {
    method: 'POST',
    body: await file.arrayBuffer(),
  })
  const signature = response.headers.get('signature')
  if (!signature) {
    throw new Error('No signature found')
  }
  if (signature !== 'SIG-TODO') {
    // todo: real signature checking.. not here but at re-upload time
    throw new Error('Invalid signature')
  }
  const contentType = response.headers.get('content-type') || 'image/png'
  const responseBlob = await response.blob()
  return new Blob([responseBlob], {type: contentType})
}

function ImageField<Fields extends FieldValues>({
  control,
  name,
  label,
}: {
  control: Control<Fields>
  name: Path<Fields>
  label: string
}) {
  const c = useController({control, name})
  const currentImgURL = c.field.value
    ? typeof c.field.value === 'string'
      ? getDaemonFileUrl(c.field.value)
      : URL.createObjectURL(c.field.value)
    : null
  return (
    <Stack
      position="relative"
      group="icon"
      overflow="hidden"
      height={128}
      width={128}
      borderRadius="$2"
      alignSelf="stretch"
      flex={1}
    >
      <input
        type="file"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          optimizeImage(file).then((blob) => {
            c.field.onChange(blob)
          })
        }}
        style={{
          opacity: 0,
          display: 'flex',
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
        }}
      />
      {!c.field.value && (
        <XStack
          bg="rgba(0,0,0,0.3)"
          position="absolute"
          gap="$2"
          zi="$zIndex.5"
          w="100%"
          $group-icon-hover={{opacity: 0.5}}
          h="100%"
          opacity={1}
          ai="center"
          jc="center"
          pointerEvents="none"
        >
          <SizableText textAlign="center" size="$1" color="white">
            Add {label}
          </SizableText>
        </XStack>
      )}
      {c.field.value && (
        <img
          src={currentImgURL}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            position: 'absolute',
            left: 0,
            top: 0,
          }}
        />
      )}
      {c.field.value && (
        <XStack
          bg="rgba(0,0,0,0.3)"
          position="absolute"
          gap="$2"
          zi="$zIndex.5"
          w="100%"
          $group-icon-hover={{opacity: 1}}
          h="100%"
          opacity={0}
          ai="center"
          jc="center"
          pointerEvents="none"
        >
          <SizableText textAlign="center" size="$1" color="white">
            Edit {label}
          </SizableText>
        </XStack>
      )}
    </Stack>
  )
}

function LogoutDialog({onClose}: {onClose: () => void}) {
  return (
    <>
      <DialogTitle>Really Logout?</DialogTitle>
      <DialogDescription>
        This account key is not saved anywhere else. By logging out, you will
        loose access to this identity forever.
      </DialogDescription>
      <Button
        onPress={() => {
          logout()
          onClose()
        }}
        theme="red"
      >
        Log out Forever
      </Button>
    </>
  )
}

function EditProfileDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {accountUid: string}
}) {
  const id = hmId('d', input.accountUid)
  const account = useEntity(id)
  const queryClient = useQueryClient()
  const document = account.data?.document
  const update = useMutation({
    mutationFn: (updates: SiteMetaFields) => {
      if (!keyPair) {
        throw new Error('No key pair found')
      }
      if (!document) {
        throw new Error('No document found')
      }
      return updateProfile({keyPair, document, updates})
    },
    onSuccess: () => {
      // invalidate the activity and discussion for all documents because they may be affected by the profile change
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_ACTIVITY],
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.DOCUMENT_DISCUSSION],
      })
      queryClient.invalidateQueries({
        queryKey: [queryKeys.ENTITY, id.id],
      })
    },
  })
  return (
    <>
      <DialogTitle>Edit Profile</DialogTitle>
      {document && (
        <EditProfileForm
          defaultValues={{
            name: account.data?.document?.metadata?.name || '?',
            icon: account.data?.document?.metadata?.icon || null,
          }}
          onSubmit={(newValues) => {
            update.mutateAsync(newValues).then(() => onClose())
          }}
        />
      )}
    </>
  )
}

export function AccountFooterActions() {
  const userKeyPair = useKeyPair()
  const logoutDialog = useAppDialog(LogoutDialog)
  const editProfileDialog = useAppDialog(EditProfileDialog)
  if (!userKeyPair) return null
  return (
    <XStack gap="$2">
      <Button
        size="$2"
        onPress={() => editProfileDialog.open({accountUid: userKeyPair.id})}
        backgroundColor="$color4"
        icon={Pencil}
      >
        Edit Profile
      </Button>
      <Button
        size="$2"
        onPress={() => logoutDialog.open({})}
        backgroundColor="$color4"
        icon={LogOut}
      >
        Logout
      </Button>
      {logoutDialog.content}
      {editProfileDialog.content}
    </XStack>
  )
}

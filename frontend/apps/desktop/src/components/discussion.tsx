import {
  useCommentDraft,
  useCommentEditor,
  useCreateComment,
} from '@/models/comments'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {trpc} from '@/trpc'
import {useNavRoute} from '@/utils/navigation'
import {UnpackedHypermediaId} from '@shm/shared'
import {
  Button,
  ReplyArrow,
  SizableText,
  UIAvatar,
  XStack,
  YStack,
} from '@shm/ui'
import {ChevronRight} from '@tamagui/lucide-icons'
import {useEffect, useState} from 'react'
import {HMEditorContainer, HyperMediaEditorView} from './editor'

export function Discussion({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <YStack p="$4" gap="$4">
      <CommentDraftContainer />
      <YStack>
        <XStack gap="$2" padding="$2">
          <UIAvatar label="Foo" size={20} />
          <YStack f={1} gap="$2">
            <XStack minHeight={20} ai="center" gap="$2">
              <SizableText size="$2" fontWeight="bold">
                Alice
              </SizableText>
              <SizableText color="$color8" size="$1">
                1 day ago
              </SizableText>
            </XStack>
            <XStack>
              <SizableText>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ornare
                rutrum amet, a nunc mi lacinia in iaculis. Pharetra ut integer
                nibh urna. Placerat ut adipiscing nulla lectus vulputate massa,
                scelerisque. Netus nisl nulla placerat dignissim ipsum arcu.
              </SizableText>
            </XStack>
            <XStack ai="center" gap="$2" marginLeft={-4} paddingVertical="$1">
              <Button
                chromeless
                color="$blue11"
                size="$1"
                theme="blue"
                icon={ChevronRight}
              >
                Replies (3)
              </Button>
              <Button
                chromeless
                color="$blue11"
                size="$1"
                theme="blue"
                icon={<ReplyArrow size={16} />}
              >
                Reply
              </Button>
            </XStack>
          </YStack>
        </XStack>
      </YStack>
    </YStack>
  )
}

function CommentDraftContainer() {
  const route = useNavRoute()
  if (route.key !== 'document')
    throw new Error(
      `Invalide Route: Can't load Comment draft on ${route.key} route. only on Documents`,
    )
  const createComment = useCreateComment()
  const [draftId, setDraftId] = useState('')
  const comments = trpc.comments.getCommentDrafts.useQuery({
    docId: route.id?.id || '',
  })
  useEffect(() => {
    if (comments.data?.length) {
      setDraftId(comments.data[0].commentId)
    }
  }, [comments.data])

  const deleteComment = trpc.comments.removeCommentDraft.useMutation()

  async function handleCreateComment() {
    if (route.key == 'document' && route.id) {
      let draftId = await createComment(route.id.id, '', '')

      console.log(`== ~ handleCreateComment ~ draftId:`, draftId)
      setDraftId(draftId)
    }
  }
  return (
    <>
      {comments.data?.length
        ? comments.data.map((c) => (
            <XStack>
              <SizableText>{c.commentId}</SizableText>
              <Button
                size="$1"
                onPress={() =>
                  deleteComment.mutateAsync({commentId: c.commentId})
                }
              >
                delete
              </Button>
            </XStack>
          ))
        : null}
      <XStack
        padding="$4"
        borderRadius="$4"
        borderWidth={2}
        borderColor="$color8"
        minHeight={80}
        onPress={handleCreateComment}
      >
        {draftId ? (
          <CommentDraft docId={route.id} draftId={draftId} />
        ) : (
          <SizableText>start commenting here...</SizableText>
        )}
      </XStack>
    </>
  )
}

function CommentDraft({
  docId,
  draftId,
}: {
  docId: UnpackedHypermediaId
  draftId: string
}) {
  const {
    editor,
    onSubmit,
    onDiscard,
    isSaved,
    targetCommentId,
    targetDocId,
    addReplyEmbed,
  } = useCommentEditor(draftId)
  const draft = useCommentDraft(draftId)

  return (
    <XStack f={1}>
      {/* <SizableText>comment draft here</SizableText> */}
      <YStack
        f={1}
        className="comment-draft"
        onPress={() => {
          editor._tiptapEditor.commands.focus()
        }}
      >
        <AppDocContentProvider disableEmbedClick>
          <HMEditorContainer>
            <HyperMediaEditorView editor={editor} editable />
          </HMEditorContainer>
        </AppDocContentProvider>
      </YStack>
    </XStack>
  )
}

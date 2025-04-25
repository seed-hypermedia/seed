import {useEntityCitations} from '@/models/citations'
import {
  useAllDocumentComments,
  useComment,
  useDocumentCommentGroups,
} from '@/models/comments'
import {useAccountsMetadata} from '@/models/entities'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {DocumentDiscussionsAccessory, hmId, pluralS} from '@shm/shared'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {Comment, CommentGroup} from '@shm/ui/discussion'
import {BlocksContent, getBlockNodeById} from '@shm/ui/document-content'
import {CitationsIcon} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {ChevronsDown, ChevronsUp} from '@tamagui/lucide-icons'
import {YStack} from '@tamagui/stacks'
import {memo, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {Button, Spinner, View, XStack} from 'tamagui'
import {LinearGradient} from 'tamagui/linear-gradient'
import {AccessoryContainer} from './accessory-sidebar'
import {CommentCitationEntry} from './citations-panel'
import {
  CommentDraft,
  CommentReplies,
  renderCommentContent,
  RepliesEditor,
  useCommentGroupAuthors,
} from './commenting'

export const DiscussionsPanel = memo(_DiscussionsPanel)

function _DiscussionsPanel({
  onClose,
  docId,
  onAccessory,
  accessory: {openComment, openBlockId, blockRange, autoFocus},
}: {
  onClose?: () => void
  docId: UnpackedHypermediaId
  accessory: DocumentDiscussionsAccessory
  onAccessory: (acc: DocumentDiscussionsAccessory) => void
}) {
  const route = useNavRoute()
  const navigate = useNavigate('replace')

  function focusComment(commentId: string) {
    if (route.key != 'document') return
    navigate({
      ...route,
      id: {...route.id},
      accessory: {
        ...route.accessory,
        key: 'discussions',
        openComment: commentId,
        openBlockId: undefined,
      },
    })
  }

  function onReplyClick(commentId: string) {
    focusComment(commentId)
  }

  function onReplyCountClick(commentId: string) {
    focusComment(commentId)
  }

  if (openComment) {
    return (
      <CommentReplyAccessory
        docId={docId}
        onBack={() => onAccessory({key: 'discussions'})}
        commentId={openComment}
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
      />
    )
  }
  if (openBlockId) {
    return (
      <CommentBlockAccessory
        docId={docId}
        blockId={openBlockId}
        autoFocus={autoFocus}
        onBack={() => onAccessory({key: 'discussions'})}
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
      />
    )
  }
  return (
    <AllComments
      docId={docId}
      onReplyClick={onReplyClick}
      onReplyCountClick={onReplyCountClick}
    />
  )
}

function AllComments({
  docId,
  onReplyClick,
  onReplyCountClick,
}: {
  docId: UnpackedHypermediaId
  onReplyClick: (commentId: string, rootReplyCommentId?: string | null) => void
  onReplyCountClick: (
    commentId: string,
    rootReplyCommentId?: string | null,
  ) => void
}) {
  const commentGroups = useDocumentCommentGroups(docId)
  const authors = useCommentGroupAuthors(commentGroups.data)

  return (
    <AccessoryContainer
      title={`${commentGroups.data?.length} ${pluralS(
        commentGroups.data?.length,
        'Comment',
      )}`}
      footer={
        <View paddingVertical="$2">
          <CommentDraft docId={docId} backgroundColor="$color1" />
        </View>
      }
    >
      <YStack>
        {commentGroups.data?.map((cg) => {
          return (
            <YStack key={cg.id} paddingHorizontal="$1.5">
              <CommentGroup
                rootReplyCommentId={null}
                key={cg.id}
                docId={docId}
                commentGroup={cg}
                isLastGroup={cg === commentGroups.data?.at(-1)}
                authors={authors}
                renderCommentContent={renderCommentContent}
                CommentReplies={CommentReplies}
                onReplyCountClick={onReplyCountClick}
                onReplyClick={onReplyClick}
              />
            </YStack>
          )
        })}
      </YStack>
    </AccessoryContainer>
  )
}

function CommentBlockAccessory({
  docId,
  blockId,
  autoFocus,
  onBack,
  onReplyClick,
  onReplyCountClick,
}: {
  docId: UnpackedHypermediaId
  blockId: string
  autoFocus?: boolean
  onBack: () => void
  onReplyClick: (commentId: string, rootReplyCommentId?: string | null) => void
  onReplyCountClick: (
    commentId: string,
    rootReplyCommentId?: string | null,
  ) => void
}) {
  const citations = useEntityCitations(docId)
  const citationsForBlock = citations.data?.filter((citation) => {
    return (
      citation.targetFragment?.blockId === blockId &&
      citation.source.type === 'c'
    )
  })
  const accountIds = new Set<string>()
  citationsForBlock?.forEach((citation) => {
    citation.source.author && accountIds.add(citation.source.author)
  })
  const accounts = useAccountsMetadata(Array.from(accountIds))
  return (
    <AccessoryContainer
      title="Discussions"
      footer={
        <View padding="$3">
          <CommentDraft
            docId={docId}
            backgroundColor="$color1"
            quotingBlockId={blockId}
          />
        </View>
      }
    >
      <AccessoryBackButton onPress={onBack} label="All Discussions" />
      <QuotedDocBlock docId={docId} blockId={blockId} />
      {citationsForBlock?.map((citation) => {
        return (
          <CommentCitationEntry
            citation={citation}
            key={citation.source.id.id}
            accounts={accounts}
            onReplyClick={onReplyClick}
            onReplyCountClick={onReplyCountClick}
          />
        )
      })}
    </AccessoryContainer>
  )
}

const BLOCK_DEFAULT_HEIGHT = 180

function QuotedDocBlock({
  docId,
  blockId,
}: {
  docId: UnpackedHypermediaId
  blockId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [canExpand, setCanExpand] = useState(false)
  const doc = useEntity(docId)
  const contentRef = useRef<HTMLDivElement>(null)
  const blockContent = useMemo(() => {
    if (!doc.data?.document?.content) return null
    return getBlockNodeById(doc.data?.document?.content, blockId)
  }, [doc.data?.document?.content, blockId])

  useLayoutEffect(() => {
    if (contentRef.current) {
      const height = contentRef.current?.getBoundingClientRect?.().height
      setCanExpand(height > BLOCK_DEFAULT_HEIGHT)
    }
  }, [contentRef.current])

  if (doc.isInitialLoading) {
    return <Spinner />
  }
  return (
    <YStack marginLeft={12} bg="$brand12">
      <XStack
        borderRadius="$2"
        padding="$2"
        gap="$1"
        maxHeight={
          canExpand ? (expanded ? 'none' : BLOCK_DEFAULT_HEIGHT) : 'none'
        }
        overflow="hidden"
        position="relative"
        animation="fast"
      >
        <XStack flexShrink={0} paddingVertical="$1.5">
          <CitationsIcon color="#000" size={23} />
        </XStack>
        <YStack f={1} ref={contentRef}>
          {blockContent && (
            <AppDocContentProvider>
              <BlocksContent
                blocks={[blockContent]}
                parentBlockId={blockId}
                hideCollapseButtons
              />
            </AppDocContentProvider>
          )}
        </YStack>
        {canExpand && !expanded ? (
          <LinearGradient
            colors={['$brand12', 'transparent']}
            start={[0, 1]}
            end={[0, 0]}
            w="100%"
            position="absolute"
            bottom={0}
            left={0}
            right={0}
            height={32}
          />
        ) : null}
      </XStack>
      {canExpand && (
        <Tooltip content={expanded ? 'Collapse' : 'Expand'}>
          <Button
            flexShrink={0}
            size="$2"
            onPress={() => setExpanded(!expanded)}
            chromeless
            hoverStyle={{bg: '$brand11'}}
            icon={expanded ? ChevronsUp : ChevronsDown}
          ></Button>
        </Tooltip>
      )}
    </YStack>
  )
}

function CommentReplyAccessory({
  docId,
  onBack,
  commentId,
  onReplyClick,
  onReplyCountClick,
}: {
  docId: UnpackedHypermediaId
  onBack: () => void
  commentId: string
  onReplyClick: (commentId: string, rootReplyCommentId?: string | null) => void
  onReplyCountClick: (
    commentId: string,
    rootReplyCommentId?: string | null,
  ) => void
}) {
  const comment = useComment(hmId('c', commentId))
  const commentAuthor = useEntity(
    comment.data?.author ? hmId('d', comment.data?.author) : null,
  )
  const allComments = useAllDocumentComments(docId)
  const replyCount = useMemo(() => {
    return allComments.data?.filter((c) => c.replyParent === commentId).length
  }, [allComments.data, commentId])
  return (
    <AccessoryContainer
      title="Comment"
      footer={
        <View padding="$3">
          <CommentDraft
            docId={docId}
            backgroundColor="$color1"
            replyCommentId={commentId}
          />
        </View>
      }
    >
      <AccessoryBackButton onPress={onBack} label="All Discussions" />
      {comment.data ? (
        <Comment
          comment={comment.data}
          renderCommentContent={renderCommentContent}
          docId={docId}
          authorMetadata={commentAuthor.data?.document?.metadata}
          rootReplyCommentId={null}
          isLast
          enableWebSigning={false}
          CommentReplies={CommentReplies}
          enableReplies
          replyCount={replyCount}
          defaultExpandReplies
          RepliesEditor={RepliesEditor}
          onReplyClick={onReplyClick}
          onReplyCountClick={onReplyCountClick}
        />
      ) : (
        <Spinner />
      )}
    </AccessoryContainer>
  )
}

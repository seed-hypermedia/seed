import {useEntityCitations} from '@/models/citations'
import {
  useAllDocumentComments,
  useCommentGroups,
  useCommentParents,
  useDocumentCommentGroups,
} from '@/models/comments'
import {useAccountsMetadata} from '@/models/entities'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {DocumentDiscussionsAccessory, pluralS} from '@shm/shared'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {AccessoryBackButton} from '@shm/ui/accessories'
import {CommentGroup} from '@shm/ui/discussion'
import {BlocksContent, getBlockNodeById} from '@shm/ui/document-content'
import {CitationsIcon} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {ChevronsDown, ChevronsUp} from '@tamagui/lucide-icons'
import {YStack} from '@tamagui/stacks'
import {memo, useEffect, useMemo, useRef, useState} from 'react'
import {Button, SizableText, Spinner, View, XStack} from 'tamagui'
import {LinearGradient} from 'tamagui/linear-gradient'
import {AccessoryContainer} from './accessory-sidebar'
import {CommentCitationEntry} from './citations-panel'
import {
  CommentDraft,
  CommentReplies,
  renderCommentContent,
  triggerCommentDraftFocus,
  useCommentGroupAuthors,
} from './commenting'

export const DiscussionsPanel = memo(_DiscussionsPanel)

function _DiscussionsPanel({
  onClose,
  docId,
  onAccessory,
  accessory: {openComment, openBlockId, blockRange, autoFocus, isReplying},
}: {
  onClose?: () => void
  docId: UnpackedHypermediaId
  accessory: DocumentDiscussionsAccessory
  onAccessory: (acc: DocumentDiscussionsAccessory) => void
}) {
  const route = useNavRoute()
  const navigate = useNavigate('replace')

  function focusComment(commentId: string, isReplying?: boolean) {
    if (route.key != 'document') return
    navigate({
      ...route,
      id: {...route.id},
      accessory: {
        ...route.accessory,
        key: 'discussions',
        openComment: commentId,
        openBlockId: undefined,
        isReplying,
      },
    })
  }

  function onReplyClick(commentId: string) {
    focusComment(commentId, true)
    triggerCommentDraftFocus(docId.id, commentId)
  }

  function onReplyCountClick(commentId: string) {
    focusComment(commentId, false)
  }

  if (openComment) {
    return (
      <CommentReplyAccessory
        docId={docId}
        onBack={() => onAccessory({key: 'discussions'})}
        commentId={openComment}
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
        isReplying={isReplying}
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
      title="Discussions"
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

  useEffect(() => {
    setExpanded(false)
    setCanExpand(true)
    if (contentRef.current) {
      const height = contentRef.current?.getBoundingClientRect?.().height

      setCanExpand(height > BLOCK_DEFAULT_HEIGHT)
    }
  }, [contentRef.current, blockId])

  if (doc.isInitialLoading) {
    return <Spinner />
  }
  return (
    <YStack marginLeft={12} bg="$brand12" borderRadius="$2">
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
          />
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
  isReplying,
}: {
  docId: UnpackedHypermediaId
  onBack: () => void
  commentId: string
  onReplyClick: (commentId: string, rootReplyCommentId?: string | null) => void
  onReplyCountClick: (
    commentId: string,
    rootReplyCommentId?: string | null,
  ) => void
  isReplying?: boolean
}) {
  const parentThread = useCommentParents(docId, commentId)
  const commentAuthors = useAccountsMetadata(
    useMemo(() => {
      return parentThread?.map((doc) => doc.author) || []
    }, [parentThread]),
  )
  const rootCommentId = parentThread?.at(0)?.id
  return (
    <AccessoryContainer
      title="Comment"
      footer={
        isReplying ? (
          <View padding="$3">
            <CommentDraft
              docId={docId}
              autoFocus={isReplying}
              backgroundColor="$color1"
              replyCommentId={commentId}
            />
          </View>
        ) : null
      }
    >
      <AccessoryBackButton onPress={onBack} label="All Discussions" />

      {rootCommentId && parentThread ? (
        <CommentGroup
          docId={docId}
          commentGroup={{
            id: rootCommentId,
            comments: parentThread,
            moreCommentsCount: 0,
            type: 'commentGroup',
          }}
          isLastGroup
          authors={commentAuthors}
          renderCommentContent={renderCommentContent}
          rootReplyCommentId={null}
          highlightLastComment
          onReplyClick={onReplyClick}
          onReplyCountClick={onReplyCountClick}
        />
      ) : null}

      <FocusedCommentReplies
        defaultOpen={!isReplying}
        docId={docId}
        commentId={commentId}
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
      />
    </AccessoryContainer>
  )
}

function FocusedCommentReplies({
  defaultOpen,
  docId,
  commentId,
  onReplyClick,
  onReplyCountClick,
}: {
  defaultOpen: boolean
  docId: UnpackedHypermediaId
  commentId: string
  onReplyClick: (commentId: string, rootReplyCommentId?: string | null) => void
  onReplyCountClick: (
    commentId: string,
    rootReplyCommentId?: string | null,
  ) => void
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const comments = useAllDocumentComments(docId)
  useEffect(() => {
    setIsOpen(defaultOpen)
  }, [commentId, defaultOpen])
  const replies = useCommentGroups(comments.data, commentId)
  const commentAuthors = useCommentGroupAuthors(replies)
  if (!replies) return null
  if (replies.length == 0) return null
  if (!isOpen)
    return (
      <Button onPress={() => setIsOpen(true)} size="$1">
        <SizableText size="$1">{`Show ${replies?.length} ${pluralS(
          replies?.length,
          'Reply',
          'Replies',
        )}`}</SizableText>
      </Button>
    )
  return (
    <YStack>
      {replies.map((r) => {
        return (
          <CommentGroup
            key={r.id}
            docId={docId}
            commentGroup={r}
            renderCommentContent={renderCommentContent}
            rootReplyCommentId={null}
            authors={commentAuthors}
            onReplyClick={onReplyClick}
            onReplyCountClick={onReplyCountClick}
          />
        )
      })}
    </YStack>
  )
}

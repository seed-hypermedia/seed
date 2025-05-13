import {useEntityCitations} from '@/models/citations'
import {useAllDocumentComments} from '@/models/comments'
import {useAccountsMetadata} from '@/models/entities'
import {AppDocContentProvider} from '@/pages/document-content-provider'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {DocumentDiscussionsAccessory, pluralS} from '@shm/shared'
import {useCommentGroups, useCommentParents} from '@shm/shared/discussion'
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
import {Button, Separator, SizableText, Spinner, View, XStack} from 'tamagui'
import {LinearGradient} from 'tamagui/linear-gradient'
import {AccessoryContent} from './accessory-sidebar'
import {CommentCitationEntry} from './citations-panel'
import {
  CommentBox,
  renderCommentContent,
  triggerCommentDraftFocus,
  useCommentGroupAuthors,
} from './commenting'

export const DiscussionsPanel = memo(_DiscussionsPanel)

function _DiscussionsPanel({
  docId,
  onAccessory,
  accessory: {openComment, openBlockId, blockRange, autoFocus, isReplying},
}: {
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
      />
    )
  }
  return <AllComments docId={docId} />
}

function AllComments({docId}: {docId: UnpackedHypermediaId}) {
  const comments = useAllDocumentComments(docId)
  const commentGroups = useCommentGroups(comments.data)
  const authors = useCommentGroupAuthors(commentGroups.data)

  return (
    <AccessoryContent
      footer={
        <View paddingVertical="$2">
          <CommentBox docId={docId} backgroundColor="$colorTransparent" />
        </View>
      }
    >
      <YStack>
        {commentGroups.data?.map((cg, idx) => {
          return (
            <YStack
              key={cg.id}
              paddingHorizontal="$1.5"
              marginBottom={commentGroups.data?.length - 1 > idx ? '$4' : 0}
            >
              <CommentGroup
                rootReplyCommentId={null}
                key={cg.id}
                commentGroup={cg}
                authors={authors}
                renderCommentContent={renderCommentContent}
                enableReplies={true}
              />
              {commentGroups.data?.length - 1 > idx && <Separator />}
            </YStack>
          )
        })}
      </YStack>
    </AccessoryContent>
  )
}

function CommentBlockAccessory({
  docId,
  blockId,
  autoFocus,
  onBack,
}: {
  docId: UnpackedHypermediaId
  blockId: string
  autoFocus?: boolean
  onBack: () => void
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
    <AccessoryContent
      footer={
        <View padding="$3">
          <CommentBox docId={docId} quotingBlockId={blockId} />
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
          />
        )
      })}
    </AccessoryContent>
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
  isReplying,
}: {
  docId: UnpackedHypermediaId
  onBack: () => void
  commentId: string
  isReplying?: boolean
}) {
  const comments = useAllDocumentComments(docId)
  const parentThread = useCommentParents(comments.data, commentId)
  const commentAuthors = useAccountsMetadata(
    useMemo(() => {
      return parentThread?.map((doc) => doc.author) || []
    }, [parentThread]),
  )
  const rootCommentId = parentThread?.at(0)?.id
  return (
    <AccessoryContent
      footer={
        isReplying ? (
          <View padding="$3">
            <CommentBox
              docId={docId}
              autoFocus={isReplying}
              replyCommentId={commentId}
            />
          </View>
        ) : null
      }
    >
      <AccessoryBackButton onPress={onBack} label="All Discussions" />
      {rootCommentId && parentThread ? (
        <CommentGroup
          commentGroup={{
            id: rootCommentId,
            comments: parentThread,
            moreCommentsCount: 0,
            type: 'commentGroup',
          }}
          authors={commentAuthors}
          renderCommentContent={renderCommentContent}
          rootReplyCommentId={null}
          highlightLastComment
        />
      ) : null}

      <FocusedCommentReplies
        defaultOpen={!isReplying}
        docId={docId}
        commentId={commentId}
      />
    </AccessoryContent>
  )
}

function FocusedCommentReplies({
  defaultOpen,
  docId,
  commentId,
}: {
  defaultOpen: boolean
  docId: UnpackedHypermediaId
  commentId: string
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const comments = useAllDocumentComments(docId)
  useEffect(() => {
    setIsOpen(defaultOpen)
  }, [commentId, defaultOpen])
  const replies = useCommentGroups(comments.data, commentId)
  const commentAuthors = useCommentGroupAuthors(replies.data)
  if (!replies) return null
  if (replies.data.length == 0) return null
  if (!isOpen)
    return (
      <Button onPress={() => setIsOpen(true)} size="$1">
        <SizableText size="$1">{`Show ${replies.data.length} ${pluralS(
          replies.data.length,
          'Reply',
          'Replies',
        )}`}</SizableText>
      </Button>
    )
  return (
    <YStack>
      {replies.data.map((r) => {
        return (
          <CommentGroup
            key={r.id}
            commentGroup={r}
            renderCommentContent={renderCommentContent}
            rootReplyCommentId={null}
            authors={commentAuthors}
          />
        )
      })}
    </YStack>
  )
}

import {
  formattedDateLong,
  formattedDateMedium,
  HMAccountsMetadata,
  HMComment,
  HMCommentGroup,
  hmId,
  HMMetadata,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useDiscussionsContext} from '@shm/shared/discussions-provider'
import {useEntity} from '@shm/shared/models/entity'
import {Button, ButtonText} from '@tamagui/button'
import {useTheme, View} from '@tamagui/core'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
} from '@tamagui/lucide-icons'
import {XStack, YStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import {ReactNode, useEffect, useMemo, useRef, useState} from 'react'
import {LinearGradient} from 'react-native-svg'
import {copyTextToClipboard} from './copy-to-clipboard'
import {BlocksContent, getBlockNodeById} from './document-content'
import {HMIcon} from './hm-icon'
import {BlockQuote, ReplyArrow} from './icons'
import {Spinner} from './spinner'
import {Tooltip} from './tooltip'
import {useIsDark} from './use-is-dark'

const Stack = View
const lineColor = '$color7'
const lineWidth = 1
const avatarSize = 16

// this is a LINEARIZED set of comments, where one comment is directly replying to another. the commentGroup.moreCommentsCount should be the number of replies to the last comment in the group.
export function CommentGroup({
  commentGroup,
  authors,
  renderCommentContent,
  rootReplyCommentId,
  enableReplies = true,
  highlightLastComment = false,
}: {
  commentGroup: HMCommentGroup
  authors?: HMAccountsMetadata | undefined
  rootReplyCommentId: string | null
  renderCommentContent: (comment: HMComment) => ReactNode
  enableReplies?: boolean
  highlightLastComment?: boolean
}) {
  const lastComment = commentGroup.comments.at(-1)
  return (
    <YStack gap="$2">
      {commentGroup.comments.length > 1 && (
        <View
          width={lineWidth}
          height={`calc(100% - ${avatarSize / 2}px)`}
          position="absolute"
          top={avatarSize / 2}
          left={avatarSize - 2}
          bg={lineColor}
        />
      )}
      {commentGroup.comments.map((comment) => {
        const isLastCommentInGroup = !!lastComment && comment === lastComment
        return (
          <Comment
            isLast={isLastCommentInGroup}
            key={comment.id}
            comment={comment}
            rootReplyCommentId={
              rootReplyCommentId || commentGroup.comments[0].id || null
            }
            authorMetadata={authors?.[comment.author]?.metadata}
            authorId={authors?.[comment.author]?.id.uid}
            renderCommentContent={renderCommentContent}
            replyCount={
              isLastCommentInGroup ? commentGroup.moreCommentsCount : undefined
            }
            enableReplies={enableReplies}
            highlight={highlightLastComment && isLastCommentInGroup}
          />
        )
      })}
    </YStack>
  )
}

export function Comment({
  comment,
  replyCount,
  isLast = false,
  rootReplyCommentId,
  authorMetadata,
  authorId,
  renderCommentContent,
  enableReplies = true,
  defaultExpandReplies = false,
  highlight = false,
}: {
  comment: HMComment
  replyCount?: number
  isLast?: boolean
  rootReplyCommentId: string | null
  authorMetadata?: HMMetadata | null
  authorId?: string | null
  renderCommentContent: (comment: HMComment) => ReactNode
  enableReplies?: boolean
  defaultExpandReplies?: boolean
  highlight?: boolean
}) {
  const [showReplies, setShowReplies] = useState(defaultExpandReplies)
  const discussionsContext = useDiscussionsContext()
  const authorHmId =
    comment.author || authorId ? hmId('d', authorId || comment.author) : null
  const authorLink = useRouteLink(
    authorHmId ? {key: 'document', id: authorHmId} : null,
  )
  const theme = useTheme()
  const isDark = useIsDark()

  useEffect(() => {
    if (defaultExpandReplies !== showReplies) {
      setShowReplies(defaultExpandReplies)
    }
  }, [defaultExpandReplies])

  return (
    <XStack
      gap="$2"
      padding="$2"
      group="item"
      backgroundColor={highlight ? '$brand12' : undefined}
      borderRadius={'$2'}
    >
      {isLast ? (
        <View
          width={10}
          h={`calc(100% - ${avatarSize + 10}px)`}
          zi="$zIndex.2"
          position="absolute"
          left={10}
          bottom={0}
          bg={
            highlight
              ? '$brand12'
              : isDark
              ? '$background'
              : '$backgroundStrong'
          }
        />
      ) : null}
      <Stack position="relative">
        <Stack
          position="absolute"
          top={0}
          zi="$zIndex.2"
          left={0}
          w={16}
          h={16}
          bg="transparent"
          outlineColor={
            highlight
              ? '$brand12'
              : isDark
              ? '$backgroundStrong'
              : '$background'
          }
          outlineStyle="solid"
          outlineWidth={4}
          borderRadius={100}
          hoverStyle={{
            outlineColor: '$backgroundStrong',
          }}
          {...authorLink}
        />
        {authorId && (
          <View w={16} h={16}>
            <HMIcon
              zi="$zIndex.2"
              id={authorId}
              metadata={authorMetadata}
              size={16}
            />
          </View>
        )}
      </Stack>
      <YStack f={1} gap="$1">
        <XStack minHeight={16} ai="center" gap="$2">
          <ButtonText
            size="$1"
            h={16}
            fontWeight="bold"
            hoverStyle={{
              bg: '$backgroundStrong',
            }}
            {...authorLink}
          >
            {authorMetadata?.name || '...'}
          </ButtonText>
          <Tooltip content={formattedDateLong(comment.createTime)}>
            <ButtonText
              color="$color8"
              fontSize={10}
              h={16}
              onPress={() => {
                copyTextToClipboard(comment.id)
              }}
            >
              {formattedDateMedium(comment.createTime)}
            </ButtonText>
          </Tooltip>
        </XStack>
        <XStack marginLeft={-8}>{renderCommentContent(comment)}</XStack>
        {!highlight && (
          <XStack
            ai="center"
            gap="$2"
            marginLeft={-4}
            paddingVertical="$1"
            marginBottom="$2"
          >
            {replyCount ? (
              <Button
                chromeless
                size="$1"
                icon={showReplies ? ChevronDown : ChevronRight}
                color="$brand5"
                borderColor="$colorTransparent"
                hoverStyle={{
                  bg: '$color4',
                  borderColor: '$color5',
                }}
                focusStyle={{
                  bg: '$color5',
                  borderColor: '$color6',
                }}
                pressStyle={{
                  bg: '$color5',
                  borderColor: '$color6',
                }}
                onPress={() => {
                  // if (onReplyCountClick) {
                  //   onReplyCountClick(
                  //     comment.id,
                  //     rootReplyCommentId || comment.id,
                  //   )
                  // } else {
                  //   setShowReplies(!showReplies)
                  // }
                  discussionsContext.onReplyCountClick(
                    comment.id,
                    rootReplyCommentId || comment.id,
                  )
                }}
              >
                <SizableText
                  size="$1"
                  color="$brand5"
                  hoverStyle={{color: '$brand6'}}
                  focusStyle={{color: '$brand7'}}
                  pressStyle={{color: '$brand7'}}
                >
                  Replies ({replyCount})
                </SizableText>
              </Button>
            ) : null}
            {enableReplies || discussionsContext.onReplyClick ? (
              <Button
                chromeless
                size="$1"
                icon={<ReplyArrow color={theme.brand5.val} size={16} />}
                onPress={() => {
                  if (discussionsContext.onReplyClick) {
                    discussionsContext.onReplyClick(
                      comment.id,
                      rootReplyCommentId || comment.id,
                    )
                  }
                }}
                color="$brand5"
                borderColor="$colorTransparent"
                hoverStyle={{
                  bg: '$color4',
                  borderColor: '$color5',
                }}
                focusStyle={{
                  bg: '$color5',
                  borderColor: '$color6',
                }}
                pressStyle={{
                  bg: '$color5',
                  borderColor: '$color6',
                }}
              >
                <SizableText
                  size="$1"
                  color="$brand5"
                  hoverStyle={{color: '$brand6'}}
                  focusStyle={{color: '$brand7'}}
                  pressStyle={{color: '$brand7'}}
                >
                  Reply
                </SizableText>
              </Button>
            ) : null}
          </XStack>
        )}
      </YStack>
      {/* {onCopyReference && (
          <Tooltip content="Copy link to comment">
            <Button
              position="absolute"
              right="$1"
              top="$2"
              size="$2"
              chromeless
              onPress={() => {
                if (!onCopyReference) {
                  toast.error('No onCopyReference function provided')
                  return
                }
                onCopyReference(
                  hmId('c', comment.id, {
                    targetDocUid: docId.uid,
                    targetDocPath: docId.path,
                  }),
                )
              }}
              opacity={0}
              hoverStyle={{
                backgroundColor: '$color5',
              }}
              $group-item-hover={{
                opacity: 1,
              }}
              icon={Link}
            ></Button>
          </Tooltip>
        )} */}
    </XStack>
  )
}

const BLOCK_DEFAULT_HEIGHT = 180

export function QuotedDocBlock({
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
    <YStack bg="$brand12" borderRadius="$2">
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
          <BlockQuote size={23} />
        </XStack>
        <YStack f={1} ref={contentRef}>
          {blockContent && (
            <BlocksContent
              blocks={[blockContent]}
              parentBlockId={blockId}
              hideCollapseButtons
            />
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

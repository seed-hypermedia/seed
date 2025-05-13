import {
  formattedDateLong,
  formattedDateMedium,
  HMAccountsMetadata,
  HMComment,
  HMCommentGroup,
  hmId,
  HMMetadata,
  useRouteLink,
} from '@shm/shared'
import {useDiscussionsContext} from '@shm/shared/discussions-provider'
import {Button, ButtonText} from '@tamagui/button'
import {useTheme, View} from '@tamagui/core'
import {ChevronDown, ChevronRight} from '@tamagui/lucide-icons'
import {XStack, YStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import {ReactNode, useEffect, useState} from 'react'
import {copyTextToClipboard} from './copy-to-clipboard'
import {HMIcon} from './hm-icon'
import {ReplyArrow} from './icons'
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
          <HMIcon
            zi="$zIndex.2"
            id={authorId}
            metadata={authorMetadata}
            size={16}
          />
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

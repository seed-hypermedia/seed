import {
  HMAccountsMetadata,
  HMComment,
  HMCommentGroup,
  HMDocument,
  hmId,
  HMMetadata,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useDiscussionsContext} from '@shm/shared/discussions-provider'
import {useTxString, useTxUtils} from '@shm/shared/translation'
import {useResourceUrl} from '@shm/shared/url'
import {Button, ButtonText} from '@tamagui/button'
import {useTheme, View} from '@tamagui/core'
import {ChevronDown, ChevronRight, Copy} from '@tamagui/lucide-icons'
import {XStack, YStack} from '@tamagui/stacks'
import {ReactNode, useEffect, useMemo, useState} from 'react'
import {copyTextToClipboard} from './copy-to-clipboard'
import {BlocksContent, getBlockNodeById} from './document-content'
import {HMIcon} from './hm-icon'
import {BlockQuote, ReplyArrow} from './icons'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
import {useIsDark} from './use-is-dark'

const Stack = View
const avatarSize = 18

// this is a LINEARIZED set of comments, where one comment is directly replying to another. the commentGroup.moreCommentsCount should be the number of replies to the last comment in the group.
export function CommentGroup({
  commentGroup,
  authors,
  renderCommentContent,
  enableReplies = true,
  highlightLastComment = false,
}: {
  commentGroup: HMCommentGroup
  authors?: HMAccountsMetadata | undefined
  renderCommentContent: (comment: HMComment) => ReactNode
  enableReplies?: boolean
  highlightLastComment?: boolean
}) {
  const lastComment = commentGroup.comments.at(-1)
  return (
    <div className="relative flex flex-col gap-2">
      {commentGroup.comments.length > 1 && (
        <div
          className="bg-border absolute w-px"
          style={{
            height: `calc(100% - ${avatarSize / 2}px)`,
            top: avatarSize / 2,
            left: avatarSize - 2,
          }}
        />
      )}
      {commentGroup.comments.map((comment) => {
        const isLastCommentInGroup = !!lastComment && comment === lastComment
        return (
          <Comment
            isLast={isLastCommentInGroup}
            key={comment.id}
            comment={comment}
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
    </div>
  )
}

export function Comment({
  comment,
  replyCount,
  isLast = false,
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
  const tx = useTxString()
  const {formattedDateMedium, formattedDateLong} = useTxUtils()
  useEffect(() => {
    if (defaultExpandReplies !== showReplies) {
      setShowReplies(defaultExpandReplies)
    }
  }, [defaultExpandReplies])
  const getUrl = useResourceUrl()
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
          h={`calc(100% - ${avatarSize + 12}px)`}
          zi="$zIndex.1"
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
      <div className="relative mt-0.5 min-w-5">
        <Stack
          position="absolute"
          top={0}
          zi="$zIndex.2"
          left={0}
          w={20}
          h={20}
          role="link"
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
        {authorHmId && (
          <div className="size-5">
            <HMIcon id={authorHmId} metadata={authorMetadata} size={20} />
          </div>
        )}
      </div>
      <YStack f={1} gap="$1">
        <XStack justifyContent="space-between">
          <XStack minHeight={16} ai="center" gap="$2">
            <ButtonText
              size="$1"
              h={16}
              role="link"
              fontWeight="bold"
              hoverStyle={{
                bg: '$backgroundStrong',
              }}
              {...authorLink}
            >
              {authorMetadata?.name || '...'}
            </ButtonText>
            <Tooltip content={formattedDateLong(comment.createTime)}>
              <ButtonText color="$color8" fontSize={10} h={16}>
                {formattedDateMedium(comment.createTime)}
              </ButtonText>
            </Tooltip>
          </XStack>
          <Tooltip content={tx('Copy Comment Link')}>
            <Button
              icon={Copy}
              chromeless
              size="$1"
              $group-item-hover={{opacity: 1}}
              opacity={0}
              onPress={() => {
                const url = getUrl(hmId('d', comment.id))
                console.log('~ url', url)
                copyTextToClipboard(url)
              }}
            />
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
                  discussionsContext.onReplyCountClick(comment)
                }}
              >
                <SizableText
                  size="xs"
                  color="brand"
                  className="hover:text-brand-600 focus:text-brand-700 active:text-brand-700"
                >
                  {tx(
                    'replies_count',
                    (args: {count: number}) => `Replies (${args.count})`,
                    {count: replyCount},
                  )}
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
                    discussionsContext.onReplyClick(comment)
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
                  size="xs"
                  color="brand"
                  className="hover:text-brand-600 focus:text-brand-700 active:text-brand-700"
                >
                  {tx('Reply')}
                </SizableText>
              </Button>
            ) : null}
          </XStack>
        )}
      </YStack>
    </XStack>
  )
}

export function QuotedDocBlock({
  docId,
  blockId,
  doc,
}: {
  docId: UnpackedHypermediaId
  blockId: string
  doc: HMDocument
}) {
  const blockContent = useMemo(() => {
    if (!doc.content) return null
    return getBlockNodeById(doc.content, blockId)
  }, [doc.content, blockId])

  return (
    <YStack bg="$brand12" borderRadius="$2">
      <XStack
        borderRadius="$2"
        padding="$2"
        gap="$1"
        position="relative"
        animation="fast"
      >
        <XStack flexShrink={0} paddingVertical="$1.5">
          <BlockQuote size={23} />
        </XStack>
        <YStack f={1}>
          {blockContent && (
            <BlocksContent
              blocks={[blockContent]}
              parentBlockId={blockId}
              hideCollapseButtons
            />
          )}
        </YStack>
      </XStack>
    </YStack>
  )
}

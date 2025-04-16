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
import {Button, ButtonText} from '@tamagui/button'
import {useTheme, View} from '@tamagui/core'
import {ChevronDown, ChevronRight, Link} from '@tamagui/lucide-icons'
import {XStack, YStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import {ReactNode, useState} from 'react'
import {copyTextToClipboard} from './copy-to-clipboard'
import {HMIcon} from './hm-icon'
import {ReplyArrow} from './icons'
import {toast} from './toast'
import {Tooltip} from './tooltip'

const Stack = View
const lineColor = '$color7'
const lineWidth = 1

// this is a LINEARIZED set of comments, where one comment is directly replying to another. the commentGroup.moreCommentsCount should be the number of replies to the last comment in the group.
export function CommentGroup({
  docId,
  commentGroup,
  isNested = false,
  isLastGroup = false,
  authors,
  renderCommentContent,
  RepliesEditor,
  CommentReplies,
  homeId,
  siteHost,
  rootReplyCommentId,
  enableReplies = true,
  enableWebSigning = false,
}: {
  docId: UnpackedHypermediaId
  commentGroup: HMCommentGroup
  isNested?: boolean
  isLastGroup?: boolean
  authors?: HMAccountsMetadata | undefined
  rootReplyCommentId: string | null
  renderCommentContent: (comment: HMComment) => ReactNode
  RepliesEditor?: React.FC<{
    enableReplies?: boolean
    isReplying: boolean
    docId: UnpackedHypermediaId
    replyCommentId: string
    rootReplyCommentId: string
    onDiscardDraft: () => void
    onReplied: () => void
    enableWebSigning: boolean
  }>
  CommentReplies: React.FC<{
    docId: UnpackedHypermediaId
    replyCommentId: string
    rootReplyCommentId: string
    homeId?: UnpackedHypermediaId
    siteHost?: string
  }>
  homeId?: UnpackedHypermediaId
  siteHost?: string
  enableReplies?: boolean
  enableWebSigning?: boolean
}) {
  const lastComment = commentGroup.comments.at(-1)
  return (
    <YStack>
      {isLastGroup ? (
        <View
          width={5}
          position="absolute"
          top={8}
          bottom={-10}
          left={-8}
          bg="$backgroundStrong"
        />
      ) : null}
      {commentGroup.comments.map((comment, idx) => {
        const isLastCommentInGroup = !!lastComment && comment === lastComment
        return (
          <Comment
            isFirst={idx == 0}
            isLast={isLastCommentInGroup}
            isNested={isNested}
            key={comment.id}
            docId={docId}
            comment={comment}
            rootReplyCommentId={
              rootReplyCommentId || commentGroup.comments[0].id || null
            }
            authorMetadata={authors?.[comment.author]?.metadata}
            renderCommentContent={renderCommentContent}
            replyCount={
              isLastCommentInGroup ? commentGroup.moreCommentsCount : undefined
            }
            enableWebSigning={enableWebSigning}
            RepliesEditor={RepliesEditor}
            CommentReplies={CommentReplies}
            enableReplies={enableReplies}
            homeId={homeId}
            siteHost={siteHost}
          />
        )
      })}
    </YStack>
  )
}

export function Comment({
  docId,
  comment,
  replyCount,
  isFirst = false,
  isLast = false,
  isNested = false,
  rootReplyCommentId,
  homeId,
  authorMetadata,
  renderCommentContent,
  RepliesEditor,
  CommentReplies,
  siteHost,
  enableReplies = true,
  enableWebSigning = false,
  defaultExpandReplies = false,
}: {
  docId: UnpackedHypermediaId
  comment: HMComment
  replyCount?: number
  isFirst?: boolean
  isLast?: boolean
  isNested?: boolean
  rootReplyCommentId: string | null
  authorMetadata?: HMMetadata | null
  renderCommentContent: (comment: HMComment) => ReactNode
  homeId?: UnpackedHypermediaId
  enableWebSigning: boolean
  RepliesEditor?: React.FC<{
    isReplying: boolean
    docId: UnpackedHypermediaId
    replyCommentId: string
    rootReplyCommentId: string
    onDiscardDraft: () => void
    onReplied: () => void
    enableWebSigning: boolean
  }>
  CommentReplies: React.FC<{
    docId: UnpackedHypermediaId
    replyCommentId: string
    rootReplyCommentId: string
    homeId?: UnpackedHypermediaId
    siteHost?: string
    enableReplies?: boolean
  }>
  siteHost?: string
  enableReplies?: boolean
  defaultExpandReplies?: boolean
}) {
  // DISABLED COMMENT URL COPYINGc
  // const {onCopyReference} = useUniversalAppContext()
  const onCopyReference = null
  const [showReplies, setShowReplies] = useState(defaultExpandReplies)
  const [isReplying, setIsReplying] = useState(false)
  const authorId = comment.author ? hmId('d', comment.author) : null
  const authorLink = useRouteLink(
    authorId ? {key: 'document', id: authorId} : null,
  )
  const theme = useTheme()
  return (
    <YStack>
      <View
        width={lineWidth}
        height={isLast && !showReplies ? 20 : '100%'}
        position="absolute"
        top={isFirst ? 8 : 0}
        left={16}
        bg={lineColor}
      />
      {isFirst && isNested ? (
        <View
          position="absolute"
          zi="$zIndex.1"
          top={4}
          left={-6}
          width={12}
          height={15}
          borderLeftWidth={lineWidth}
          borderBottomWidth={lineWidth}
          borderLeftColor={lineColor}
          borderBottomColor={lineColor}
          borderRadius={25}
          borderTopLeftRadius={0}
          borderBottomRightRadius={0}
        />
      ) : null}
      <XStack gap="$2" padding="$2" group="item">
        <Stack position="relative">
          <Stack
            position="absolute"
            top={0}
            zi="$zIndex.2"
            left={0}
            w={20}
            h={20}
            bg="transparent"
            outlineColor="$background"
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
              size={20}
            />
          )}
        </Stack>
        <YStack f={1}>
          <XStack minHeight={20} ai="center" gap="$2">
            <ButtonText
              size="$2"
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
                size="$1"
                onPress={() => {
                  copyTextToClipboard(comment.id)
                }}
              >
                {formattedDateMedium(comment.createTime)}
              </ButtonText>
            </Tooltip>
          </XStack>
          <XStack marginLeft={-8}>{renderCommentContent(comment)}</XStack>
          <XStack ai="center" gap="$2" marginLeft={-4} paddingVertical="$1">
            {replyCount ? (
              <Button
                chromeless
                size="$1"
                icon={showReplies ? ChevronDown : ChevronRight}
                onPress={() => setShowReplies(!showReplies)}
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
                  Replies ({replyCount})
                </SizableText>
              </Button>
            ) : null}
            {RepliesEditor && enableReplies ? (
              <Button
                chromeless
                size="$1"
                icon={<ReplyArrow color={theme.brand5.val} size={16} />}
                onPress={() => setIsReplying(true)}
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
        </YStack>
        {onCopyReference && (
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
        )}
      </XStack>
      {RepliesEditor ? (
        <RepliesEditor
          isReplying={isReplying}
          docId={docId}
          replyCommentId={comment.id}
          rootReplyCommentId={rootReplyCommentId || comment.id}
          onDiscardDraft={() => setIsReplying(false)}
          enableWebSigning={enableWebSigning}
          onReplied={() => {
            // we want to show the replies if it was collapsed, because the new one should be visible
            if (replyCount === undefined || replyCount > 0) {
              setShowReplies(true)
            }
          }}
        />
      ) : null}
      {showReplies ? (
        <CommentReplies
          docId={docId}
          replyCommentId={comment.id}
          rootReplyCommentId={rootReplyCommentId || comment.id}
          homeId={homeId}
          siteHost={siteHost}
          enableReplies={enableReplies}
        />
      ) : null}
    </YStack>
  )
}

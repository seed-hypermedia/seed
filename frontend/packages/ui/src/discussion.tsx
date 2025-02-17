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
} from "@shm/shared";
import {Button, ButtonText} from "@tamagui/button";
import {useTheme, View} from "@tamagui/core";
import {ChevronDown, ChevronRight} from "@tamagui/lucide-icons";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {ReactNode, useState} from "react";
import {copyTextToClipboard} from "./copy-to-clipboard";
import {HMIcon} from "./hm-icon";
import {ReplyArrow} from "./icons";
import {Tooltip} from "./tooltip";

const Stack = View;
const lineColor = "$color7";
const lineWidth = 1;

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
}: {
  docId: UnpackedHypermediaId;
  commentGroup: HMCommentGroup;
  isNested?: boolean;
  isLastGroup?: boolean;
  authors?: HMAccountsMetadata | undefined;
  renderCommentContent: (comment: HMComment) => ReactNode;
  RepliesEditor?: React.FC<{
    isReplying: boolean;
    docId: UnpackedHypermediaId;
    replyCommentId: string;
    onDiscardDraft: () => void;
  }>;
  CommentReplies: React.FC<{
    docId: UnpackedHypermediaId;
    replyCommentId: string;
    homeId?: UnpackedHypermediaId;
    siteHost?: string;
  }>;
  homeId?: UnpackedHypermediaId;
  siteHost?: string;
}) {
  const lastComment = commentGroup.comments.at(-1);
  return (
    <YStack>
      {isLastGroup ? (
        <View
          width={5}
          position="absolute"
          top={8}
          bottom={-10}
          left={-8}
          bg="$background"
        />
      ) : null}
      {commentGroup.comments.map((comment, idx) => {
        const isLastCommentInGroup = !!lastComment && comment === lastComment;
        return (
          <Comment
            isFirst={idx == 0}
            isLast={isLastCommentInGroup}
            isNested={isNested}
            key={comment.id}
            docId={docId}
            comment={comment}
            authorMetadata={authors?.[comment.author]?.metadata}
            renderCommentContent={renderCommentContent}
            replyCount={
              isLastCommentInGroup ? commentGroup.moreCommentsCount : undefined
            }
            RepliesEditor={RepliesEditor}
            CommentReplies={CommentReplies}
            homeId={homeId}
            siteHost={siteHost}
          />
        );
      })}
    </YStack>
  );
}

function Comment({
  docId,
  comment,
  replyCount,
  isFirst = false,
  isLast = false,
  isNested = false,
  homeId,
  authorMetadata,
  renderCommentContent,
  RepliesEditor,
  CommentReplies,
  siteHost,
}: {
  docId: UnpackedHypermediaId;
  comment: HMComment;
  replyCount?: number;
  isFirst?: boolean;
  isLast?: boolean;
  isNested?: boolean;
  authorMetadata?: HMMetadata;
  renderCommentContent: (comment: HMComment) => ReactNode;
  homeId?: UnpackedHypermediaId;
  RepliesEditor?: React.FC<{
    isReplying: boolean;
    docId: UnpackedHypermediaId;
    replyCommentId: string;
    onDiscardDraft: () => void;
  }>;
  CommentReplies: React.FC<{
    docId: UnpackedHypermediaId;
    replyCommentId: string;
    homeId?: UnpackedHypermediaId;
    siteHost?: string;
  }>;
  siteHost?: string;
}) {
  const [showReplies, setShowReplies] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const authorId = comment.author ? hmId("d", comment.author) : null;
  const authorLink = useRouteLink(
    authorId ? {key: "document", id: authorId} : null
  );
  const theme = useTheme();
  return (
    <YStack>
      <View
        width={lineWidth}
        height={isLast && !showReplies ? 20 : "100%"}
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
      <XStack gap="$2" padding="$2">
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
              outlineColor: "$backgroundStrong",
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
                bg: "$backgroundStrong",
              }}
              {...authorLink}
            >
              {authorMetadata?.name || "..."}
            </ButtonText>
            <Tooltip content={formattedDateLong(comment.createTime)}>
              <ButtonText
                color="$color8"
                size="$1"
                onPress={() => {
                  copyTextToClipboard(comment.id);
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
                  bg: "$color4",
                  borderColor: "$color5",
                }}
                focusStyle={{
                  bg: "$color5",
                  borderColor: "$color6",
                }}
                pressStyle={{
                  bg: "$color5",
                  borderColor: "$color6",
                }}
              >
                <SizableText
                  size="$1"
                  color="$brand5"
                  hoverStyle={{color: "$brand6"}}
                  focusStyle={{color: "$brand7"}}
                  pressStyle={{color: "$brand7"}}
                >
                  Replies ({replyCount})
                </SizableText>
              </Button>
            ) : null}
            {RepliesEditor ? (
              <Button
                chromeless
                size="$1"
                icon={<ReplyArrow color={theme.brand5.val} size={16} />}
                onPress={() => setIsReplying(true)}
                color="$brand5"
                borderColor="$colorTransparent"
                hoverStyle={{
                  bg: "$color4",
                  borderColor: "$color5",
                }}
                focusStyle={{
                  bg: "$color5",
                  borderColor: "$color6",
                }}
                pressStyle={{
                  bg: "$color5",
                  borderColor: "$color6",
                }}
              >
                <SizableText
                  size="$1"
                  color="$brand5"
                  hoverStyle={{color: "$brand6"}}
                  focusStyle={{color: "$brand7"}}
                  pressStyle={{color: "$brand7"}}
                >
                  Reply
                </SizableText>
              </Button>
            ) : null}
          </XStack>
        </YStack>
      </XStack>
      {RepliesEditor ? (
        <RepliesEditor
          isReplying={isReplying}
          docId={docId}
          replyCommentId={comment.id}
          onDiscardDraft={() => setIsReplying(false)}
        />
      ) : null}
      {showReplies ? (
        <CommentReplies
          docId={docId}
          replyCommentId={comment.id}
          homeId={homeId}
          siteHost={siteHost}
        />
      ) : null}
    </YStack>
  );
}

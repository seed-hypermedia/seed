import {
  formattedDate,
  getMetadataName,
  hmId,
  HMMetadata,
  HMTimestamp,
  UnpackedHypermediaId,
  useRouteLink,
} from "@shm/shared";
import {Button} from "@tamagui/button";
import {Text} from "@tamagui/core";
import {Pencil} from "@tamagui/lucide-icons";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {useMemo} from "react";
import {LinkThumbnail, Thumbnail} from "./thumbnail";
import {itemHoverBgColor} from "./ui-constants";

// TODO: update types
export function DirectoryItem({
  entry,
  PathButton,
  FavoriteButton,
  authorsMetadata,
}: {
  entry: {
    path: string;
    hasDraft?: boolean;
    id: UnpackedHypermediaId;
    metadata: HMMetadata;
    updateTime?: HMTimestamp;
    authors: string[];
  };
  PathButton: React.FC<{path: string}>;
  FavoriteButton?: React.FC<{
    id: UnpackedHypermediaId;
    hideUntilItemHover: boolean;
  }>;
  authorsMetadata: {
    uid: string;
    metadata?: HMMetadata;
  }[];
}) {
  const metadata = entry?.metadata;
  const linkProps = useRouteLink({key: "document", id: entry.id});
  return (
    <Button
      group="item"
      borderWidth={0}
      hoverStyle={{
        bg: itemHoverBgColor,
      }}
      w="100%"
      paddingHorizontal={16}
      paddingVertical="$1"
      {...linkProps}
      h={60}
      icon={
        entry.metadata.thumbnail ? (
          <Thumbnail size={28} id={entry.id} metadata={entry.metadata} />
        ) : undefined
      }
    >
      <XStack gap="$2" ai="center" f={1} paddingVertical="$2">
        <YStack f={1} gap="$1.5">
          <XStack ai="center" gap="$2" f={1} w="100%">
            <SizableText
              fontWeight="bold"
              textOverflow="ellipsis"
              whiteSpace="nowrap"
              overflow="hidden"
            >
              {getMetadataName(metadata)}
            </SizableText>
          </XStack>
          <PathButton path={entry.path} />
        </YStack>
      </XStack>
      <XStack gap="$3" ai="center">
        {FavoriteButton && <FavoriteButton id={entry.id} hideUntilItemHover />}

        {entry.hasDraft ? (
          <DraftLink id={entry.id} />
        ) : (
          <SizableText size="$1">{formattedDate(entry.updateTime)}</SizableText>
        )}
        <XStack>
          <DocumentEditors
            authors={entry.authors}
            authorsMetadata={authorsMetadata}
          />
        </XStack>
      </XStack>
    </Button>
  );
}

function DraftLink({id}: {id: UnpackedHypermediaId}) {
  const draftLinkProps = useRouteLink({key: "draft", id});
  return (
    <Button theme="yellow" icon={Pencil} size="$2" {...draftLinkProps}>
      Resume Editing
    </Button>
  );
}
function DocumentEditors({
  authors,
  authorsMetadata,
}: {
  authors: string[];
  authorsMetadata: {uid: string; metadata?: HMMetadata}[];
}) {
  const editorIds = useMemo(
    () => (authors.length > 3 ? authors.slice(0, 2) : authors),
    [authors]
  );
  return (
    <>
      {/* todo add author data here */}
      {authors.map((author, idx) => {
        const authorInfo = authorsMetadata.find(
          (authorMetadata: any) => authorMetadata.uid === author
        );
        if (!authorInfo) return null;
        return (
          <XStack
            zIndex={idx + 1}
            key={editorIds[idx]}
            borderColor="$background"
            backgroundColor="$background"
            $group-item-hover={{
              borderColor: itemHoverBgColor,
              backgroundColor: itemHoverBgColor,
            }}
            borderWidth={2}
            borderRadius={100}
            overflow="hidden"
            marginLeft={-8}
            animation="fast"
          >
            <LinkThumbnail
              key={authorInfo.uid}
              id={hmId("d", authorInfo.uid)}
              metadata={authorInfo.metadata}
              size={20}
            />
          </XStack>
        );
      })}
      {authors.length > 2 ? (
        <XStack
          zIndex={authors.length}
          borderColor="$background"
          backgroundColor="$background"
          borderWidth={2}
          borderRadius={100}
          marginLeft={-8}
          animation="fast"
          width={24}
          height={24}
          ai="center"
          jc="center"
        >
          <Text
            fontSize={10}
            fontFamily="$body"
            fontWeight="bold"
            color="$color10"
          >
            +{authors.length - 3}
          </Text>
        </XStack>
      ) : null}
    </>
  );
}

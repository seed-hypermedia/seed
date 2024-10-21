import {
  formattedDate,
  getMetadataName,
  HMMetadata,
  HMTimestamp,
  UnpackedHypermediaId,
  useRouteLink,
} from "@shm/shared";
import {Button} from "@tamagui/button";
import {Pencil} from "@tamagui/lucide-icons";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {AccountsMetadata, FacePile} from "./face-pile";
import {HMIcon} from "./hm-icon";
import {itemHoverBgColor} from "./ui-constants";

// TODO: update types
export function DirectoryItem({
  entry,
  PathButtonComponent,
  FavoriteButton,
  authorsMetadata,
  siteHomeId,
}: {
  entry: {
    path: string;
    hasDraft?: boolean;
    id: UnpackedHypermediaId;
    metadata: HMMetadata;
    updateTime?: HMTimestamp;
    authors: string[];
  };
  PathButtonComponent: React.FC<{
    path: string;
    docId: UnpackedHypermediaId;
    isDraft?: boolean;
  }>;
  FavoriteButton?: React.FC<{
    id: UnpackedHypermediaId;
    hideUntilItemHover: boolean;
  }>;
  authorsMetadata: AccountsMetadata;
  siteHomeId?: UnpackedHypermediaId;
}) {
  const metadata = entry?.metadata;
  const linkProps = useRouteLink({key: "document", id: entry.id}, siteHomeId);
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
        entry.metadata.icon ? (
          <HMIcon size={28} id={entry.id} metadata={entry.metadata} />
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
          <PathButtonComponent docId={entry.id} path={entry.path} />
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
          <FacePile
            accounts={entry.authors}
            accountsMetadata={authorsMetadata}
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

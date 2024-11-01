import {
  HMDocumentListItem,
  hmId,
  HMMetadata,
  HMQueryResult,
  UnpackedHypermediaId,
  useRouteLink,
} from "@shm/shared";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {HMIcon} from "./hm-icon";

export function NewsSiteHeader({
  homeMetadata,
  homeId,
  supportQueries,
  rightContent,
  docId,
  afterLinksContent,
}: {
  homeMetadata: HMMetadata | null;
  homeId: UnpackedHypermediaId | null;
  supportQueries?: HMQueryResult[];
  rightContent?: React.ReactNode;
  docId?: UnpackedHypermediaId;
  afterLinksContent?: React.ReactNode;
}) {
  if (!homeId) return null;
  const supportQuery = supportQueries?.find((q) => q.in.uid === homeId?.uid);
  return (
    <YStack paddingBottom="$4" paddingHorizontal="$4">
      {homeId ? (
        <HomeHeader
          homeId={homeId}
          homeMetadata={homeMetadata}
          rightContent={rightContent}
        />
      ) : null}

      <XStack gap="$5" justifyContent="center" ai="center">
        {supportQuery?.results
          ?.filter((result) => result.path.length === 1)
          ?.map((result) => {
            if (result.path.length === 1 && result.path[0] === "") return null;
            return (
              <NewsSiteHeaderLink
                result={result}
                key={result.path.join("/")}
                active={!!docId?.path && result.path[0] === docId.path[0]}
              />
            );
          })}
        {afterLinksContent}
      </XStack>
    </YStack>
  );
}

function HomeHeader({
  homeMetadata,
  homeId,
  rightContent,
}: {
  homeMetadata: HMMetadata | null;
  homeId: UnpackedHypermediaId;
  rightContent?: React.ReactNode;
}) {
  const homeLinkProps = useRouteLink({
    key: "document",
    id: homeId,
  });
  return (
    <XStack marginHorizontal="$4">
      <XStack
        flex={1}
        {...homeLinkProps}
        justifyContent="center"
        marginVertical="$3"
        gap="$3"
      >
        <HMIcon size={24} id={homeId} metadata={homeMetadata} />
        <SizableText size="$4" fontWeight="bold">
          {homeMetadata?.name}
        </SizableText>
      </XStack>
      <XStack ai="center" gap="$3">
        {rightContent}
      </XStack>
    </XStack>
  );
}

function NewsSiteHeaderLink({
  result,
  active,
}: {
  result: HMDocumentListItem;
  active: boolean;
}) {
  const linkProps = useRouteLink({
    key: "document",
    id: hmId("d", result.account, {path: result.path}),
  });
  return (
    <SizableText
      fontWeight="bold"
      color={active ? "$color" : "$color9"}
      {...linkProps}
    >
      {result.metadata.name}
    </SizableText>
  );
}

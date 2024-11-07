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
import {useEffect} from "react";
import {Button} from "./button";
import {Close} from "./icons";
import {SiteLogo} from "./site-logo";

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
  searchUI?: React.ReactNode;
  children?: React.ReactNode;
  mobileSearchUI?: React.ReactNode;
  isWeb?: boolean;
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
  return (
    <XStack paddingHorizontal="$4" paddingVertical="$2.5" ai="center" gap="$4">
      <XStack w={38} />
      <XStack f={1} />
      <SiteLogo id={homeId} metadata={homeMetadata} />
      <XStack f={1} />
      <XStack
        ai="center"
        gap="$3"
        position="absolute"
        right={0}
        top={0}
        height="100%"
        background="$background"
      >
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

export function MobileMenu({
  children,
  open,
  onClose,
  mobileSearchUI,
}: {
  children: React.ReactNode;
  open: boolean;
  onClose: () => void;
  mobileSearchUI?: React.ReactNode;
}) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
  }, [open]);
  return (
    <YStack
      $gtSm={{
        display: "none",
      }}
      bg="$background"
      fullscreen
      // @ts-ignore
      position="fixed"
      top={0}
      right={0}
      bottom={0}
      zIndex="$zIndex.7"
      x={open ? 0 : "100%"}
      animation="fast"
    >
      <XStack p="$4" alignItems="center">
        <XStack f={1}>{mobileSearchUI}</XStack>
        <Button
          icon={<Close size={24} />}
          chromeless
          size="$2"
          onPress={onClose}
        />
      </XStack>
      <YStack p="$4" paddingBottom={200} flex={1} overflow="scroll">
        {children}
      </YStack>
    </YStack>
  );
}

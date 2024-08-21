import {getFileUrl, HMDocument, UnpackedHypermediaId} from "@shm/shared";
import {Button} from "@tamagui/button";
import {Stack} from "@tamagui/core";
import {XStack, YStack} from "@tamagui/stacks";
import {Thumbnail} from "./ui/thumbnail";

import {getRandomColor} from "@shm/ui/src/avatar";
import {SizableText} from "@tamagui/text";
import {useMemo} from "react";
import {Container} from "./ui/container";

export function PageHeader({
  homeMetadata,
  homeId,
  docMetadata,
  docId,
}: {
  homeMetadata: HMDocument["metadata"] | null;
  homeId: UnpackedHypermediaId | null;
  docMetadata: HMDocument["metadata"] | null;
  docId: UnpackedHypermediaId | null;
}) {
  const coverBg = useMemo(() => {
    if (docId?.id) {
      return getRandomColor(docId.id);
    }
  }, [docId]);

  const hasCover = useMemo(() => !!docMetadata?.cover, [docMetadata]);

  return (
    <YStack>
      <Stack flex={1} flexDirection="column" $gtSm={{flexDirection: "row"}}>
        <XStack paddingBlock="$2" paddingInline="$4" gap="$4">
          <XStack
            f={1}
            $gtSm={{
              f: "inherit",
            }}
            gap="$2"
            ai="center"
            onPress={() => {
              console.log("go to home");
            }}
            hoverStyle={{
              cursor: "pointer",
            }}
          >
            {homeMetadata?.thumbnail ? (
              <Thumbnail size={30} id={homeId} metadata={homeMetadata} />
            ) : null}

            <SizableText fontWeight="bold" cursor="pointer">
              {homeMetadata?.name || "Home Document"}
            </SizableText>
          </XStack>
          <XStack ai="center">
            <Button size="$2">search</Button>
          </XStack>
        </XStack>
        <XStack ai="center" $gtSm={{f: 1}} paddingBlock="$2" paddingInline="$4">
          <XStack>
            <SizableText size="$1" fontWeight="bold">
              {docMetadata?.name}
            </SizableText>
          </XStack>
        </XStack>
      </Stack>
      {hasCover ? (
        <XStack bg={coverBg} height="25vh" width="100%" position="relative">
          <img
            src={getFileUrl(docMetadata!.cover)}
            title={`doc cover`}
            style={{
              width: "100%",
              height: "100%",
              position: "absolute",
              top: 0,
              left: 0,
              objectFit: "cover",
            }}
          />
        </XStack>
      ) : null}
      <Container
        clearVerticalSpace
        marginTop={0}
        $gtSm={{
          marginTop: hasCover ? -60 : 0,
          y: -8,
        }}
        background="$background"
        borderRadius="$2"
      >
        <YStack paddingBlock="$5" paddingInline="$4">
          <SizableText size="$10">{docMetadata?.name}</SizableText>
        </YStack>
      </Container>
    </YStack>
  );
}

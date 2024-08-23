import {
  formattedDateMedium,
  getFileUrl,
  HMDocument,
  UnpackedHypermediaId,
} from "@shm/shared";
import {Button} from "@tamagui/button";
import {Stack} from "@tamagui/core";
import {Separator} from "@tamagui/separator";
import {XStack, YStack} from "@tamagui/stacks";
import {Thumbnail} from "./ui/thumbnail";

import {getRandomColor} from "@shm/ui/src/avatar";
import {Container} from "@shm/ui/src/container";
import {Menu, Search} from "@tamagui/lucide-icons";
import {H1, SizableText} from "@tamagui/text";
import {useMemo} from "react";
import {hmDocumentPayload} from "./loaders";

export function PageHeader({
  homeMetadata,
  homeId,
  docMetadata,
  docId,
  authors = [],
  updateTime = null,
}: {
  homeMetadata: HMDocument["metadata"] | null;
  homeId: UnpackedHypermediaId | null;
  docMetadata: HMDocument["metadata"] | null;
  docId: UnpackedHypermediaId | null;
  authors: hmDocumentPayload["authors"];
  updateTime: HMDocument["updateTime"] | null;
}) {
  const coverBg = useMemo(() => {
    if (docId?.id) {
      return getRandomColor(docId.id);
    }
  }, [docId]);

  const hasCover = useMemo(() => !!docMetadata?.cover, [docMetadata]);
  const hasThumbnail = useMemo(() => !!docMetadata?.thumbnail, [docMetadata]);
  const isHomeDoc = useMemo(() => docId?.id == homeId?.id, [docId, homeId]);

  return (
    <YStack>
      <Stack flex={1} flexDirection="column" $gtSm={{flexDirection: "row"}}>
        <XStack paddingBlock="$2" paddingInline="$4" gap="$4">
          <XStack
            f={1}
            tag="a"
            role="link"
            style={{textDecoration: "none"}}
            href="/"
            $gtSm={{
              f: "inherit",
            }}
            gap="$2"
            ai="center"
            cursor="pointer"
            hoverStyle={{
              textDecoration: "underline",
            }}
          >
            {homeMetadata?.thumbnail && homeId ? (
              <Thumbnail size={30} id={homeId} metadata={homeMetadata} />
            ) : null}

            <SizableText fontWeight="bold" cursor="pointer">
              {homeMetadata?.name || "Home Document"}
            </SizableText>
          </XStack>
          <XStack ai="center">
            <Button size="$2" chromeless bg="transparent" icon={Search} />
          </XStack>
        </XStack>
        <XStack ai="center" $gtSm={{f: 1}} paddingBlock="$2" paddingInline="$4">
          <XStack f={1}>
            <SizableText size="$1" fontWeight="bold">
              {docMetadata?.name}
            </SizableText>
          </XStack>
          <Button
            $gtMd={{opacity: 0, pointerEvents: "none"}}
            size="$2"
            chromeless
            bg="transparent"
            icon={Menu}
          />
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
        $gtSm={{
          marginTop: hasCover ? -40 : 0,
          paddingTop: !hasCover ? 60 : "$6",
        }}
        bg="$background"
        borderRadius="$2"
      >
        <YStack paddingInline="$4" gap="$4">
          {!isHomeDoc && docId && hasThumbnail ? (
            <XStack marginTop={hasCover ? -80 : 0}>
              <Thumbnail size={100} id={docId} metadata={docMetadata} />
            </XStack>
          ) : null}
          <H1 size="$9" style={{fontWeight: "bold"}}>
            {docMetadata?.name}
          </H1>
          <XStack marginTop="$4" gap="$3" ai="center" w="100%">
            {authors?.length ? (
              <XStack ai="center" overflow="hidden">
                {authors.map((a) => (
                  <SizableText size="$1">{a.metadata.name}</SizableText>
                ))}
              </XStack>
            ) : null}
            {authors?.length ? <VerticalSeparator /> : null}
            {updateTime ? (
              <>
                <SizableText size="$1" color="$color9">
                  {formattedDateMedium(updateTime)}
                </SizableText>
              </>
            ) : null}
          </XStack>
          <Separator />
        </YStack>
      </Container>
    </YStack>
  );
}

const VerticalSeparator = () => (
  <XStack flexShrink={0} flexGrow={0} w={1} h={20} bg="$color8" />
);

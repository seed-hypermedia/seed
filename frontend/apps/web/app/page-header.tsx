import {
  formattedDateMedium,
  getFileUrl,
  HMDocument,
  HMMetadata,
  UnpackedHypermediaId,
} from "@shm/shared";
import {Button} from "@tamagui/button";
import {Stack} from "@tamagui/core";
import {Separator} from "@tamagui/separator";
import {XStack, YStack} from "@tamagui/stacks";

import {usePopoverState} from "@shm/desktop/src/use-popover-state";
import {getRandomColor} from "@shm/ui/src/avatar";
import {Container} from "@shm/ui/src/container";
import {Popover} from "@shm/ui/src/TamaguiPopover";
import {Thumbnail} from "@shm/ui/src/thumbnail";
import {Input} from "@tamagui/input";
import {Menu, Search} from "@tamagui/lucide-icons";
import {H1, SizableText} from "@tamagui/text";
import {useEffect, useMemo, useState} from "react";
import {NativeSyntheticEvent, TextInputChangeEventData} from "react-native";
import {useFetcher} from "react-router-dom";
import type {MetadataPayload} from "./loaders";
import {SearchPayload} from "./routes/hm.api.search";
import {unwrap} from "./wrapping";

export function PageHeader({
  homeMetadata,
  homeId,
  docMetadata,
  docId,
  authors = [],
  updateTime = null,
  openSheet,
}: {
  homeMetadata: HMMetadata | null;
  homeId: UnpackedHypermediaId | null;
  docMetadata: HMMetadata | null;
  docId: UnpackedHypermediaId | null;
  authors: MetadataPayload[];
  updateTime: HMDocument["updateTime"] | null;
  openSheet: ReturnType<typeof useOutlineSheet>["setOpen"];
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
    <YStack style={{paddingTop: 80}}>
      <Stack
        flex={1}
        flexDirection="column"
        $gtSm={{flexDirection: "row"}}
        bg="$background"
        position="fixed"
        zi={9999}
        w="100%"
        top={0}
      >
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
            <SearchUI homeId={homeId} />
          </XStack>
        </XStack>
        <XStack
          ai="center"
          $gtSm={{f: 1}}
          paddingBlock="$2"
          paddingInline="$4"
          position="sticky"
          bg="$background"
          zi={2000}
          top={0}
        >
          <XStack f={1}>
            <SizableText size="$1" fontWeight="bold">
              {docMetadata?.name}
            </SizableText>
          </XStack>
          <Button
            $gtMd={{display: "none", opacity: 0, pointerEvents: "none"}}
            size="$2"
            chromeless
            bg="transparent"
            icon={Menu}
            onPress={() => {
              openSheet();
            }}
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
                {authors.map((a, index) => [
                  <SizableText
                    hoverStyle={{
                      cursor: "pointer",
                      textDecorationLine: "underline",
                    }}
                    fontWeight="bold"
                    size="$2"
                  >
                    {a.metadata.name}
                  </SizableText>,
                  index !== authors.length - 1 ? (
                    index === authors.length - 2 ? (
                      <SizableText key={`${a}-and`} size="$2" fontWeight="bold">
                        {" & "}
                      </SizableText>
                    ) : (
                      <SizableText
                        size="$2"
                        key={`${a}-comma`}
                        fontWeight="bold"
                      >
                        {", "}
                      </SizableText>
                    )
                  ) : null,
                ])}
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

function getHref(
  homeId: UnpackedHypermediaId | undefined,
  id: UnpackedHypermediaId
) {
  const path = `/${(id.path || []).join("/")}`;
  if (homeId && homeId.uid === id.uid) return path;
  return `/hm/${id.uid}${path}`;
}

function SearchUI({homeId}: {homeId: UnpackedHypermediaId | undefined}) {
  const popoverState = usePopoverState();
  const [searchValue, setSearchValue] = useState("");
  const searchResults = useSearch(searchValue);
  return (
    <Popover
      {...popoverState}
      onOpenChange={(open) => {
        popoverState.onOpenChange(open);
      }}
      placement="bottom-start"
    >
      <Popover.Trigger asChild>
        <Button
          size="$2"
          chromeless
          backgroundColor="transparent"
          icon={Search}
        />
      </Popover.Trigger>
      <Popover.Content asChild>
        <YStack
          gap="$2"
          padding="$2"
          position="relative"
          bottom={30}
          backgroundColor="$color4"
          borderRadius="$4"
        >
          <XStack gap="$2" alignItems="center">
            <Search size="$1" margin="$2" />
            <Input
              value={searchValue}
              size="$3"
              onChange={(e: NativeSyntheticEvent<TextInputChangeEventData>) => {
                setSearchValue(e.nativeEvent.target.value);
              }}
            />
          </XStack>
          {searchResults?.entities.map((entity) => {
            return (
              <Button
                backgroundColor="$colorTransparent"
                style={{textDecoration: "none"}}
                key={entity.id.id}
                onPress={() => {}}
                tag="a"
                href={getHref(homeId, entity.id)}
                justifyContent="flex-start"
              >
                {entity.title}
              </Button>
            );
          })}
        </YStack>
      </Popover.Content>
    </Popover>
  );
}

function useSearch(input: string) {
  const q = useFetcher();
  useEffect(() => {
    if (!input) return;
    q.load(`/hm/api/search?q=${input}`);
  }, [input]);
  if (!input) return {entities: [], searchQuery: ""} as SearchPayload;
  if (q.data) {
    return unwrap<SearchPayload>(q.data);
  }
  return null;
}

const VerticalSeparator = () => (
  <XStack flexShrink={0} flexGrow={0} w={1} h={20} bg="$color8" />
);

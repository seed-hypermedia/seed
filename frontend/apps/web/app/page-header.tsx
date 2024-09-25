import {useFetcher} from "@remix-run/react";
import {
  formattedDateMedium,
  getFileUrl,
  HMDocument,
  HMMetadata,
  relativeFormattedDate,
  UnpackedHypermediaId,
} from "@shm/shared";
import {getRandomColor} from "@shm/ui/src/avatar";
import {Container} from "@shm/ui/src/container";
import {Popover} from "@shm/ui/src/TamaguiPopover";
import {Thumbnail} from "@shm/ui/src/thumbnail";
import {usePopoverState} from "@shm/ui/src/use-popover-state";
import {Button} from "@tamagui/button";
import {Stack} from "@tamagui/core";
import {Input} from "@tamagui/input";
import {Menu, Search} from "@tamagui/lucide-icons";
import {Separator} from "@tamagui/separator";
import {XStack, YStack} from "@tamagui/stacks";
import {H1, SizableText} from "@tamagui/text";
import {useEffect, useMemo, useState} from "react";
import {
  NativeSyntheticEvent,
  ScrollView,
  TextInputChangeEventData,
} from "react-native";
import {getHref} from "./href";
import type {MetadataPayload} from "./loaders";
import {useDocumentChanges, useEntity} from "./models";
import {HMDocumentChangeInfo} from "./routes/hm.api.changes";
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
  openSheet?: () => void;
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
    <YStack paddingTop={86} $gtSm={{paddingTop: 44}}>
      <Stack
        flex={1}
        flexDirection="column"
        $gtSm={{flexDirection: "row"}}
        bg="$background"
        position="fixed"
        zi="$zIndex.7"
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
          <XStack alignItems="center">
            {homeId ? <SearchUI homeId={homeId} /> : null}
          </XStack>
        </XStack>
        <XStack
          ai="center"
          $gtSm={{f: 1}}
          paddingBlock="$2"
          paddingInline="$4"
          position="sticky"
          bg="$background"
          zi="$zIndex.7"
          top={0}
        >
          <XStack f={1}>
            <SizableText size="$1" fontWeight="bold">
              {docMetadata?.name}
            </SizableText>
          </XStack>
          {openSheet ? (
            <Button
              $gtMd={{display: "none", opacity: 0, pointerEvents: "none"}}
              size="$2"
              chromeless
              backgroundColor="transparent"
              icon={Menu}
              onPress={() => {
                openSheet();
              }}
            />
          ) : null}
        </XStack>
      </Stack>
      {hasCover ? (
        <XStack
          backgroundColor={coverBg}
          height="25vh"
          width="100%"
          position="relative"
        >
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
        backgroundColor="$background"
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
          <XStack
            marginTop="$4"
            gap="$3"
            alignItems="center"
            flex={1}
            flexWrap="wrap"
          >
            {authors?.length ? (
              <XStack
                alignItems="center"
                gap={0}
                flexWrap="wrap"
                maxWidth="100%"
              >
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
            {docId ? (
              <VersionsModal
                homeId={homeId}
                docId={docId}
                updateTime={updateTime}
              />
            ) : null}
          </XStack>
          <Separator />
        </YStack>
      </Container>
    </YStack>
  );
}

function VersionsModal({
  homeId,
  docId,
  updateTime,
}: {
  homeId: UnpackedHypermediaId | null;
  docId: UnpackedHypermediaId;
  updateTime: HMDocument["updateTime"] | null;
}) {
  const entity = useEntity(docId);
  const popoverState = usePopoverState();

  const changes = useDocumentChanges(docId);
  console.log(`===== ~ CHANGES DEMO:`, changes);
  return updateTime && !changes.isLoading ? (
    <Popover {...popoverState}>
      <Popover.Trigger>
        <SizableText
          flexShrink={0}
          flexGrow={0}
          size="$1"
          hoverStyle={{cursor: "default"}}
          color="$color9"
        >
          {formattedDateMedium(entity.data?.document?.updateTime)}
        </SizableText>
        {changes.data && changes.data.length > 1 ? (
          <SizableText
            size="$1"
            flexShrink={0}
            flexGrow={0}
            hoverStyle={{cursor: "default"}}
            color="$color9"
          >
            ({changes.data?.length}) versions
          </SizableText>
        ) : null}
      </Popover.Trigger>
      {changes.data && changes.data.length > 1 ? (
        <Popover.Content
          borderWidth={1}
          borderColor="$borderColor"
          enterStyle={{y: -10, opacity: 0}}
          exitStyle={{y: -10, opacity: 0}}
          elevation="$5"
          padding="$2"
          animation={[
            "fast",
            {
              opacity: {
                overshootClamping: true,
              },
            },
          ]}
        >
          <Popover.Arrow borderWidth={1} borderColor="$borderColor" />
          <YStack overflow="hidden" maxHeight={220}>
            <ScrollView>
              {changes?.data?.map((change) => {
                let href = homeId
                  ? getHref(homeId, docId, change.id)
                  : undefined;

                console.log(`== ~ {changes?.data?.map ~ href:`, href);
                return (
                  <ModalVersionItem
                    href={href}
                    key={change.id}
                    change={change}
                  />
                );
              })}
            </ScrollView>
          </YStack>
        </Popover.Content>
      ) : null}
    </Popover>
  ) : null;

  /**
   * <Tooltip
      content={`Update time: ${formattedDateLong(
        entity.data?.document?.updateTime,
      )}`}
    >
      <SizableText
        flexShrink={0}
        flexGrow={0}
        size="$1"
        hoverStyle={{cursor: 'default'}}
        color="$color9"
      >
        {formattedDateMedium(entity.data?.document?.updateTime)}
      </SizableText>
    </Tooltip>
   */
}

function ModalVersionItem({
  change,
  href,
}: {
  change: HMDocumentChangeInfo;
  href?: string;
}) {
  return (
    <Button
      tag="a"
      role="link"
      key={change.id}
      height="auto"
      padding="$2"
      href={href}
      onPress={() => {
        console.log(`== ~ {ModalVersionItem ~ href:`, href);
      }}
      borderRadius="$2"
      borderWidth={0}
      backgroundColor={"$backgroundTransparent"}
      hoverStyle={{
        backgroundColor: "$brand12",
        borderColor: "$borderTransparent",
      }}
      alignItems="flex-start"
      position="relative"
      overflow="hidden"
      maxWidth={260}
      style={{textDecoration: "none"}}
      icon={
        <Thumbnail
          flexGrow={0}
          flexShrink={0}
          size={20}
          id={change.author.id}
          metadata={change.author.metadata}
        />
      }
    >
      <SizableText
        size="$2"
        flex={1}
        flexShrink={1}
        textOverflow="ellipsis"
        overflow="hidden"
        whiteSpace="nowrap"
      >
        {change.author.metadata.name}
      </SizableText>
      <SizableText size="$2" whiteSpace="nowrap" flexShrink={0}>
        {relativeFormattedDate(change.createTime)}
      </SizableText>
    </Button>
  );
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
          {searchResults?.entities.map((entity: any) => {
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
  <XStack flexShrink={0} flexGrow={0} width={1} height={20} bg="$color8" />
);

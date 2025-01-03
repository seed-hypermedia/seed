import {useFetcher} from "@remix-run/react";
import {UnpackedHypermediaId} from "@shm/shared";
import {Search} from "@shm/ui";
import {Popover} from "@shm/ui/src/TamaguiPopover";
import {usePopoverState} from "@shm/ui/src/use-popover-state";
import {Button} from "@tamagui/button";
import {Input} from "@tamagui/input";
import {XStack, YStack} from "@tamagui/stacks";
import {useEffect, useState} from "react";
import {NativeSyntheticEvent, TextInputChangeEventData} from "react-native";
import {getHref} from "./href";
import {SearchPayload} from "./routes/hm.api.search";
import {unwrap} from "./wrapping";

export function MobileSearchUI({
  homeId,
}: {
  homeId: UnpackedHypermediaId | undefined;
}) {
  const [searchValue, setSearchValue] = useState("");
  const searchResults = useSearch(searchValue);
  return (
    <YStack
      gap="$2"
      padding="$2"
      position="relative"
      borderRadius="$4"
      flex={1}
    >
      <Input
        value={searchValue}
        size="$3"
        flex={1}
        onChange={(e: NativeSyntheticEvent<TextInputChangeEventData>) => {
          setSearchValue(e.nativeEvent.target.value);
        }}
        placeholder="Search Documents"
      />
      {searchResults?.entities.length ? (
        <YStack
          position="absolute"
          backgroundColor="$background"
          top="100%"
          width="calc(100% - 16px)"
          zIndex="$zIndex.7"
          padding="$2"
          borderRadius="$4"
          borderColor="$borderColor"
          borderWidth={1}
          elevation="$4"
        >
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
                hoverStyle={{
                  backgroundColor: "$backgroundHover",
                  borderColor: "transparent",
                }}
              >
                {entity.title}
              </Button>
            );
          })}
        </YStack>
      ) : null}
    </YStack>
  );
}

export function SearchUI({homeId}: {homeId: UnpackedHypermediaId | undefined}) {
  const popoverState = usePopoverState();
  const [searchValue, setSearchValue] = useState("");
  const searchResults = useSearch(searchValue);
  return (
    <XStack display="none" $gtSm={{display: "flex"}}>
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
                onChange={(
                  e: NativeSyntheticEvent<TextInputChangeEventData>
                ) => {
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
    </XStack>
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

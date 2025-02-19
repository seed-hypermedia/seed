import {UnpackedHypermediaId, useRouteLink, useSearch} from "@shm/shared";
import {Popover} from "@shm/ui/src/TamaguiPopover";
import {usePopoverState} from "@shm/ui/src/use-popover-state";
import {Button} from "@tamagui/button";
import {Input} from "@tamagui/input";
import {Search} from "@tamagui/lucide-icons";
import {XStack, YStack} from "@tamagui/stacks";
import {useState} from "react";
import {NativeSyntheticEvent, TextInputChangeEventData} from "react-native";

export function MobileSearch({
  originHomeId,
}: {
  originHomeId: UnpackedHypermediaId | null;
}) {
  const [searchValue, setSearchValue] = useState("");
  const searchResults = useSearch(searchValue, {enabled: !!searchValue});
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
      {searchResults.data?.entities.length ? (
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
          {searchResults.data?.entities.map((entity: any) => {
            return (
              <SearchResultItem
                key={entity.id.id}
                entity={entity}
                originHomeId={originHomeId}
              />
            );
          })}
        </YStack>
      ) : null}
    </YStack>
  );
}

export function HeaderSearch({
  originHomeId,
}: {
  originHomeId: UnpackedHypermediaId | null;
}) {
  const popoverState = usePopoverState();
  const [searchValue, setSearchValue] = useState("");
  const searchResults = useSearch(searchValue, {enabled: !!searchValue});
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
            {searchResults.data?.entities.map(
              (entity: {id: UnpackedHypermediaId; title: string}) => {
                return (
                  <SearchResultItem
                    key={entity.id.id}
                    entity={entity}
                    originHomeId={originHomeId}
                  />
                );
              }
            )}
          </YStack>
        </Popover.Content>
      </Popover>
    </XStack>
  );
}

function SearchResultItem({
  entity,
  originHomeId,
}: {
  entity: {id: UnpackedHypermediaId; title: string};
  originHomeId: UnpackedHypermediaId | null;
}) {
  const linkProps = useRouteLink(
    {
      key: "document",
      id: entity.id,
    },
    originHomeId
  );
  return (
    <Button
      backgroundColor="$colorTransparent"
      {...linkProps}
      justifyContent="flex-start"
    >
      {entity.title}
    </Button>
  );
}

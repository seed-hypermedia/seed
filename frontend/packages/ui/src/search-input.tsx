import {SearchResult} from "@shm/shared";
import {XStack, YStack} from "@tamagui/stacks";
import {SizableText} from "@tamagui/text";
import {PropsWithChildren, useLayoutEffect, useRef} from "react";
import {Button, Input, InputProps, ScrollView} from "tamagui";
import {UIAvatar} from "./avatar";
import {Search} from "./icons";

export function SearchInput({
  children,
  inputProps,
  onArrowDown,
  onArrowUp,
  onEscape,
  onEnter,
}: PropsWithChildren<{
  searchResults: Array<SearchResult>;
  inputProps: {
    value: InputProps["value"];
    onChangeText: InputProps["onChangeText"];
    disabled: boolean;
  };
  onEscape: () => void;
  onArrowUp: () => void;
  onArrowDown: () => void;
  onEnter: () => void;
  focusedIndex: number;
}>) {
  return (
    <YStack gap="$2" w="100%">
      <XStack
        ai="center"
        gap="$2"
        borderWidth={1}
        borderColor="$color5"
        borderRadius="$2"
        paddingHorizontal="$2"
        animation="fast"
      >
        <Search size={16} />
        <Input
          size="$3"
          unstyled
          placeholder="Search Hypermedia documents"
          borderWidth={0}
          // @ts-ignore
          outline="none"
          w="100%"
          autoFocus
          paddingHorizontal="$1"
          {...inputProps}
          onKeyPress={(e: any) => {
            if (e.nativeEvent.key === "Escape") {
              e.preventDefault();
              onEscape();
            }

            if (e.nativeEvent.key === "Enter") {
              e.preventDefault();
              onEnter();
            }

            if (e.nativeEvent.key === "ArrowUp") {
              e.preventDefault();
              onArrowUp();
            }

            if (e.nativeEvent.key === "ArrowDown") {
              e.preventDefault();
              onArrowDown();
            }
          }}
        />
      </XStack>

      <YStack
        height={200}
        maxHeight={600}
        overflow="hidden"
        // position="absolute"
        // top={52}
        // left={0}
        // right={0}
        // paddingHorizontal="$2"
        // zi="$zIndex.8"
      >
        <ScrollView>{children}</ScrollView>
      </YStack>
    </YStack>
  );
}

export function SearchResultItem({
  item,
  selected = false,
}: {
  item: SearchResult;
  selected: boolean;
}) {
  const elm = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (selected) {
      elm.current?.scrollIntoView({block: "nearest"});
    }
  }, [selected]);

  return (
    <Button
      ref={elm}
      key={item.key}
      onPress={() => {
        item.onSelect();
      }}
      backgroundColor={selected ? "$brand12" : "$backgroundTransparent"}
      hoverStyle={{
        backgroundColor: selected ? "$brand12" : undefined,
      }}
      onFocus={item.onFocus}
      onMouseEnter={item.onMouseEnter}
      gap="$4"
    >
      {item.icon ? (
        <UIAvatar label={item.title} size={20} url={item.icon} />
      ) : null}
      <XStack f={1} justifyContent="space-between">
        <SizableText numberOfLines={1}>{item.title}</SizableText>
        <SizableText color="$color10">{item.subtitle}</SizableText>
      </XStack>
    </Button>
  );
}

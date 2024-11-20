import {XStack, XStackProps, YStack} from "@tamagui/stacks";
import "katex/dist/katex.min.css";
import {Button, ColorTokens, View, ViewProps} from "tamagui";
import "./document-content.css";

export function QueryBlockPlaceholder({
  styleType,
}: {
  styleType: "Card" | "List";
}) {
  if (styleType === "Card") {
    return <QueryBlockCardPlaceholder />;
  }

  return <QueryBlockListPlaceholder />;
}

export function QueryBlockCardPlaceholder() {
  return (
    <XStack flexWrap="wrap" marginHorizontal="$-2">
      <EntityCardPlaceholder />
      <EntityCardPlaceholder />
      <EntityCardPlaceholder />
    </XStack>
  );
}

export function QueryBlockListPlaceholder() {
  return (
    <YStack gap="$2">
      <ListItemSkeleton />
      <ListItemSkeleton />
      <ListItemSkeleton />
    </YStack>
  );
}

export function EntityCardPlaceholder() {
  return (
    <YStack
      flexGrow={0}
      flexShrink={0}
      flexBasis="100%"
      $gtSm={{flexBasis: "33.33%"}}
      p="$2"
    >
      <YStack
        f={1}
        bg="$backgroundStrong"
        borderColor="$borderColor"
        borderWidth={1}
        borderRadius="$4"
        overflow="hidden"
      >
        <CoverPlaceholder />
        <YStack f={1}>
          <YStack gap="$4" p="$4">
            {/* document name */}
            <YStack gap="$2">
              <TextPlaceholder height={24} />
              <TextPlaceholder height={24} width="70%" />
            </YStack>

            {/* location and author */}
            <TextPlaceholder height={14} width="35%" />

            <YStack gap="$2">
              <TextPlaceholder height={12} />
              <TextPlaceholder height={12} width="75%" />
              <TextPlaceholder height={12} width="80%" />
              <TextPlaceholder height={12} width="60%" />
            </YStack>
          </YStack>
        </YStack>
      </YStack>
    </YStack>
  );
}

function CoverPlaceholder() {
  return <XStack height={180} width="100%" bg="$color6" />;
}

function TextPlaceholder({
  height = 16,
  width = "100%",
  color = "$color6",
}: {
  height?: XStackProps["height"];
  width?: XStackProps["width"];
  color?: ColorTokens;
}) {
  return (
    <XStack
      height={height}
      width={width}
      bg={color}
      borderRadius={100}
      overflow="hidden"
    />
  );
}

export function ListItemSkeleton() {
  return (
    <Button
      borderWidth={1}
      borderColor="$borderColor"
      paddingHorizontal={16}
      paddingVertical="$1"
      bg="$backgroundHover"
      h={60}
      disabled
      gap="$2"
    >
      <Skeleton width={28} height={28} borderRadius={28} />

      <YStack f={1} gap="$2">
        <XStack ai="center" gap="$2">
          <Skeleton w="100%" maxWidth={300} height={20} borderRadius="$1" />
        </XStack>
        <XStack gap="$2" w="100%" overflow="hidden">
          <Skeleton w="100%" maxWidth={200} height={14} borderRadius="$1" />
        </XStack>
      </YStack>
      <Skeleton w="100%" maxWidth={80} height={20} borderRadius="$1" />

      <XStack>
        <Skeleton width={24} height={24} borderRadius={100} />
        <Skeleton width={24} height={24} borderRadius={100} marginLeft={-8} />
      </XStack>
    </Button>
  );
}

function Skeleton(props: ViewProps) {
  return <View {...props} bg="$color6" />;
}

import {XStack, XStackProps, YStack} from "@tamagui/stacks";
import "katex/dist/katex.min.css";
import {ColorTokens} from "tamagui";
import "./document-content.css";

export function BlockContentQueryPlaceholder() {
  return (
    <XStack flexWrap="wrap" marginHorizontal="$-2">
      <EntityCardPlaceholder />
      <EntityCardPlaceholder />
      <EntityCardPlaceholder />
      <EntityCardPlaceholder />
    </XStack>
  );
}

export function EntityCardPlaceholder() {
  return (
    <YStack
      flexGrow={0}
      flexShrink={0}
      flexBasis="100%"
      $gtSm={{flexBasis: "50%"}}
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

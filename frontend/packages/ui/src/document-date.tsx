import {
  formattedDateDayOnly,
  formattedDateLong,
  formattedDateMedium,
  HMDocument,
} from "@shm/shared";
import {SizableText} from "@tamagui/text";
import {YStack} from "tamagui";
import {HoverCard} from "./hover-card";

export function DocumentDate({document}: {document: HMDocument}) {
  const displayText = document.metadata?.displayPublishTime
    ? formattedDateDayOnly(new Date(document.metadata.displayPublishTime))
    : formattedDateMedium(document?.updateTime);
  const content: React.ReactNode[] = [
    <SizableText size="$3">
      Last Update: {formattedDateLong(document?.updateTime)}
    </SizableText>,
    // // Disabled because this is always 1969 because the backend looks at the deterministic genesis blob instead of the actual creation time
    // <SizableText size="$2">
    //   First published: {formattedDateLong(document?.createTime)}
    // </SizableText>,
  ];
  if (document.metadata?.displayPublishTime) {
    content.unshift(
      <SizableText color="$blue10" size="$3">
        Original Publish date: {displayText}
      </SizableText>
    );
  }
  return (
    <HoverCard
      content={
        <YStack gap="$4" padding="$4">
          {content}
        </YStack>
      }
    >
      <SizableText
        flexShrink={0}
        flexGrow={0}
        size="$1"
        hoverStyle={{cursor: "default"}}
        color={document.metadata?.displayPublishTime ? "$blue10" : "$color9"}
      >
        {displayText}
      </SizableText>
    </HoverCard>
  );
}

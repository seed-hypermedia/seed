import {
  formattedDateDayOnly,
  formattedDateLong,
  formattedDateMedium,
  HMDocument,
} from "@shm/shared";
import {SizableText} from "@tamagui/text";
import {Popover} from "./TamaguiPopover";
import {dialogBoxShadow} from "./universal-dialog";

export function DocumentDate({document}: {document: HMDocument}) {
  const displayText = document.metadata?.displayPublishTime
    ? formattedDateDayOnly(new Date(document.metadata.displayPublishTime)) +
      "lol"
    : formattedDateMedium(document?.updateTime);
  const content: React.ReactNode[] = [
    <SizableText size="$2">
      Last update time: {formattedDateLong(document?.updateTime)}
    </SizableText>,
    <SizableText size="$2">
      First published: {formattedDateLong(document?.createTime)}
    </SizableText>,
  ];
  if (document.metadata?.displayPublishTime) {
    content.unshift(
      <SizableText color="$blue10" size="$2">
        Original publish date:{" "}
        {formattedDateMedium(new Date(document.metadata.displayPublishTime))}
      </SizableText>
    );
  }
  return (
    <HoverCard content={content}>
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

export function HoverCard({
  children,
  content,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
}) {
  return (
    <Popover hoverable placement="bottom-start">
      <Popover.Trigger className="no-window-drag">{children}</Popover.Trigger>
      <Popover.Content
        boxShadow={dialogBoxShadow}
        gap="$2"
        padding="$2"
        ai="flex-start"
      >
        {content}
      </Popover.Content>
    </Popover>
  );
}

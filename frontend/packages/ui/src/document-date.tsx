import {formattedDateLong, formattedDateMedium, HMDocument} from "@shm/shared";
import {SizableText} from "@tamagui/text";
import {Popover} from "./TamaguiPopover";

export function DocumentDate({document}: {document: HMDocument}) {
  const displayText = document.metadata?.originalPublishTime
    ? formattedDateMedium(new Date(document.metadata.originalPublishTime))
    : formattedDateMedium(document?.updateTime);
  const content: React.ReactNode[] = [
    <SizableText>
      Last update time: {formattedDateLong(document?.updateTime)}
    </SizableText>,
  ];
  if (document.metadata?.originalPublishTime) {
    content.unshift(
      <SizableText color="$blue10">
        Original publish date:{" "}
        {formattedDateMedium(new Date(document.metadata.originalPublishTime))}
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
        color={document.metadata?.originalPublishTime ? "$blue10" : "$color9"}
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
    <Popover hoverable>
      <Popover.Trigger className="no-window-drag">{children}</Popover.Trigger>
      <Popover.Content>{content}</Popover.Content>
    </Popover>
  );
}

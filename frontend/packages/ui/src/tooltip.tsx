import {Text, Theme} from "@tamagui/core";
import React from "react";
import {Tooltip as TTooltip, TooltipProps} from "./TamaguiTooltip";

export function Tooltip({
  children,
  content,
  placement,
  delay = 100,
  open,
}: {
  children: React.ReactNode;
  content: string | React.ReactElement;
  placement?: TooltipProps["placement"];
  delay?: number;
  open?: boolean;
}) {
  return content ? (
    <TTooltip placement={placement} delay={delay} open={open}>
      <TTooltip.Trigger asChild>{children}</TTooltip.Trigger>

      <Theme inverse>
        <TTooltip.Content
          maxWidth="350px"
          enterStyle={{x: 0, y: -5, opacity: 0, scale: 0.9}}
          exitStyle={{x: 0, y: -5, opacity: 0, scale: 0.9}}
          scale={1}
          x={0}
          y={0}
          opacity={1}
          paddingVertical="$1"
          paddingHorizontal="$2"
          animation={[
            "fast",
            {
              opacity: {
                overshootClamping: true,
              },
            },
          ]}
        >
          <TTooltip.Arrow />
          <Text
            fontSize="$1"
            fontFamily="$body"
            margin={0}
            padding={0}
            lineHeight="$1"
          >
            {content}
          </Text>
        </TTooltip.Content>
      </Theme>
    </TTooltip>
  ) : (
    children
  );
}

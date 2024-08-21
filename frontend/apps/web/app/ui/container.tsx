import {styled} from "@tamagui/core";
import {YStack} from "@tamagui/stacks";

const variants = {
  hide: {
    true: {
      pointerEvents: "none",
      opacity: 0,
    },
  },
  clearVerticalSpace: {
    true: {
      paddingVertical: 0,
    },
  },
} as const;

export const Container = styled(YStack, {
  marginHorizontal: "auto",
  paddingHorizontal: "$4",
  paddingTop: "$6",
  width: "100%",
  maxWidth: "80ch",
  flexShrink: "unset",
  variants,
});

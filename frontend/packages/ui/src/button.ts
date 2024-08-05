import {styled, Button as TButton, ThemeableStack} from "tamagui";

export const Button = styled(TButton, {
  bg: "$color4",
  borderWidth: 2,
});

export const AccountTypeButton = styled(ThemeableStack, {
  tag: "button",
  role: "button",
  focusable: true,
  p: "$4",
  paddingBottom: "$2",
  w: 150,
  h: 150,
  borderRadius: "$2",
  gap: "$2",
  bg: "$color4",
  hoverStyle: {
    bg: "$color6",
  },
});

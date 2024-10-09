import {styled, Button as TButton, ThemeableStack} from "tamagui";

export const Button = styled(TButton, {
  className: "btn",
  // bg: "$color4",
  borderWidth: 2,
  // bg: "$color4",
  // borderColor: "$color5",
  // hoverStyle: {
  //   bg: "$color5",
  //   borderColor: "$color6",
  //   elevation: 0,
  // },
  disabledStyle: {
    opacity: 0.5,
    borderWidth: 2,
    borderColor: "$colorTransparent",
    elevation: 0,
  },

  focusStyle: {
    borderColor: "$color8",
    borderWidth: 2,
    elevation: 0,
  },
  hoverStyle: {
    cursor: "default",
  },
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

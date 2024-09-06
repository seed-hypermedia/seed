export {
  blue,
  blueDark,
  gray,
  grayDark,
  green,
  greenDark,
  orange,
  orangeDark,
  pink,
  pinkDark,
  purple,
  purpleDark,
  red,
  redDark,
  yellow,
  yellowDark,
} from "@tamagui/themes";

export const lightTransparent = "rgba(255,255,255,0)";
export const darkTransparent = "rgba(10,10,10,0)";

export const brand = {
  brand1: "hsl(180, 29%, 17%)",
  brand2: "hsl(180, 36%, 22%)",
  brand3: "hsl(166, 30%, 29%)",
  brand4: "hsl(166, 55%, 31%)",
  brand5: "hsl(171, 96%, 28%)",
  brand6: "hsl(148, 44%, 47%)",
  brand7: "hsl(144, 55%, 57%)",
  brand8: "hsl(144, 73%, 68%)",
  brand9: "hsl(133, 54%, 78%)",
  brand10: "hsl(133, 63%, 83%)",
  brand11: "hsl(122, 53%, 88%)", // PLEASE manually sync with editor.css .seed-app-dark .ProseMirror .hm-link
  brand12: "hsl(123, 50%, 93%)",
  brandHighlight: "hsl(125, 50%, 96%)",
};

export const brandDark = {
  brand1: brand.brand12,
  brand2: brand.brand11,
  brand3: "hsl(125, 100%, 98%)",
  brand4: "hsl(166, 55%, 31%)",
  brand5: "hsl(171, 96%, 28%)",
  brand6: "hsl(148, 44%, 47%)",
  brand7: "hsl(144, 55%, 57%)",
  brand8: "hsl(144, 73%, 68%)",
  brand9: "hsl(133, 54%, 78%)",
  brand10: "hsl(166, 30%, 29%)",
  brand11: brand.brand2,
  brand12: brand.brand1,
  brandHighlight: "hsl(180, 41%, 8%)",
};

export const lightColor = "hsl(0, 0%, 9.0%)";
export const lightPalette = [
  lightTransparent,
  "#fff",
  "#f9f9f9",
  "hsl(0, 0%, 97.3%)",
  "hsl(0, 0%, 95.1%)",
  "hsl(0, 0%, 94.0%)",
  "hsl(0, 0%, 92.0%)",
  "hsl(0, 0%, 89.5%)",
  "hsl(0, 0%, 81.0%)",
  "hsl(0, 0%, 56.1%)",
  "hsl(0, 0%, 50.3%)",
  "hsl(0, 0%, 42.5%)",
  lightColor,
  darkTransparent,
];

export const darkColor = "#fff";
export const darkPalette = [
  darkTransparent,
  "#050505",
  "#151515",
  "#191919",
  "#232323",
  "#282828",
  "#323232",
  "#424242",
  "#494949",
  "#545454",
  "#626262",
  "#a5a5a5",
  darkColor,
  lightTransparent,
];

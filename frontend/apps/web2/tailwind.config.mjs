/** @type {import('tailwindcss').Config} */
import typography from "@tailwindcss/typography";

export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      padding: {
        "9/16": "56.25%", // 16:9 aspect ratio
        "3/4": "75%", // 4:3 aspect ratio
      },
    },
  },
  plugins: [
    typography(),
    function ({addComponents}) {
      addComponents({
        ".prose-video": {
          width: "100%",
          marginTop: "1.5em",
          marginBottom: "1.5em",
          borderRadius: "0.25rem",
          overflow: "hidden",
          position: "relative",
          paddingBottom: "56.25%",
          height: 0,
        },
      });
    },
  ],
};

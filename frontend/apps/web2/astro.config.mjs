import node from "@astrojs/node";
import tailwind from "@astrojs/tailwind";
import {defineConfig} from "astro/config";

import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [tailwind(), react()],
  adapter: node({
    mode: "standalone",
  }),
  vite: {
    ssr: {
      noExternal: ["path-to-regexp"],
    },
  },
});

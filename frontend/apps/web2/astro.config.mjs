import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import node from "@astrojs/node";

import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [tailwind(), react()],
  adapter: node({
    mode: "standalone"
  })
});
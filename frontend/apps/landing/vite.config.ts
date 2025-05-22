import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import {defineConfig} from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  publicDir: "public",
  build: {
    assetsDir: "landing-assets",
    rollupOptions: {
      output: {
        entryFileNames: "landing-assets/[name].[hash].js",
        chunkFileNames: "landing-assets/[name].[hash].js",
        assetFileNames: "landing-assets/[name].[hash][extname]",
      },
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },
});

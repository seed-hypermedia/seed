import react from "@vitejs/plugin-react";
import {resolve} from "path";
import {defineConfig} from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "./", // Use relative paths
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
    },
    // Ensure large performance data files are included
    assetsInlineLimit: 0, // Don't inline any assets as base64
    copyPublicDir: true, // Explicitly enable copying public dir (default is true)
  },
  publicDir: "public", // Explicitly set public directory (default is 'public')
  server: {
    open: true,
  },
});

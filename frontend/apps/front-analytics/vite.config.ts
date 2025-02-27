import react from "@vitejs/plugin-react";
import {defineConfig} from "vite";
import {setupMetricsMiddleware} from "./src/server/metricsMiddleware";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "metrics-middleware",
      configureServer(server) {
        setupMetricsMiddleware(server.middlewares);
      },
    },
  ],
});

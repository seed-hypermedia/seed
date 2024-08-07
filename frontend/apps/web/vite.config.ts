import {vitePlugin as remix} from "@remix-run/dev";
import {tamaguiPlugin} from "@tamagui/vite-plugin";
import {defineConfig} from "vite";
import commonjs from "vite-plugin-commonjs";
import tsconfigPaths from "vite-tsconfig-paths";

const extensions = [
  ".web.tsx",
  ".tsx",
  ".web.ts",
  ".ts",
  ".web.jsx",
  ".jsx",
  ".web.js",
  ".js",
  ".css",
  ".json",
  ".mjs",
];
export default defineConfig({
  resolve: {
    // Some libs that can run in both Web and Node.js, such as `axios`, we need to tell Vite to build them in Node.js.
    // browserField: false,
    mainFields: ["module", "jsnext:main", "jsnext"],
    extensions,
  },
  plugins: [
    tamaguiPlugin({
      components: ["@shm/ui", "tamagui"],
      config: "./tamagui.config.ts",
      themeBuilder: {
        input: "../../packages/ui/src/themes/theme.ts",
        output: "../../packages/ui/src/themes-generated.ts",
      },
    }) as any,
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
      },
    }),
    tsconfigPaths(),
    commonjs({
      filter(id) {
        if (id.includes("node_modules/@react-native/normalize-color")) {
          return true;
        }
      },
    }),
    // {
    //   name: "log-files",
    //   transform(code, id) {
    //     console.log("Processing file:", id);
    //     return code;
    //   },
    // },
  ],
  optimizeDeps: {
    esbuildOptions: {
      resolveExtensions: extensions,
    },
  },
  build: {
    target: "esnext",
  },
});

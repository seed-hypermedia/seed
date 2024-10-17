import {vitePlugin as remix} from "@remix-run/dev";
import {installGlobals} from "@remix-run/node";
import {tamaguiExtractPlugin, tamaguiPlugin} from "@tamagui/vite-plugin";
import {defineConfig} from "vite";
import commonjs from "vite-plugin-commonjs";
import tsconfigPaths from "vite-tsconfig-paths";

installGlobals();

// console.log(`== ~ process.env.NODE_ENV:`, process.env.NODE_ENV);
let config = {
  server: {
    port: 3000,
  },
  clearScreen: false,
  // css: {
  //   preprocessorOptions: {
  //     css: {
  //       // Include node_modules as part of the CSS processing
  //       includePaths: ["./node_modules", "../../../node_modules"],
  //     },
  //   },
  // },
  // ssr: {
  //   noExternal: ["react-tweet"],
  // },
  build: {minify: false, sourcemap: true},
  ssr: {
    noExternal: ["@tamagui/helpers-icon"],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"), // Force React to development mode
  },
  optimizeDeps: {
    exclude:
      process.env.NODE_ENV === "production"
        ? []
        : ["expo-linear-gradient", "@tamagui/*", "tamagui"],
  },
  plugins: [
    tamaguiPlugin({config: "./tamagui.config.ts"}) as any,
    process.env.NODE_ENV === "production"
      ? tamaguiExtractPlugin({
          config: "./tamagui.config.ts",
        })
      : null,
    // tamaguiExtractPlugin({
    //   logTimings: true,
    // }),
    remix(),
    tsconfigPaths(),
    commonjs({
      filter(id) {
        if (id.includes("node_modules/@react-native/normalize-color")) {
          return true;
        }
      },
    }),
    // analyzer({
    //   analyzerMode: "static",
    //   fileName: "report",
    // }),
    // {
    //   name: "log-files",
    //   transform(code, id) {
    //     console.log("--- Processing file:", id);
    //     return code;
    //   },
    // },
  ].filter(Boolean),
};
// console.log("VITE CONFIG", JSON.stringify(config, null, 4));
export default defineConfig(config);

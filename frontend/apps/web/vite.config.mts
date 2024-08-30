import {vitePlugin as remix} from "@remix-run/dev";
import {installGlobals} from "@remix-run/node";
import {tamaguiExtractPlugin, tamaguiPlugin} from "@tamagui/vite-plugin";
import {defineConfig} from "vite";
import commonjs from "vite-plugin-commonjs";
import tsconfigPaths from "vite-tsconfig-paths";

installGlobals();

export default defineConfig({
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
  ssr: {
    noExternal: ["@tamagui/helpers-icon"],
  },
  optimizeDeps: {
    exclude: process.env.NODE_ENV === "production" ? [] : ["*"],
  },
  plugins: [
    tamaguiPlugin({config: "./tamagui.config.ts"}) as any,
    process.env.NODE_ENV === "production"
      ? tamaguiExtractPlugin({
          config: "./tamagui.config.ts",
          excludeReactNativeWebExports: ["Sheet", "Switch"],
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
  ].filter(Boolean),
});

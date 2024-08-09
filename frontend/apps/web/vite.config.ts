import {vitePlugin as remix} from "@remix-run/dev";
import {installGlobals} from "@remix-run/node";
import {tamaguiExtractPlugin, tamaguiPlugin} from "@tamagui/vite-plugin";
import {defineConfig} from "vite";
import {analyzer} from "vite-bundle-analyzer";
import commonjs from "vite-plugin-commonjs";
import tsconfigPaths from "vite-tsconfig-paths";

installGlobals();

export default defineConfig({
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
  plugins: [
    tamaguiPlugin() as any,
    tamaguiExtractPlugin({
      logTimings: true,
    }),
    remix(),
    tsconfigPaths(),
    commonjs({
      filter(id) {
        if (id.includes("node_modules/@react-native/normalize-color")) {
          return true;
        }
      },
    }),
    analyzer({
      analyzerMode: "static",
      fileName: "report",
    }),
  ],
});

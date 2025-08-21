import {vitePlugin as remix} from '@remix-run/dev'
import {installGlobals} from '@remix-run/node'
import tailwindcss from '@tailwindcss/vite'

import path from 'path'
import {defineConfig} from 'vite'
import commonjs from 'vite-plugin-commonjs'
import tsconfigPaths from 'vite-tsconfig-paths'

installGlobals()

// console.log(`== ~ process.env.NODE_ENV:`, process.env.NODE_ENV);
let config = {
  server: {
    port: 3000,
    build: {
      minify: false,
      sourcemap: true,
    },
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
    noExternal: ['react-icons'],
  },
  // DISABLED FOR NOW, suspected to be overwrtiting the runtime env vars
  // define: {
  //   // Define process.env as an empty object to prevent "process is not defined" errors
  //   // Vite will replace individual process.env.VARIABLE_NAME references at build time
  //   'process.env': {
  //     NODE_ENV: process.env.NODE_ENV || 'development',
  //     SEED_SIGNING_ENABLED: process.env.SEED_SIGNING_ENABLED,
  //     SEED_BASE_URL: process.env.SEED_BASE_URL,
  //   },
  // },
  optimizeDeps: {
    exclude:
      process.env.NODE_ENV === 'production'
        ? []
        : ['expo-linear-gradient', 'react-icons', '@shm/editor'],
  },
  plugins: [
    remix(),
    tsconfigPaths(),
    commonjs({
      filter(id) {
        if (id.includes('node_modules/@react-native/normalize-color')) {
          return true
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
    tailwindcss(),
  ].filter(Boolean),
  resolve: {
    dedupe: [
      '@shm/shared',
      '@shm/shared/*',
      '@shm/editor',
      '@shm/editor/*',
      '@shm/ui',
      '@shm/ui/*',
      'react',
      'react-dom',
    ],
    alias: {
      '@shm/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@shm/editor': path.resolve(__dirname, '../../packages/editor/src'),
      '@shm/ui': path.resolve(__dirname, '../../packages/ui/src'),
    },
  },
}
// console.log("VITE CONFIG", JSON.stringify(config, null, 4));
export default defineConfig(config)

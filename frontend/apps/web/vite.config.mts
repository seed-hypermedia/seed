import {vitePlugin as remix} from '@remix-run/dev'
// @ts-ignore
import tailwindcss from '@tailwindcss/vite'

import * as path from 'path'
import {defineConfig} from 'vite'
import commonjs from 'vite-plugin-commonjs'
import tsconfigPaths from 'vite-tsconfig-paths'

// @ts-ignore
import {envOnlyMacros} from 'vite-env-only'

export default defineConfig(({isSsrBuild}) => {
  return {
    server: {
      port: 3000,
      allowedHosts: ['localhost', '127.0.0.1', 'macbook-pro.tail46484.ts.net'],
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
      noExternal: ['react-icons', '@shm/editor'],
    },
    define: isSsrBuild
      ? {}
      : {
          'process.env': {
            NODE_ENV: process.env.NODE_ENV,
            NODE_DEBUG: process.env.NODE_DEBUG,
            SEED_ENABLE_STATISTICS: process.env.SEED_ENABLE_STATISTICS,
            SITE_SENTRY_DSN: process.env.SITE_SENTRY_DSN,
          },
        },
    optimizeDeps: {
      exclude:
        process.env.NODE_ENV === 'production'
          ? []
          : [
              'expo-linear-gradient',
              'react-icons',
              '@shm/editor',
              '@shm/shared',
              '@remix-run/react',
            ],
    },
    plugins: [
      remix(),
      envOnlyMacros(),
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
})

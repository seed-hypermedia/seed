import {vitePlugin as remix} from '@remix-run/dev'
// @ts-ignore
import {sentryVitePlugin} from '@sentry/vite-plugin'
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
      cors: false,
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
      // Bundle all workspace packages and common dependencies for proper SSR with pnpm
      noExternal: [
        'react-icons',
        '@shm/editor',
        '@shm/shared',
        '@shm/ui',
        '@yudiel/react-qr-scanner',
        // Match all @radix-ui packages
        /^@radix-ui\//,
        // Other packages that may have ESM/SSR issues
        'sonner',
        'class-variance-authority',
        'clsx',
        'tailwind-merge',
        'lucide-react',
        'vaul',
      ],
    },
    define: isSsrBuild
      ? {}
      : {
          // Define individual keys instead of replacing the entire `process.env` object.
          // Replacing the whole object breaks SSR modules in dev mode that read env vars
          // not listed here (e.g. SEED_IDENTITY_DEFAULT_ORIGIN) via process.env at runtime.
          'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
          'process.env.NODE_DEBUG': JSON.stringify(process.env.NODE_DEBUG),
          'process.env.SEED_ENABLE_STATISTICS': JSON.stringify(process.env.SEED_ENABLE_STATISTICS),
          'process.env.SITE_SENTRY_DSN': JSON.stringify(process.env.SITE_SENTRY_DSN),
        },
    optimizeDeps: {
      exclude:
        process.env.NODE_ENV === 'production'
          ? []
          : ['expo-linear-gradient', 'react-icons', '@shm/editor', '@shm/shared', '@remix-run/react'],
    },
    plugins: [
      remix({
        future: {
          v3_fetcherPersist: true,
          v3_relativeSplatPath: true,
          v3_throwAbortReason: true,
          v3_singleFetch: true,
          v3_lazyRouteDiscovery: true,
        },
      }),
      envOnlyMacros(),
      tsconfigPaths({root: path.resolve(__dirname, '../..')}),
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
      // Add Sentry plugin for production builds
      process.env.NODE_ENV === 'production' &&
        process.env.SENTRY_AUTH_TOKEN &&
        sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: 'mintter',
          project: 'seed-site',
          telemetry: false,
        }),
    ].filter(Boolean),
    resolve: {
      dedupe: [
        '@shm/shared',
        '@shm/shared/*',
        '@shm/editor',
        '@shm/editor/*',
        '@shm/ui',
        '@shm/ui/*',
        '@seed-hypermedia/client',
        'react',
        'react-dom',
      ],
      alias: {
        '@shm/shared': path.resolve(__dirname, '../../packages/shared/src'),
        '@shm/editor': path.resolve(__dirname, '../../packages/editor/src'),
        '@shm/ui': path.resolve(__dirname, '../../packages/ui/src'),
        '@seed-hypermedia/client': path.resolve(__dirname, '../../packages/client/src'),
      },
    },
  }
})

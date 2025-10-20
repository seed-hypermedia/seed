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
      port: 3060,
    },
    clearScreen: false,
    build: {minify: false, sourcemap: true},
    ssr: {
      noExternal: ['react-icons', '@shm/editor'],
    },
    define: isSsrBuild
      ? {}
      : {
          'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
          'process.env.NODE_DEBUG': JSON.stringify(process.env.NODE_DEBUG),
          'process.env.SEED_ENABLE_STATISTICS': JSON.stringify(
            process.env.SEED_ENABLE_STATISTICS,
          ),
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
      tailwindcss(),
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
        'react',
        'react-dom',
      ],
      alias: {
        '@': path.resolve(__dirname, './app'),
        '@shm/shared': path.resolve(__dirname, '../../packages/shared/src'),
        '@shm/editor': path.resolve(__dirname, '../../packages/editor/src'),
        '@shm/ui': path.resolve(__dirname, '../../packages/ui/src'),
        '../ui': path.resolve(__dirname, '../../packages/ui/src'),
      },
    },
  }
})

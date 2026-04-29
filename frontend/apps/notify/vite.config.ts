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
          'process.env.SEED_ENABLE_STATISTICS': JSON.stringify(process.env.SEED_ENABLE_STATISTICS),
          'process.env.NOTIFY_SENTRY_DSN': JSON.stringify(process.env.NOTIFY_SENTRY_DSN),
          'process.env.NOTIFY_SENTRY_RELEASE': JSON.stringify(
            process.env.NOTIFY_SENTRY_RELEASE || process.env.SENTRY_RELEASE || process.env.COMMIT_HASH || '',
          ),
          'process.env.NOTIFY_SENTRY_ENVIRONMENT': JSON.stringify(
            process.env.NOTIFY_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || 'production',
          ),
          'process.env.SENTRY_RELEASE': JSON.stringify(process.env.SENTRY_RELEASE || ''),
          'process.env.SENTRY_ENVIRONMENT': JSON.stringify(process.env.SENTRY_ENVIRONMENT || ''),
        },
    optimizeDeps: {
      exclude:
        process.env.NODE_ENV === 'production'
          ? []
          : ['expo-linear-gradient', 'react-icons', '@shm/editor', '@shm/shared', '@remix-run/react'],
    },
    plugins: [
      remix(),
      envOnlyMacros(),
      tsconfigPaths({root: path.resolve(__dirname, '../..')}),
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
          project: 'seed-notify',
          telemetry: false,
          applicationKey: 'seed-notify',
          release: {
            name:
              process.env.NOTIFY_SENTRY_RELEASE ||
              process.env.SENTRY_RELEASE ||
              process.env.COMMIT_HASH ||
              undefined,
            setCommits: {auto: true, ignoreMissing: true, ignoreEmpty: true},
            deploy: {env: process.env.NOTIFY_SENTRY_ENVIRONMENT || 'production'},
          },
          sourcemaps: {
            filesToDeleteAfterUpload: ['./build/client/**/*.map', './build/server/**/*.map'],
          },
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
        '@': path.resolve(__dirname, './app'),
        '@shm/shared': path.resolve(__dirname, '../../packages/shared/src'),
        '@shm/editor': path.resolve(__dirname, '../../packages/editor/src'),
        '@shm/ui': path.resolve(__dirname, '../../packages/ui/src'),
        '../ui': path.resolve(__dirname, '../../packages/ui/src'),
        '@seed-hypermedia/client': path.resolve(__dirname, '../../packages/client/src'),
      },
    },
  }
})

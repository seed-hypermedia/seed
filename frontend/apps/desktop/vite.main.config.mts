import {sentryVitePlugin} from '@sentry/vite-plugin'
import path from 'path'
import {defineConfig} from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'

const extensions = [
  '.web.tsx',
  '.tsx',
  '.web.ts',
  '.ts',
  '.web.jsx',
  '.jsx',
  '.web.js',
  '.js',
  '.css',
  '.json',
  '.mjs',
]

// https://vitejs.dev/config
export default defineConfig(({command, mode}) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  return {
    define: {
      __SENTRY_DSN__: JSON.stringify(process.env.VITE_DESKTOP_SENTRY_DSN),
    },
    publicDir: 'assets',
    build: {
      sourcemap: true,
      rollupOptions: {
        /**
         * Ignore "use client" waning since we are not using SSR
         * @see {@link https://github.com/TanStack/query/pull/5161#issuecomment-1477389761 Preserve 'use client' directives TanStack/query#5161}
         */
        onwarn(warning, warn) {
          if (
            warning.code === 'MODULE_LEVEL_DIRECTIVE' &&
            warning.message.includes(`"use client"`)
          ) {
            return
          }
          warn(warning)
        },
      },
    },
    resolve: {
      // Some libs that can run in both Web and Node.js, such as `axios`, we need to tell Vite to build them in Node.js.
      browserField: false,
      mainFields: ['module', 'jsnext:main', 'jsnext'],
      extensions,
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
    plugins:
      command == 'build'
        ? [
            tsConfigPaths({
              root: '../../',
            }),
            sentryVitePlugin({
              authToken: process.env.SENTRY_AUTH_TOKEN,
              org: 'mintter',
              project: 'electron',
              telemetry: false,
            }),
          ]
        : [
            tsConfigPaths({
              root: '../../',
            }),
            // {
            //   name: 'log-files',
            //   transform(code, id) {
            //     console.log('Processing file:', id)
            //     return code
            //   },
            // },
          ],
    alias: {
      'react-native': 'react-native-web',
    },
    optimizeDeps: {
      esbuildOptions: {
        resolveExtensions: extensions,
      },
    },
  }
})

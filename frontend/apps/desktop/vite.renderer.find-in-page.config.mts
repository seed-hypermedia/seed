import {sentryVitePlugin} from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

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
  const config = {
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          app: './find.html',
        },
      },
    },
    plugins: [
      tsConfigPaths({
        root: '../../',
      }),
      tailwindcss(),
    ],
    resolve: {
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
        'react-native': 'react-native-web',
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        resolveExtensions: extensions,
      },
    },
    // Define environment variables for the find-in-page renderer
    define: {
      // Define process object for the renderer process (browser environment)
      process: JSON.stringify({
        env: {},
        platform: process.platform,
        arch: process.arch,
        versions: process.versions,
      }),
      global: 'globalThis',
    },
  }

  if (command == 'build') {
    config.plugins.push(
      sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: 'mintter',
        project: 'seed-electron',
        telemetry: false,
      }),
    )
  }

  return config
})

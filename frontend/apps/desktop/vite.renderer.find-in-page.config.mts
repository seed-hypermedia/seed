import {sentryVitePlugin} from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

import react from '@vitejs/plugin-react'
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
    plugins: [tsConfigPaths(), react(), tailwindcss()],
    resolve: {
      extensions,
    },
    alias: {
      'react-native': 'react-native-web',
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
        project: 'electron',
        telemetry: false,
      }),
    )
  }

  return config
})

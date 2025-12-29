import {sentryVitePlugin} from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
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

  const config = {
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
    publicDir: 'assets',
    assetsInclude: ['**/*.png'],
    plugins: [
      tsConfigPaths({
        root: '../../',
      }),
      react(),
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
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        resolveExtensions: extensions,
      },
    },
    // Define environment variables that will be replaced at build time
    define: {
      // Define process object for the renderer process (browser environment)
      process: JSON.stringify({
        env: {},
        platform: process.platform,
        arch: process.arch,
        versions: process.versions,
      }),
      global: 'globalThis',

      // This will be replaced with the actual value during build
      // In development it's true, in production it's false
      __SHOW_OB_RESET_BTN__: !!process.env.SHOW_OB_RESET_BTN,

      // Electron Forge environment variables
      MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(
        process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL,
      ),
      MAIN_WINDOW_VITE_NAME: JSON.stringify(process.env.MAIN_WINDOW_VITE_NAME),
      FIND_IN_PAGE_VITE_DEV_SERVER_URL: JSON.stringify(
        process.env.FIND_IN_PAGE_VITE_DEV_SERVER_URL,
      ),
      FIND_IN_PAGE_VITE_NAME: JSON.stringify(
        process.env.FIND_IN_PAGE_VITE_NAME,
      ),

      // Sentry DSN for renderer process
      'import.meta.env.VITE_DESKTOP_SENTRY_DSN': JSON.stringify(
        process.env.VITE_DESKTOP_SENTRY_DSN,
      ),
      'import.meta.env.VITE_VERSION': JSON.stringify(
        process.env.npm_package_version,
      ),
      'import.meta.env.MODE': JSON.stringify(mode),
      'import.meta.env.DEV': mode === 'development',
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

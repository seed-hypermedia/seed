import {sentryVitePlugin} from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import {tamaguiPlugin} from '@tamagui/vite-plugin'
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
      tamaguiPlugin({
        components: ['@shm/ui', 'tamagui'],
        config: './tamagui.config.ts',
        themeBuilder: {
          input: '../../packages/ui/src/themes/theme.ts',
          output: '../../packages/ui/src/themes-generated.ts',
        },
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
      },
    },
    alias: {
      'react-native': 'react-native-web',
    },
    optimizeDeps: {
      esbuildOptions: {
        resolveExtensions: extensions,
      },
    },
    // Define environment variables that will be replaced at build time
    define: {
      // This will be replaced with the actual value during build
      // In development it's true, in production it's false
      __SHOW_OB_RESET_BTN__: !!process.env.SHOW_OB_RESET_BTN,
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

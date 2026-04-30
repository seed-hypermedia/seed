import {sentryVitePlugin} from '@sentry/vite-plugin'
import path from 'path'
import {defineConfig} from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'

// https://vitejs.dev/config
export default defineConfig(({command}) => {
  const config = {
    build: {
      sourcemap: !(process.platform === 'win32' && process.env.CI),
      rollupOptions: {
        external: [],
      },
    },
    plugins: [
      tsConfigPaths({
        root: '../../',
      }),
    ] as any[],
    resolve: {
      dedupe: ['@shm/shared', '@shm/shared/*', '@shm/ui', 'react', 'react-dom'],
      alias: {
        '@shm/shared': path.resolve(__dirname, '../../packages/shared/src'),
        '@shm/editor': path.resolve(__dirname, '../../packages/editor/src'),
      },
    },
  }

  if (command === 'build' && process.env.SENTRY_AUTH_TOKEN) {
    config.plugins.push(
      sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: 'mintter',
        project: 'seed-electron',
        telemetry: false,
        applicationKey: 'seed-electron-preload',
        release: {
          name: process.env.VITE_VERSION || undefined,
          setCommits: {auto: true, ignoreMissing: true, ignoreEmpty: true},
        },
        sourcemaps: {
          filesToDeleteAfterUpload: ['.vite/build/preload*.js.map', '.vite/preload/**/*.map'],
        },
      }),
    )
  }

  return config
})

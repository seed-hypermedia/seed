import react from '@vitejs/plugin-react'
// @ts-ignore
import {sentryVitePlugin} from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

import * as path from 'path'
import {defineConfig} from 'vite'
import commonjs from 'vite-plugin-commonjs'
import tsconfigPaths from 'vite-tsconfig-paths'

// @ts-ignore
import {envOnlyMacros} from 'vite-env-only'

export default defineConfig(() => {
  return {
    server: {
      port: 3000,
      cors: false,
    },
    clearScreen: false,
    build: {minify: true, sourcemap: true},
    ssr: {
      noExternal: [
        'react-icons',
        '@shm/editor',
        '@shm/shared',
        '@shm/ui',
        '@yudiel/react-qr-scanner',
        /^@radix-ui\//,
        /^@atlaskit\//,
        'sonner',
        'class-variance-authority',
        'clsx',
        'tailwind-merge',
        'lucide-react',
        'vaul',
      ],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      'process.env.NODE_DEBUG': JSON.stringify(process.env.NODE_DEBUG),
      'process.env.SEED_ENABLE_STATISTICS': JSON.stringify(process.env.SEED_ENABLE_STATISTICS),
      'process.env.SEED_IS_GATEWAY': JSON.stringify(process.env.SEED_IS_GATEWAY),
      'process.env.SITE_SENTRY_DSN': JSON.stringify(process.env.SITE_SENTRY_DSN),
      'process.env.SITE_SENTRY_RELEASE': JSON.stringify(
        process.env.SITE_SENTRY_RELEASE || process.env.SENTRY_RELEASE || process.env.COMMIT_HASH || '',
      ),
      'process.env.SITE_SENTRY_ENVIRONMENT': JSON.stringify(
        process.env.SITE_SENTRY_ENVIRONMENT || process.env.SENTRY_ENVIRONMENT || 'production',
      ),
      'process.env.SENTRY_RELEASE': JSON.stringify(process.env.SENTRY_RELEASE || ''),
      'process.env.SENTRY_ENVIRONMENT': JSON.stringify(process.env.SENTRY_ENVIRONMENT || ''),
    },
    optimizeDeps: {
      exclude:
        process.env.NODE_ENV === 'production'
          ? []
          : ['expo-linear-gradient', 'react-icons', '@shm/editor', '@shm/shared'],
    },
    plugins: [
      react(),
      envOnlyMacros(),
      tsconfigPaths({root: path.resolve(__dirname, '../..')}),
      commonjs({
        filter(id) {
          if (id.includes('node_modules/@react-native/normalize-color')) {
            return true
          }
        },
      }),
      {
        name: 'seed-web-api-dev-server',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const host = req.headers.host || 'localhost:3000'
            const requestUrl = new URL(req.url || '/', `http://${host}`)
            if (!requestUrl.pathname.startsWith('/api/') && !requestUrl.pathname.startsWith('/hm/api/')) {
              next()
              return
            }
            try {
              const chunks: Buffer[] = []
              for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
              const request = new Request(requestUrl, {
                method: req.method,
                headers: req.headers as HeadersInit,
                body: chunks.length ? Buffer.concat(chunks) : undefined,
              })
              const {handleWebApiRequest} = await server.ssrLoadModule('/app/http-handlers.server.ts')
              const response = (await handleWebApiRequest(request)) as Response | null
              if (!response) {
                next()
                return
              }
              res.statusCode = response.status
              response.headers.forEach((value, key) => res.setHeader(key, value))
              const body = response.body ? Buffer.from(await response.arrayBuffer()) : null
              res.end(body)
            } catch (error) {
              next(error)
            }
          })
        },
      },
      tailwindcss(),
      process.env.NODE_ENV === 'production' &&
        process.env.SENTRY_AUTH_TOKEN &&
        sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: 'mintter',
          project: 'seed-site',
          telemetry: false,
          applicationKey: 'seed-site',
          release: {
            name: process.env.SITE_SENTRY_RELEASE || process.env.SENTRY_RELEASE || process.env.COMMIT_HASH || undefined,
            setCommits: {auto: true, ignoreMissing: true, ignoreEmpty: true},
            deploy: {env: process.env.SITE_SENTRY_ENVIRONMENT || 'production'},
          },
          sourcemaps: {
            filesToDeleteAfterUpload: ['./dist/**/*.map'],
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
        '@/editor.css': path.resolve(__dirname, '../../packages/editor/src/editor.css'),
        '@/blocknote': path.resolve(__dirname, '../../packages/editor/src/blocknote'),
        '@shm/shared': path.resolve(__dirname, '../../packages/shared/src'),
        '@shm/editor': path.resolve(__dirname, '../../packages/editor/src'),
        '@shm/ui': path.resolve(__dirname, '../../packages/ui/src'),
        '@seed-hypermedia/client': path.resolve(__dirname, '../../packages/client/src'),
        '@': path.resolve(__dirname, './app'),
      },
    },
  }
})

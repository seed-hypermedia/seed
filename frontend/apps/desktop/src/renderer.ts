/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/application-architecture#main-and-renderer-processes
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */
import * as Sentry from '@sentry/electron/renderer'
import {IS_PROD_DESKTOP} from '@shm/shared/constants'
import {seedBrowserTracePropagationTargets} from '@shm/shared/sentry-tracing'

import './root.tsx'

// Inject Plausible analytics script when VITE_PLAUSIBLE_DOMAIN is set (production CI builds only)
// @ts-expect-error
const plausibleDomain = import.meta.env.VITE_PLAUSIBLE_DOMAIN
if (plausibleDomain) {
  const script = document.createElement('script')
  script.defer = true
  script.dataset.domain = plausibleDomain
  script.setAttribute('file-types', 'rpm,deb,dmg,exe')
  script.src =
    'https://plausible.io/js/script.file-downloads.hash.outbound-links.pageview-props.revenue.tagged-events.js'
  document.head.appendChild(script)
}

// Vite injects these at build time. The desktop tsconfig targets CommonJS so
// `import.meta` triggers TS1343 here even though it's valid for the bundler.
// @ts-ignore - Vite-only meta property
const importMetaEnv = ((import.meta as any)?.env ?? {}) as {
  VITE_DESKTOP_SENTRY_DSN?: string
  VITE_VERSION?: string
  MODE?: string
  DEV?: boolean
  VITE_SENTRY_ENVIRONMENT?: string
  VITE_SENTRY_RELEASE?: string
}

const rendererDsn = importMetaEnv.VITE_DESKTOP_SENTRY_DSN

if (IS_PROD_DESKTOP && rendererDsn) {
  Sentry.init({
    dsn: rendererDsn,
    release: importMetaEnv.VITE_SENTRY_RELEASE || importMetaEnv.VITE_VERSION || undefined,
    environment: importMetaEnv.VITE_SENTRY_ENVIRONMENT || importMetaEnv.MODE || 'production',
    debug: false,
    sendDefaultPii: false,
    attachStacktrace: true,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.browserProfilingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracesSampler: (samplingContext) => {
      if (samplingContext?.parentSampled !== undefined) {
        return samplingContext.parentSampled ? 1.0 : 0
      }
      return importMetaEnv.DEV ? 1.0 : 0.1
    },
    profilesSampleRate: 1.0,
    tracePropagationTargets: seedBrowserTracePropagationTargets,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      /Loading chunk \d+ failed/,
    ],
  })
  Sentry.setTag('app', 'desktop')
  Sentry.setTag('process', 'renderer')
}

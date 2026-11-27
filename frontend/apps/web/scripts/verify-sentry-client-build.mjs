import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'

// Check the artifact actually shipped by the prebuilt-image workflows, not just
// the presence of build-time secrets. Never print the DSN or bundle contents.
const assets = join(import.meta.dirname, '..', 'build', 'client', 'assets')
const entries = readdirSync(assets).filter((name) => /^entry\.client-.*\.js$/.test(name))
if (entries.length !== 1) throw new Error(`Expected one browser entry; found ${entries.length}`)
const entry = readFileSync(join(assets, entries[0]), 'utf8')
const sentryMarkers = ['tracesSampleRate', 'replaysOnErrorSampleRate']
const hasSentryInit = sentryMarkers.every((marker) => entry.includes(marker))
const hasAnySentryInit = sentryMarkers.some((marker) => entry.includes(marker))
if (process.env.SITE_SENTRY_DSN) {
  if (!hasSentryInit) throw new Error('Web production entry has no Sentry initialization despite SITE_SENTRY_DSN')
  console.log('Web production entry contains Sentry initialization')
} else {
  if (hasAnySentryInit) throw new Error('Web production entry contains Sentry initialization without SITE_SENTRY_DSN')
  console.log('SITE_SENTRY_DSN not provided; web production entry has no Sentry initialization')
}

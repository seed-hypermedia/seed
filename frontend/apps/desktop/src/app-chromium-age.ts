import {z} from 'zod'
import release from '../electron-release.json'

declare const __ELECTRON_RELEASE_DATE__: string
const bundledReleasedAt =
  typeof __ELECTRON_RELEASE_DATE__ === 'undefined' ? release.releasedAt : __ELECTRON_RELEASE_DATE__

// The feat/integrated-browser branch consumes this status to gate its browser and Settings toggle.

/** Optional browser policy fields accepted from latest.json. */
export const chromiumPolicySchema = z.object({
  minimumChromium: z
    .string()
    .regex(/^\d+(?:\.\d+){0,3}$/)
    .optional(),
  chromiumReleasedAt: z.string().datetime({offset: true}).optional(),
})

/** Server policy, independent of the locally bundled release date. */
export type ChromiumPolicy = z.infer<typeof chromiumPolicySchema>

let policy: ChromiumPolicy = {}
const maxAgeMs = 60 * 24 * 60 * 60 * 1000

/** Accepts manifest policy only after the updater has validated the manifest. */
export function setChromiumPolicy(value: unknown): ChromiumPolicy {
  policy = chromiumPolicySchema.parse(value)
  return policy
}

/** Reports whether this runtime exceeds the age limit or falls below the published minimum. */
export function isChromiumStale(
  options: {
    chrome?: string
    releasedAt?: string
    now?: number
    policy?: ChromiumPolicy
  } = {},
): boolean {
  const chrome = options.chrome ?? process.versions.chrome ?? ''
  const releasedAt = options.releasedAt ?? bundledReleasedAt
  const now = options.now ?? Date.now()
  const minimum = (options.policy ?? policy).minimumChromium
  const released = Date.parse(releasedAt)
  if (!/^\d+(?:\.\d+){0,3}$/.test(chrome) || !Number.isFinite(released)) return true
  if (now - released > maxAgeMs) return true
  if (!minimum) return false
  const current = chrome.split('.').map(Number)
  const required = minimum.split('.').map(Number)
  for (let i = 0; i < Math.max(current.length, required.length); i++) {
    const difference = (required[i] ?? 0) - (current[i] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}

/** Serializable browser status for the desktop renderer; the bundled date never comes from the server. */
export function getChromiumStatus() {
  return {
    stale: isChromiumStale(),
    chromium: process.versions.chrome ?? null,
    electron: release.version,
    bundledReleasedAt,
    minimumChromium: policy.minimumChromium ?? null,
    chromiumReleasedAt: policy.chromiumReleasedAt ?? null,
  }
}

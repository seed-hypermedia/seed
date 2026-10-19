/** Registrable domains whose HTTP(S) subframes the app supports. */
export const EMBED_DOMAINS = [
  'youtube.com',
  'youtube-nocookie.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'cdninstagram.com',
] as const

/** Runtime origins shared by the window, session and renderer policies. */
export type AppWindowPolicy = {
  appOrigin: string | null
  daemonOrigin: string
  fileOrigin: string
  connectOrigins: string[]
  development: boolean
  /** Takes an http(s) link the user clicked in the app; returns true when it was opened in Seed. */
  openInApp?: (url: string, contents: import('electron').WebContents) => boolean
}

/** Parse untrusted URLs at the browser boundary, rejecting non-web protocols. */
export function parseWebURL(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** Match whole DNS labels below explicit registrable domains, never URL substrings. */
export function isAllowedFrameURL(value: string, policy: AppWindowPolicy): boolean {
  const url = parseWebURL(value)
  if (!url) return false
  return (
    url.origin === policy.appOrigin ||
    url.origin === policy.daemonOrigin ||
    url.origin === policy.fileOrigin ||
    EMBED_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  )
}

/** Build the app response policy for configured services and user-selected agent servers. */
export function appContentSecurityPolicy(policy: AppWindowPolicy): string {
  const contentOrigins = Array.from(new Set([policy.daemonOrigin, policy.fileOrigin]))
  const connectOrigins = Array.from(new Set([...contentOrigins, ...policy.connectOrigins]))
  const frames = EMBED_DOMAINS.flatMap((domain) => [
    `https://${domain}`,
    `https://*.${domain}`,
    `http://${domain}`,
    `http://*.${domain}`,
  ])
  return [
    "default-src 'self'",
    // Agent endpoints are user-configurable, including local servers on arbitrary ports.
    `connect-src 'self' http://localhost:* http://127.0.0.1:* https: ws://localhost:* ws://127.0.0.1:* wss: ${connectOrigins.join(
      ' ',
    )}`,
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' data: blob: https: http:",
    `frame-src 'self' ${contentOrigins.join(' ')} ${frames.join(' ')}`,
    // Existing embed loaders and optional production analytics inject these
    // specific scripts. No arbitrary HTTPS script source or inline execution.
    "script-src 'self' https://platform.twitter.com/widgets.js https://www.instagram.com/embed.js https://plausible.io/js/script.file-downloads.hash.outbound-links.pageview-props.revenue.tagged-events.js",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ')
}

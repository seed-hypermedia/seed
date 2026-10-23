/**
 * Plain http is never shown by accident. A web address that is not encrypted is first tried over
 * https, before any http request leaves the machine, so a site that only redirects to https never
 * loads unencrypted and nothing red ever flashes. When the encrypted attempt fails, Seed shows a
 * warning in the pane, and the http page appears only after the user accepts it for that origin,
 * for the rest of the session.
 *
 * Loopback addresses (localhost, 127.0.0.1, ::1) are trustworthy without encryption, as in every
 * browser's secure-context rules, so a local development server needs no warning.
 */

/** How long an encrypted attempt may take before the warning for the http address is shown. */
export const HTTPS_ATTEMPT_TIMEOUT_MS = 10_000

function parse(url: string | URL): URL | null {
  try {
    return typeof url === 'string' ? new URL(url) : url
  } catch {
    return null
  }
}

/** Whether a URL points at this machine over a loopback name or address, which is a secure context. */
export function isLoopbackUrl(url: string | URL): boolean {
  const parsed = parse(url)
  if (!parsed) return false
  // WHATWG URL canonicalizes IP literals, so shortened or hex IPv4 forms are already dotted decimal.
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '[::1]') return true
  return /^127\.\d+\.\d+\.\d+$/.test(host)
}

/** Whether a committed page is unencrypted: plain http to anything but a loopback address. */
export function isInsecureUrl(url: string): boolean {
  const parsed = parse(url)
  return !!parsed && parsed.protocol === 'http:' && !isLoopbackUrl(parsed)
}

/** The same address over https; port 80 is replaced by the https default. */
export function httpsVersion(url: string): string {
  const parsed = new URL(url)
  parsed.protocol = 'https:'
  return parsed.href
}

/** Origins the user accepted the insecure warning for; in memory only, so a restart asks again. */
export class InsecureOrigins {
  private origins = new Set<string>()
  private static origin(url: string): string | null {
    const parsed = parse(url)
    return parsed && parsed.protocol === 'http:' ? parsed.origin : null
  }
  allow(url: string) {
    const origin = InsecureOrigins.origin(url)
    if (origin) this.origins.add(origin)
  }
  allows(url: string): boolean {
    const origin = InsecureOrigins.origin(url)
    return !!origin && this.origins.has(origin)
  }
  clear() {
    this.origins.clear()
  }
}

/** Normal and private pages remember their opt-ins separately; both are cleared with their data. */
export const insecureOrigins = {normal: new InsecureOrigins(), private: new InsecureOrigins()}

/**
 * The encrypted address to try before a plain http one, or null when the URL may load as it is:
 * it is already https, it is loopback, or the user accepted the warning for its origin.
 */
export function httpsAttempt(url: string, allowed: InsecureOrigins): string | null {
  if (!isInsecureUrl(url) || allowed.allows(url)) return null
  return httpsVersion(url)
}

/**
 * Seed's warning for an unencrypted page, with no script and a thick red frame on both themes. The
 * buttons are links on a scheme the navigation guard owns, so only a real click can continue.
 */
export function browserInsecurePage(url: string): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  const host = parse(url)?.host ?? url
  return (
    'data:text/html;charset=utf-8,' +
    encodeURIComponent(`<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Connection not encrypted</title>
<style>html,body{margin:0;min-height:100%}body{box-sizing:border-box;min-height:100vh;border:16px solid #ff0000;padding:2rem;font:16px system-ui;color-scheme:light dark}main{max-width:40rem;margin:10vh auto}h1{color:#e00000}a{display:inline-block;padding:0.75rem 1rem;border:1px solid;border-radius:0.5rem;color:inherit;margin:0 1rem 1rem 0;text-decoration:none}a.continue{border-color:#ff0000;color:#e00000;font-weight:600}</style></head>
<body><main><h1>Your connection to ${escape(
      host,
    )} is not encrypted</h1><p>This address uses plain http. Anything you read or type on it can be seen or changed by anyone on the network between you and ${escape(
      host,
    )}. Seed tried the encrypted address first, and it did not work.</p><p><a role="button" class="continue" href="seed-browser://allow-insecure">Show the page anyway</a><a role="button" href="seed-browser://back">Go back</a></p></main></body></html>`)
  )
}

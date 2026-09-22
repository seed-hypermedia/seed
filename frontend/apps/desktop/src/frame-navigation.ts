/**
 * Which iframe navigations inside a Seed window leave the app for the system browser.
 *
 * Website embeds are limited to the services the app knows how to show; any other website
 * a frame tries to load opens externally instead. Local documents are not websites: a
 * sandboxed `data:` or `srcdoc` frame (agent app widgets, for one) and `blob:` or `about:`
 * documents never leave the window.
 */
const ALLOWED_EMBED_DOMAINS = [
  'youtube.com',
  'youtube-nocookie.com',
  'twitter.com',
  'x.com',
  'platform.twitter.com',
  'instagram.com',
  'cdninstagram.com',
]

export function frameNavigationOpensExternally(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false
  return !ALLOWED_EMBED_DOMAINS.some((domain) => url.includes(domain))
}

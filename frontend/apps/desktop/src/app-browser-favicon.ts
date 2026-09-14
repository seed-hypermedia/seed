import type {WebContents} from 'electron'

/** Reads applicable tab icons in the guest document, preserving base URLs, media queries, and size hints. */
export async function readBrowserFavicons(guest: WebContents): Promise<string[]> {
  return guest.executeJavaScriptInIsolatedWorld(1001, [
    {
      code: `
    (() => {
      const target = 16 * devicePixelRatio
      const icons = Array.from(document.querySelectorAll('link[rel]'))
        .filter(link => link.rel.toLowerCase().split(/\\s+/).includes('icon') && link.getAttribute('href') && (!link.media || matchMedia(link.media).matches))
        .map((link, index) => {
          const sizes = Array.from(link.sizes, size => size.toLowerCase())
          const dimensions = sizes.map(size => /^(\\d+)x\\1$/i.exec(size)).filter(Boolean).map(size => Number(size[1]))
          const rank = sizes.includes('any') ? 0 : dimensions.length
            ? Math.min(...dimensions.map(size => size >= target ? size - target : target * 10 + target - size))
            : target * 20
          return {url: link.href, rank, index}
        })
        .sort((a, b) => a.rank - b.rank || b.index - a.index)
        .map(icon => icon.url)
      return icons.length ? icons : [new URL('/favicon.ico', location.href).href]
    })()
  `,
    },
  ])
}

/** Loads an icon with the website's session so its cookies, cache, proxy, and redirects work normally. */
export async function loadBrowserFavicon(guest: WebContents, url: string): Promise<string | null> {
  if (/^data:image\//i.test(url)) return url
  if (url.startsWith('blob:')) {
    try {
      return await guest.executeJavaScriptInIsolatedWorld(1001, [
        {
          code: `
        (async () => {
          const response = await fetch(${JSON.stringify(url)})
          const blob = await response.blob()
          return new Promise(resolve => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = () => resolve(null)
            reader.readAsDataURL(blob)
          })
        })()
      `,
        },
      ])
    } catch {
      return null
    }
  }
  if (!/^https?:\/\//i.test(url)) return null
  try {
    const response = await guest.session.fetch(url, {
      credentials: 'include',
      referrer: guest.getURL(),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) return null
    const type = response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream'
    if (!type.startsWith('image/') && type !== 'application/octet-stream') return null
    const bytes = Buffer.from(await response.arrayBuffer())
    return `data:${type};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

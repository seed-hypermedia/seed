import type {WebContents} from 'electron'
import {fetchBrowserImage, readBrowserImageResponse} from './browser-image'

const maxIconBytes = 512 * 1024

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
        .slice(0, 4)
        .map(icon => icon.url)
      return icons.length ? icons : [new URL('/favicon.ico', location.href).href]
    })()
  `,
    },
  ])
}

/** Loads an icon with the website's session so its cookies, cache, proxy, and redirects work normally. */
export async function loadBrowserFavicon(guest: WebContents, url: string): Promise<string | null> {
  if (/^data:image\//i.test(url)) {
    if (url.length > maxIconBytes * 3 + 200) return null
    try {
      const response = await fetch(url)
      const image = await readBrowserImageResponse(response, maxIconBytes)
      return image ? url : null
    } catch {
      return null
    }
  }
  if (url.startsWith('blob:')) {
    try {
      return await guest.executeJavaScriptInIsolatedWorld(1001, [
        {
          code: `
        (async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          try {
            const response = await fetch(${JSON.stringify(url)}, {signal: controller.signal});
            const image = await (${readBrowserImageResponse.toString()})(response, ${maxIconBytes});
            if (!image) return null;
            let binary = '';
            for (const byte of image.bytes) binary += String.fromCharCode(byte);
            return 'data:' + image.type + ';base64,' + btoa(binary);
          } catch { return null; }
          finally { controller.abort(); clearTimeout(timer); }
        })()
      `,
        },
      ])
    } catch {
      return null
    }
  }
  const image = await fetchBrowserImage(guest, url, maxIconBytes)
  return image ? `data:${image.type};base64,${Buffer.from(image.bytes).toString('base64')}` : null
}

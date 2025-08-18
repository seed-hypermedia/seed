import fs from 'fs/promises'
import path from 'path'
import {userDataPath} from './app-paths'

export type WpPost = {
  id: number
  link: string
  slug: string
  date?: string
  date_gmt?: string
  title: {rendered: string}
  content: {rendered: string; protected?: boolean}
  excerpt?: {rendered: string; protected?: boolean} // Document summary
  featured_media?: number // Cover image
  _embedded?: {
    ['wp:featuredmedia']?: Array<{
      source_url?: string
    }>
  }
}

export async function fetchAndSaveWpPosts(
  siteUrl: string,
  importId: string,
  onProgress?: (page: number, totalPages: number, fetched: number) => void,
) {
  const outputDir = path.join(userDataPath, 'importer', 'wordpress', importId)
  await fs.mkdir(outputDir, {recursive: true})

  // const assetsDir = path.join(outputDir, 'assets')
  // await fs.mkdir(assetsDir, {recursive: true})

  const base = siteUrl.replace(/\/$/, '')
  const perPage = 100
  let page = 1
  const all: WpPost[] = []

  // const resolveAbs = (maybe: string): string | null => {
  //   try {
  //     return new URL(maybe, base).toString()
  //   } catch {
  //     return null
  //   }
  // }

  // // cache so we only download each URL once
  // const downloadCache = new Map<string, Promise<string>>()

  // const downloadToImages = (absUrl: string): Promise<string> => {
  //   if (!downloadCache.has(absUrl)) {
  //     downloadCache.set(
  //       absUrl,
  //       (async () => {
  //         const hash = crypto.createHash('md5').update(absUrl).digest('hex')
  //         const ext = extFromUrl(absUrl)
  //         const filename = `${hash}.${ext}`
  //         const filePath = path.join(assetsDir, filename)

  //         // If already written, skip re-download
  //         try {
  //           await fs.access(filePath)
  //           return `./images/${filename}`
  //         } catch {}

  //         const res = await fetch(absUrl)
  //         if (!res.ok)
  //           throw new Error(
  //             `Failed to download ${absUrl}: ${res.status} ${res.statusText}`,
  //           )
  //         const buf = await res.arrayBuffer()
  //         await fs.writeFile(filePath, Buffer.from(buf))
  //         return `./images/${filename}`
  //       })(),
  //     )
  //   }
  //   return downloadCache.get(absUrl)!
  // }

  // // async HTML rewriter that swaps <img src> to local files and removes srcset
  // const rewriteImagesInHtml = async (html: string): Promise<string> => {
  //   if (!html) return html

  //   // 1) Rewrite <img src="...">
  //   const imgRe = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
  //   let out = ''
  //   let idx = 0
  //   let m: RegExpExecArray | null
  //   while ((m = imgRe.exec(html))) {
  //     out += html.slice(idx, m.index)
  //     const fullTag = m[0]
  //     const src = m[1]
  //     idx = imgRe.lastIndex

  //     if (/^data:/i.test(src)) {
  //       // leave data-URIs as-is
  //       out += fullTag
  //       continue
  //     }

  //     const abs = resolveAbs(src)
  //     if (!abs) {
  //       out += fullTag
  //       continue
  //     }

  //     if (isLikelyTracker(fullTag, abs)) {
  //       // drop tracking pixels entirely
  //       continue
  //     }

  //     let local = ''
  //     try {
  //       local = await downloadToImages(abs)
  //     } catch {
  //       // if download fails, keep original tag
  //       out += fullTag
  //       continue
  //     }

  //     const replaced = fullTag
  //       .replace(/\ssrc=["'][^"']*["']/i, ` src="${local}"`)
  //       .replace(/\s+srcset="[^"]*"/i, '') // strip srcset for now
  //     out += replaced
  //   }
  //   out += html.slice(idx)

  //   // 2) Strip srcset remaining (rare cases where no src matched above)
  //   out = out.replace(/\s+srcset="[^"]*"/gi, '')
  //   return out
  // }

  while (true) {
    const url =
      `${base}/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}` +
      `&_embed=1&_fields=id,link,slug,date_gmt,title,content,excerpt,featured_media`
    const res = await fetch(url)
    if (!res.ok) {
      if (res.status === 400 || res.status === 404) break
      throw new Error(
        `Failed to fetch page ${page}: ${res.status} ${res.statusText}`,
      )
    }
    const batch: WpPost[] = await res.json()
    if (!batch.length) break

    // // Rewrite images for this batch (in-place)
    // for (const p of batch) {
    //   if (p?.content?.rendered) {
    //     p.content.rendered = await rewriteImagesInHtml(p.content.rendered)
    //   }
    // }

    all.push(...batch)

    const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10)

    // report after each page
    onProgress?.(page, totalPages, all.length)

    if (page >= totalPages) break
    page++
  }

  await fs.writeFile(
    path.join(outputDir, 'posts.json'),
    JSON.stringify(all, null, 2),
  )

  return {count: all.length}
}

// // helper: skip obvious tracking pixels (1×1, opacity:0, etc.)
// const isLikelyTracker = (tag: string, absUrl: string) => {
//   const w = tag.match(/\bwidth="(\d+)"/i)?.[1]
//   const h = tag.match(/\bheight="(\d+)"/i)?.[1]
//   const style = tag.match(/\bstyle="([^"]*)"/i)?.[1]?.toLowerCase() || ''
//   const u = absUrl.toLowerCase()
//   if ((w === '1' && h === '1') || w === '0' || h === '0') return true
//   if (
//     /opacity\s*:\s*0/.test(style) ||
//     /max-height\s*:\s*1px/.test(style) ||
//     /max-width\s*:\s*1px/.test(style) ||
//     /display\s*:\s*none/.test(style) ||
//     /visibility\s*:\s*hidden/.test(style)
//   )
//     return true
//   if (
//     u.includes('count.gif') ||
//     u.includes('/pixel') ||
//     u.includes('tracker') ||
//     u.includes('analytics') ||
//     u.includes('counter.')
//   )
//     return true
//   return false
// }

// // helper: pick file extension from URL
// const extFromUrl = (u: string) => {
//   try {
//     const p = new URL(u).pathname
//     const raw = p.split('.').pop() || ''
//     const clean = raw.split('?')[0].split('#')[0].toLowerCase()
//     if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'].includes(clean))
//       return clean
//   } catch {}
//   return 'jpg'
// }

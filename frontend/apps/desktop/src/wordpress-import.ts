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
}

export async function fetchAndSaveWpPosts(siteUrl: string, importId: string) {
  const outputDir = path.join(userDataPath, 'importer', 'wordpress', importId)
  await fs.mkdir(outputDir, {recursive: true})

  const base = siteUrl.replace(/\/$/, '')
  const perPage = 100
  let page = 1
  const all: WpPost[] = []

  while (true) {
    const url = `${base}/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}`
    const res = await fetch(url)
    if (!res.ok) {
      // WP returns 400 when page exceeds total pages — stop there.
      if (res.status === 400 || res.status === 404) break
      throw new Error(
        `Failed to fetch page ${page}: ${res.status} ${res.statusText}`,
      )
    }
    const batch: WpPost[] = await res.json()
    if (!batch.length) break
    all.push(...batch)
    const totalPages = parseInt(res.headers.get('X-WP-TotalPages') || '1', 10)
    if (page >= totalPages) break
    page++
  }

  await fs.writeFile(
    path.join(outputDir, 'posts.json'),
    JSON.stringify(all, null, 2),
  )

  return {count: all.length}
}

// export async function fetchAndSaveWpPosts(siteUrl: string, importId: string) {
//   const outputDir = path.join(userDataPath, 'importer', 'wordpress', importId)
//   await fs.mkdir(outputDir, {recursive: true})

//   const base = siteUrl.replace(/\/$/, '')
//   const perPage = 100
//   const page = 1

//   const url = `${base}/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}`
//   const res = await fetch(url)
//   if (!res.ok) {
//     throw new Error(`Failed to fetch page 1: ${res.status} ${res.statusText}`)
//   }
//   const batch: WpPost[] = await res.json()

//   await fs.writeFile(
//     path.join(outputDir, 'posts.json'),
//     JSON.stringify(batch, null, 2),
//   )

//   return {count: batch.length}
// }

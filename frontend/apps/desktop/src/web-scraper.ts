import * as cheerio from 'cheerio'
import * as crypto from 'crypto'
import * as fs from 'fs/promises'
import fetch from 'node-fetch'
import * as path from 'path'
import {userDataPath} from './app-paths'

const CACHE_PATH = path.join(userDataPath, 'importer', 'cache')

export interface CacheMetadata {
  url: string
  timestamp: number
  statusCode: number
  headers: Record<string, string>
  postWPMeta?: any
}

export interface CrawlSummary {
  crawlDate: string
  totalPages: number
  freshRequests: number
  pages: {
    path: string
    title?: string
    timestamp: number
    statusCode: number
    images: string[]
    internalLinks: string[]
  }[]
}

export interface StorageContext {
  cacheDir: string
  metadataFile: string
  metadata: Map<string, CacheMetadata>
  cacheDurationDays: number
}

function cleanUrlStorage(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('fbclid')
    return parsed.toString()
  } catch {
    return url
  }
}

function getFilePath(
  storage: StorageContext,
  url: string,
  type: 'html' | 'image' = 'html',
): string {
  const hash = crypto.createHash('md5').update(url).digest('hex')
  const ext = type === 'image' ? path.extname(url) || '.jpg' : '.html'
  return path.join(
    storage.cacheDir,
    type === 'image' ? 'images' : '',
    `${hash}${ext}`,
  )
}

async function ensureDir(storage: StorageContext) {
  await fs.mkdir(storage.cacheDir, {recursive: true})
  await fs.mkdir(path.join(storage.cacheDir, 'images'), {recursive: true})
  await fs.mkdir(path.join(storage.cacheDir, 'assets'), {recursive: true})
}

async function downloadAsset(
  storage: StorageContext,
  url: string,
): Promise<string | null> {
  const assetPath = path.join(storage.cacheDir, 'assets', path.basename(url))
  try {
    try {
      await fs.access(assetPath)
      return assetPath
    } catch {}

    // console.log(`Downloading asset: ${url}`)
    const response = await fetch(url)
    const buffer = await response.arrayBuffer()
    await fs.writeFile(assetPath, new Uint8Array(buffer))
    return assetPath
  } catch (error) {
    const err = error as any
    // console.log(
    //   `Failed to download asset ${url}:`,
    //   err && err.message ? err.message : err,
    // )
    return null
  }
}

async function downloadImage(
  storage: StorageContext,
  url: string,
): Promise<string | null> {
  const imagePath = getFilePath(storage, url, 'image')
  try {
    try {
      await fs.access(imagePath)
      return imagePath
    } catch {}

    // console.log(`Image cache miss: ${url}`)
    const response = await fetch(url)
    const buffer = await response.arrayBuffer()
    await fs.writeFile(imagePath, new Uint8Array(buffer))
    return imagePath
  } catch (error) {
    const err = error as any
    // console.log(
    //   `Failed to download image ${url}:`,
    //   err && err.message ? err.message : err,
    // )
    return null
  }
}

async function loadMetadata(storage: StorageContext) {
  try {
    const data = await fs.readFile(storage.metadataFile, 'utf-8')
    const entries = JSON.parse(data)
    storage.metadata = new Map(entries)
  } catch (error) {
    storage.metadata = new Map()
  }
}

async function saveMetadata(storage: StorageContext) {
  const entries = Array.from(storage.metadata.entries())
  await fs.writeFile(storage.metadataFile, JSON.stringify(entries, null, 2))
}

async function initStorage(storage: StorageContext) {
  await ensureDir(storage)
  await loadMetadata(storage)
}

async function getCachedContent(
  storage: StorageContext,
  url: string,
): Promise<string | null> {
  const cleaned = cleanUrlStorage(url)
  const metadata = storage.metadata.get(cleaned)

  if (!metadata) return null

  const age = (Date.now() - metadata.timestamp) / (1000 * 60 * 60 * 24)
  if (age > storage.cacheDurationDays) return null

  try {
    return await fs.readFile(getFilePath(storage, cleaned), 'utf-8')
  } catch {
    return null
  }
}

async function saveContent(
  storage: StorageContext,
  url: string,
  content: string,
  metadata: Omit<CacheMetadata, 'url' | 'timestamp'>,
) {
  const cleaned = cleanUrlStorage(url)
  const filePath = getFilePath(storage, cleaned)

  await fs.writeFile(filePath, content)
  await updateMetadata(storage, cleaned, metadata)
}

async function updateMetadata(
  storage: StorageContext,
  url: string,
  metadata: Omit<CacheMetadata, 'url' | 'timestamp'>,
) {
  const cleaned = cleanUrlStorage(url)
  storage.metadata.set(cleaned, {
    url: cleaned,
    timestamp: Date.now(),
    ...metadata,
  })
  await saveMetadata(storage)
}

async function exportToFolder(
  storage: StorageContext,
  outputPath: string,
  posts: string[],
) {
  await fs.rm(outputPath, {recursive: true, force: true})
  await fs.mkdir(outputPath, {recursive: true})
  await fs.mkdir(path.join(outputPath, 'pages'), {recursive: true})
  await fs.mkdir(path.join(outputPath, 'images'), {recursive: true})
  await fs.mkdir(path.join(outputPath, 'assets'), {recursive: true})
  await fs.mkdir(path.join(outputPath, 'metadata'), {recursive: true})

  const imagesDir = path.join(storage.cacheDir, 'images')
  const assetsDir = path.join(storage.cacheDir, 'assets')
  const wpMetadataDir = path.join(storage.cacheDir, 'wp-metadata')

  const images = await fs.readdir(imagesDir)
  for (const image of images) {
    await fs.copyFile(
      path.join(imagesDir, image),
      path.join(outputPath, 'images', image),
    )
  }

  const assets = await fs.readdir(assetsDir)
  for (const asset of assets) {
    await fs.copyFile(
      path.join(assetsDir, asset),
      path.join(outputPath, 'assets', asset),
    )
  }

  // Copy WordPress metadata files
  try {
    const wpMetadataFiles = await fs.readdir(wpMetadataDir)
    for (const file of wpMetadataFiles) {
      await fs.copyFile(
        path.join(wpMetadataDir, file),
        path.join(outputPath, 'metadata', file),
      )
    }
  } catch (error) {
    // Ignore if wp-metadata directory doesn't exist
  }

  for (const url of posts) {
    const content = await getCachedContent(storage, url)
    if (!content) continue

    const hash = crypto.createHash('md5').update(url).digest('hex')
    const filename = `${hash}.html`

    const $ = cheerio.load(content)

    $('div.post-item-metadata').remove()
    $('nav.post-navigation').remove()

    $('a').each((_, element) => {
      const href = $(element).attr('href')
      if (href) {
        try {
          const linkUrl = new URL(href, url)
          const baseUrl = new URL(url)
          if (linkUrl.hostname === baseUrl.hostname) {
            const relativePath = linkUrl.pathname + linkUrl.search
            $(element).attr('href', relativePath)
          }
        } catch {
          // Invalid URL, leave as is
        }
      }
    })

    const mainContent = $('.entry-content').html() || content
    const topImageHtml = $('.read-img').html() || ''

    let topImage = topImageHtml
      ? `<div class="main-image">${topImageHtml}</div>`
      : ''
    let processedContent = `<html>\n<body>\n${topImage}\n${mainContent}\n</body>\n</html>`

    // Use Cheerio to only rewrite <img> src attributes
    const $processed = cheerio.load(processedContent)
    $processed('img').each((_, el) => {
      const imgUrl = $processed(el).attr('src')
      if (imgUrl) {
        try {
          const hash = crypto.createHash('md5').update(imgUrl).digest('hex')
          const ext = path.extname(imgUrl) || '.jpg'
          $processed(el).attr('src', `../images/${hash}${ext}`)
        } catch {
          // leave as is
        }
      }
    })
    processedContent = $processed.html() || processedContent

    const assetRegex = /href="([^"]+\.pdf)"/g
    processedContent = processedContent.replace(
      assetRegex,
      (match, assetUrl) => {
        try {
          const assetName = path.basename(assetUrl)
          return `href="../assets/${assetName}"`
        } catch {
          return match
        }
      },
    )

    await fs.writeFile(
      path.join(outputPath, 'pages', filename),
      processedContent,
    )
  }
}

function cleanUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('fbclid')
    parsed.searchParams.delete('replytocom')
    parsed.protocol = 'https:'
    return parsed.toString()
  } catch {
    return url
  }
}

interface CrawlerContext {
  visited: Set<string>
  queue: string[]
  baseUrl: string
  storage: StorageContext
  freshRequests: number
  posts: PostsFile
}

function createCrawler(
  baseUrl: string,
  cacheDurationDays: number = 7,
): CrawlerContext {
  return {
    visited: new Set<string>(),
    queue: [baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl],
    baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
    storage: {
      cacheDir: CACHE_PATH,
      metadataFile: path.join(CACHE_PATH, 'metadata.json'),
      metadata: new Map(),
      cacheDurationDays: 7,
    },
    freshRequests: 0,
    posts: [],
  }
}

function isValidUrl(baseUrl: string, url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.hostname === new URL(baseUrl).hostname
  } catch {
    return false
  }
}

function normalizeUrl(baseUrl: string, url: string): string {
  url = cleanUrl(url)
  if (url.startsWith('//')) {
    url = `https:${url}`
  } else if (url.startsWith('/')) {
    url = `${baseUrl}${url}`
  }
  return url.split('#')[0]
}

async function getUrlContent(
  crawler: CrawlerContext,
  url: string,
): Promise<{
  content: string
  statusCode: number
  responseHeaders: Record<string, string>
  fetchedContent: string | null
  cachedContent: string | null
}> {
  let content: string
  let fetchedContent: string | null = null
  let cachedContent: string | null = null
  let statusCode = 200
  let responseHeaders: Record<string, string> = {}
  cachedContent = await getCachedContent(crawler.storage, url)
  if (cachedContent) {
    content = cachedContent
  } else {
    // console.log(`Cache miss: ${url}`)
    crawler.freshRequests++
    const response = await fetch(url)
    fetchedContent = await response.text()
    content = fetchedContent
    statusCode = response.status
    responseHeaders = Object.fromEntries(response.headers.entries())
  }
  return {content, statusCode, responseHeaders, fetchedContent, cachedContent}
}

function isProbablyWordPress(html: string): boolean {
  const patterns = [
    /\/wp-content\//i,
    /\/wp-includes\//i,
    /\/wp-json\//i,
    /<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i,
    /wp-embed\.min\.js/i,
    /xmlrpc\.php/i,
  ]
  return patterns.some((p) => p.test(html))
}

function extractWordPressSlugFromHTML(
  url: string,
  html: string,
): string | undefined {
  const $ = cheerio.load(html)

  const canonical =
    $('link[rel="canonical"]').attr('href') ||
    $('meta[property="og:url"]').attr('content')
  if (!canonical) {
    // find the slug from the last non-empty path term
    const path = new URL(url).pathname
    const slug = path.split('/').filter(Boolean).pop()
    if (slug) {
      return slug
    }
    return undefined
  }

  return canonical.split('/').filter(Boolean).pop()
}

async function crawlPage(
  crawler: CrawlerContext,
  url: string,
): Promise<{
  links: string[]
  images: string[]
  localPath: string
  metadata?: {
    postWPMeta?: any
    statusCode: number
    headers: Record<string, string>
  }
}> {
  try {
    const {
      content,
      statusCode,
      responseHeaders,
      fetchedContent,
      cachedContent,
    } = await getUrlContent(crawler, url)

    let postWPMeta: any | null = null

    if (isProbablyWordPress(content)) {
      const slug = extractWordPressSlugFromHTML(url, content)
      if (slug) {
        const wpAPIUrlUrl = new URL(url)
        wpAPIUrlUrl.pathname = `/wp-json/wp/v2/posts`
        wpAPIUrlUrl.searchParams.set('slug', slug)
        const wpAPIUrl = wpAPIUrlUrl.toString()
        const {
          content: postContent,
          fetchedContent: postFetchedContent,
          statusCode: postStatusCode,
          responseHeaders: postResponseHeaders,
        } = await getUrlContent(crawler, wpAPIUrl)
        if (postFetchedContent) {
          await saveContent(crawler.storage, wpAPIUrl, postFetchedContent, {
            statusCode: postStatusCode,
            headers: postResponseHeaders,
          })
        }
        try {
          postWPMeta = JSON.parse(postContent)
        } catch {
          postWPMeta = null
        }
      }
    }
    const $ = cheerio.load(content)
    const links: string[] = []
    const images: string[] = []

    $('a').each((_, element) => {
      const href = $(element).attr('href')
      if (href) {
        const normalizedUrl = normalizeUrl(crawler.baseUrl, href)
        if (isValidUrl(crawler.baseUrl, normalizedUrl)) {
          links.push(normalizedUrl)
        }
      }
    })

    $('img').each((_, element) => {
      const src = $(element).attr('src')
      if (src) {
        const normalizedSrc = normalizeUrl(crawler.baseUrl, src)
        images.push(normalizedSrc)
      }
    })

    const downloadedImages = await Promise.all(
      images.map(async (imgUrl) => {
        const localPath = await downloadImage(crawler.storage, imgUrl)
        return localPath
      }),
    )

    const localPath = getFilePath(crawler.storage, url)

    const metadata = {
      statusCode,
      headers: responseHeaders,
    } as const

    if (fetchedContent) {
      await saveContent(crawler.storage, url, fetchedContent, metadata)
    } else {
      await updateMetadata(crawler.storage, url, metadata)
    }

    // Extract post information if this is a post page
    const urlObj = new URL(url)
    if (
      urlObj.pathname !== '/' &&
      !urlObj.pathname.match(/^\/(tag|page|author|category|sample-page|\d{4})/)
    ) {
      const title = $('h1.entry-title').text().trim()
      if (title) {
        const hash = crypto.createHash('md5').update(url).digest('hex')
        const htmlFile = `${hash}.html`
        crawler.posts.push({
          path: url,
          title,
          htmlFile,
          wordpressMetadataFile: postWPMeta ? `${hash}-wp.json` : undefined,
        })
        // Save WordPress metadata separately if it exists
        if (postWPMeta) {
          const wpMetadataPath = path.join(
            crawler.storage.cacheDir,
            'wp-metadata',
            `${hash}-wp.json`,
          )
          await fs.mkdir(path.dirname(wpMetadataPath), {recursive: true})
          await fs.writeFile(
            wpMetadataPath,
            JSON.stringify(postWPMeta, null, 2),
          )
        }
      }
    }

    return {links, images, localPath, metadata: {...metadata, postWPMeta}}
  } catch (error: any) {
    // console.log(`✗ Error crawling ${url}: ${error.message}`)
    return {links: [], images: [], localPath: ''}
  }
}

async function crawl(
  crawler: CrawlerContext,
  onStatus: (status: ScrapeStatus) => void,
): Promise<{pages: Set<string>; posts: PostsFile}> {
  await initStorage(crawler.storage)
  // console.log('Starting crawler...')
  let processed = 0

  while (crawler.queue.length > 0) {
    const currentUrl = crawler.queue.shift()!
    const cleanedUrl = cleanUrl(currentUrl)

    if (crawler.visited.has(cleanedUrl)) {
      continue
    }

    crawler.visited.add(cleanedUrl)
    const {links: newLinks, images} = await crawlPage(crawler, cleanedUrl)
    processed++

    for (const link of newLinks) {
      const cleanedLink = cleanUrl(link)
      if (!crawler.visited.has(cleanedLink)) {
        crawler.queue.push(link)
      }
    }
    onStatus({
      crawlQueueCount: crawler.queue.length,
      visitedCount: crawler.visited.size,
      scrapeMode: 'downloading',
    })
  }

  return {pages: crawler.visited, posts: crawler.posts}
}

export type ScrapeStatus = {
  scrapeMode: 'downloading' | 'processing'
  pagesDiscovered?: number
  pagesProcessed?: number
  crawlQueueCount: number
  visitedCount: number
}

export type PostsFile = {
  path: string
  title: string
  htmlFile: string
  wordpressMetadataFile?: string
}[]

export async function scrapeUrl(
  targetSite: string,
  scrapeId: string,
  onStatus: (status: ScrapeStatus) => void,
) {
  const cacheDays = 7
  const outputDir = path.join(userDataPath, 'importer', 'scrapes', scrapeId)

  if (!targetSite) {
    console.log('Please provide a WordPress site URL as an argument')
    process.exit(1)
  }

  console.log(`Starting crawler for ${targetSite} (cache: ${cacheDays} days)`)
  const crawler = createCrawler(targetSite, cacheDays)
  const {pages, posts} = await crawl(crawler, onStatus)
  // console.log('\nCrawl complete!')

  const metadata = Array.from(crawler.storage.metadata.entries())
  const stats = {
    totalPages: pages.size,
    totalHeaders: metadata.reduce(
      (acc, [_, m]) => acc + Object.keys(m.headers).length,
      0,
    ),
    statusCodes: metadata.reduce(
      (acc, [_, m]) => {
        acc[m.statusCode] = (acc[m.statusCode] || 0) + 1
        return acc
      },
      {} as Record<number, number>,
    ),
  }

  // console.log('\n\n\n\n\n\n\nCrawl Summary:')
  // console.log(`Total Pages: ${stats.totalPages}`)
  // console.log(`Fresh Requests: ${crawler.freshRequests}`)
  // console.log(`Total Headers: ${stats.totalHeaders}`)
  // console.log('Status Codes:', JSON.stringify(stats.statusCodes))

  const summary = {
    crawlDate: new Date().toISOString(),
    totalPages: pages.size,
    freshRequests: crawler.freshRequests,
    pages: metadata.map(([url, data]) => ({
      path: url,
      timestamp: data.timestamp,
      statusCode: data.statusCode,
      headers: data.headers,
    })),
  }

  // Create output directory first
  await fs.mkdir(outputDir, {recursive: true})

  // Export posts to output folder
  await exportToFolder(crawler.storage, outputDir, Array.from(pages))
  // console.log('\nExported posts to output folder')

  const crawlMetadataPath = path.join(outputDir, 'crawl-metadata.json')
  // console.log('About to write metadata to:', crawlMetadataPath)
  // console.log('Summary data:', JSON.stringify(summary, null, 2))
  try {
    await fs.writeFile(crawlMetadataPath, JSON.stringify(summary, null, 2))
    // console.log('\nMetadata exported to', crawlMetadataPath)
  } catch (error) {
    // console.error('Failed to write metadata:', error)
    throw error
  }

  // Separate assets from pages and download PDFs
  const assets = await Promise.all(
    Array.from(pages).map(async (path) => {
      const url = new URL(path)
      const ext = url.pathname.split('.').pop()?.toLowerCase()
      const isAsset =
        ext === 'pdf' ||
        ext === 'jpg' ||
        ext === 'jpeg' ||
        ext === 'png' ||
        ext === 'gif' ||
        ext === 'webp' ||
        ext === 'avif'

      if (isAsset && ext === 'pdf') {
        await downloadAsset(crawler.storage, path)
      }

      return isAsset ? path : null
    }),
  ).then((results) => results.filter(Boolean) as string[])

  // console.log('posts', posts)
  // console.log('assets', assets)

  await fs.writeFile(
    path.join(outputDir, 'assets.json'),
    JSON.stringify(assets, null, 2),
  )
  // console.log(`\nFound ${assets.length} assets saved to output/assets.json`)

  await fs.writeFile(
    path.join(outputDir, 'posts.json'),
    JSON.stringify(posts, null, 2),
  )
  // console.log(`\nFound ${posts.length} posts saved to output/posts.json`)
  return {posts, assets, summary}
}

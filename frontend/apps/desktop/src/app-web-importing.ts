import {PartialMessage} from '@bufbuild/protobuf'
import {
  hmId,
  hmIdPathToEntityQueryPath,
  packHmId,
  unpackHmId,
} from '@shm/shared'
import {DocumentChange} from '@shm/shared/client/grpc-types'
import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared/constants'
import {HMBlockNode} from '@shm/shared/hm-types'
import {htmlToBlocks} from '@shm/shared/html-to-blocks'
import * as cheerio from 'cheerio'
import {readFile} from 'fs/promises'
import http from 'http'
import https from 'https'
import {nanoid} from 'nanoid'
import {join} from 'path'
import z from 'zod'
import {grpcClient} from './app-grpc'
import {userDataPath} from './app-paths'
import {t} from './app-trpc'
import {PostsFile, ScrapeStatus, scrapeUrl} from './web-scraper'
import {
  getWpPosts,
  getWpPostsFromFile,
  loadWpPosts,
  WpImportStatus,
  WpPost,
} from './wordpress-import'

export async function uploadFile(file: Blob | string) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
    method: 'POST',
    body: formData,
  })
  const data = await response.text()
  return data
}

export async function uploadLocalFile(filePath: string) {
  try {
    const fileContent = await readFile(filePath)
    const blob = new Blob([fileContent])
    return uploadFile(blob)
  } catch (e) {
    console.error('Error uploading local file', filePath, e)
    return null
  }
}

function downloadFile(fileUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const protocol = new URL(fileUrl).protocol === 'https:' ? https : http
    protocol
      .get(fileUrl, (response) => {
        if (response.statusCode === 200) {
          const chunks: Buffer[] = []
          response.on('data', (chunk) => chunks.push(chunk))
          response.on('end', () => {
            const blob = new Blob(chunks, {
              type: response.headers['content-type'],
            })
            resolve(blob)
          })
        } else {
          reject(new Error(`Failed to download file: ${response.statusCode}`))
        }
      })
      .on('error', (err) => {
        reject(err)
      })
  })
}

export function extractMetaTags(html: string) {
  const $ = cheerio.load(html)
  const metaTags: Record<string, string> = {}
  $('meta').each((_i, element) => {
    const name = $(element).attr('name') || $(element).attr('property')
    const value = $(element).attr('content')
    if (name && value) {
      metaTags[name] = value
    }
  })
  return metaTags
}

const wpImportStatus: Record<string, WpImportStatus> = {}

type ImportStatus =
  | {
      mode: 'importing'
    }
  | {
      mode: 'error'
      error: string
    }
  | {
      mode: 'ready'
      result: Awaited<ReturnType<typeof scrapeUrl>>
    }

let importingStatus: Record<
  string,
  (ScrapeStatus & {mode: 'scraping'}) | ImportStatus
> = {}

async function importSite(url: string, importId: string) {
  return await scrapeUrl(url, importId, (status) => {
    importingStatus[importId] = {...status, mode: 'scraping'}
  })
}

async function startImport(url: string, importId: string) {
  importingStatus[importId] = {mode: 'importing'}
  importSite(url, importId)
    .then((result) => {
      importingStatus[importId] = {mode: 'ready', result}
    })
    .catch((error) => {
      console.error('Error importing site', url, error)
      importingStatus[importId] = {mode: 'error', error: error.message}
    })
}

async function importWpSite(url: string, importId: string) {
  return await getWpPosts(url, importId, (page, totalPages, fetched) => {
    wpImportStatus[importId] = {mode: 'fetching', page, totalPages, fetched}
  })
}

export function startWpImport(siteUrl: string, importId: string) {
  wpImportStatus[importId] = {
    mode: 'fetching',
    page: 0,
    totalPages: 0,
    fetched: 0,
  }
  importWpSite(siteUrl, importId)
    .then((result) => {
      wpImportStatus[importId] = {mode: 'ready', total: result.count}
      // importingStatus[importId] = {mode: 'ready', result: result}
    })
    .catch((error) => {
      importingStatus[importId] = {mode: 'error', error: error.message}
    })
}

async function importPost({
  destinationId,
  signAccountUid,
  post,
  importId,
}: {
  destinationId: string
  signAccountUid: string
  post: PostsFile[number]
  importId: string
}) {
  const destinationHmId = unpackHmId(destinationId)
  if (!destinationHmId) {
    throw new Error('Invalid destination id')
  }
  const postHtmlPath = join(
    userDataPath,
    'importer',
    'scrapes',
    importId,
    'pages',
    post.htmlFile,
  )
  const postHtml = await readFile(postHtmlPath, {encoding: 'utf-8'})
  const postWpMetadataJsonPath = post.wordpressMetadataFile
    ? join(
        userDataPath,
        'importer',
        'scrapes',
        importId,
        'metadata',
        post.wordpressMetadataFile,
      )
    : null
  const postWpMetadataJson =
    postWpMetadataJsonPath && (await readFile(postWpMetadataJsonPath))
  const postWpMetadata = postWpMetadataJson
    ? (JSON.parse(postWpMetadataJson.toString()) as {
        id?: number
        date?: string
        date_gmt?: string
      }[])
    : []

  async function resolveHMLink(href: string) {
    if (!destinationHmId) {
      throw new Error('Invalid destination id')
    }
    if (href[0] === '.') {
      // handling relative links
      // console.log('~~ relative link', href)
    } else if (href[0] === '/') {
      // handling absolute links
      // console.log('~~ absolute site link', href)
      const path = href.split('/').filter((s) => !!s)
      const resultLink = packHmId(
        hmId(destinationHmId.uid, {
          path: [...(destinationHmId.path || []), ...path],
        }),
      )
      // console.log('~~ result link', resultLink)
      return resultLink
    }
    return href
  }

  const blocks = await htmlToBlocks(postHtml, postHtmlPath, {
    uploadLocalFile,
    resolveHMLink,
  })

  const parentId = unpackHmId(destinationId)
  if (!parentId) {
    throw new Error('Invalid destination id')
  }
  const postUrl = new URL(post.path)
  const docPath = [
    ...(parentId.path || []),
    ...postUrl.pathname.split('/').filter((s) => !!s),
  ]
  let displayPublishTime: string | null = postWpMetadata?.[0]?.date_gmt
    ? new Date(postWpMetadata?.[0]?.date_gmt).toDateString()
    : null
  const changes: DocumentChange[] = []
  function addChange(op: PartialMessage<DocumentChange>['op']) {
    changes.push(
      new DocumentChange({
        op,
      }),
    )
  }
  addChange({
    case: 'setMetadata',
    value: {
      key: 'name',
      value: post.title,
    },
  })
  if (displayPublishTime) {
    addChange({
      case: 'setMetadata',
      value: {
        key: 'displayPublishTime',
        value: displayPublishTime,
      },
    })
  }
  changes.push(...changesForBlockNodes(blocks, ''))
  const resp = await grpcClient.documents.createDocumentChange({
    signingKeyName: signAccountUid,
    account: parentId.uid,
    path: hmIdPathToEntityQueryPath(docPath),
    changes,
  })
  if (resp) {
    // console.log('Document created', resp)
  }
}

export const webImportingApi = t.router({
  importWebSite: t.procedure
    .input(z.object({url: z.string()}).strict())
    .mutation(async ({input}) => {
      const importId = nanoid(10)
      startImport(input.url, importId)
      return {importId}
    }),
  importWebSiteStatus: t.procedure.input(z.string()).query(async ({input}) => {
    return importingStatus[input]
  }),
  importWebSiteConfirm: t.procedure
    .input(
      z
        .object({
          importId: z.string(),
          destinationId: z.string(),
          signAccountUid: z.string(),
        })
        .strict(),
    )
    .mutation(async ({input}) => {
      const {importId, destinationId, signAccountUid} = input
      const postsData = await readFile(
        join(userDataPath, 'importer', 'scrapes', importId, 'posts.json'),
      )
      const posts = JSON.parse(postsData.toString()) as PostsFile
      for (const post of posts) {
        await importPost({
          importId,
          destinationId,
          signAccountUid,
          post,
        })
      }
      return {}
    }),
  importWpSite: t.procedure
    .input(z.object({url: z.string()}).strict())
    .mutation(async ({input}) => {
      const importId = nanoid(10)
      startWpImport(input.url, importId)
      return {importId}
    }),
  importWpFile: t.procedure
    .input(z.object({xmlText: z.string()}).strict())
    .mutation(async ({input}) => {
      const importId = nanoid(10)
      const {total} = await getWpPostsFromFile(input.xmlText, importId)
      wpImportStatus[importId] = {mode: 'ready', total}
      return {importId, total}
    }),
  importWpSiteStatus: t.procedure
    .input(z.string())
    .query(async ({input}) => wpImportStatus[input] ?? null),

  importWpSiteConfirm: t.procedure
    .input(
      z
        .object({
          importId: z.string(),
          destinationId: z.string(),
          signAccountUid: z.string(),
          limit: z.number().int().positive().optional(),
          offset: z.number().int().min(0).optional(),
          concurrency: z.number().int().min(1).max(16).optional(),
        })
        .strict(),
    )
    .mutation(async ({input}) => {
      const {
        importId,
        destinationId,
        signAccountUid,
        limit,
        offset = 0,
        concurrency = 5,
      } = input
      const {posts: loaded, total} = await loadWpPosts(importId, {
        offset,
        limit,
      })
      let posts: any[] = loaded

      wpImportStatus[importId] = {
        mode: 'importing',
        processed: 0,
        total,
      }

      let processed = 0
      await withConcurrency(posts, concurrency, async (post) => {
        wpImportStatus[importId] = {
          mode: 'importing',
          processed,
          total,
          currentId: post.id,
        }
        await importWpPost({post, destinationId, signAccountUid, importId})
        processed++
        wpImportStatus[importId] = {
          mode: 'importing',
          processed,
          total,
        }
      })
      // for (const post of posts) {
      //   wpImportStatus[importId] = {
      //     mode: 'importing',
      //     processed,
      //     total: posts.length,
      //     currentId: post.id,
      //   }
      //   await importWpPost({post, destinationId, signAccountUid, importId})
      //   processed++
      //   wpImportStatus[importId] = {
      //     mode: 'importing',
      //     processed,
      //     total: posts.length,
      //   }
      // }

      wpImportStatus[importId] = {mode: 'ready', total}
      return {imported: total}
    }),
  importWebFile: t.procedure.input(z.string()).mutation(async ({input}) => {
    const file = await downloadFile(input)
    const uploadedCID = await uploadFile(file)
    return {cid: uploadedCID, type: file.type, size: file.size}
  }),
  checkWebUrl: t.procedure.input(z.string()).mutation(async ({input}) => {
    const res = await fetch(input, {
      method: 'HEAD',
    })
    if (res.ok) {
      const contentType = res.headers.get('content-type')
      const parts = contentType
        ? contentType.split(';').map((part) => part.trim())
        : null
      const mimeType = parts?.[0]
      const charsetPart = parts?.find((part) =>
        part.toLowerCase().startsWith('charset='),
      )
      const charset = charsetPart ? charsetPart.split('=')[1] : null
      const headers = Object.fromEntries(res.headers.entries())
      let metaTags = {}
      if (headers['x-hypermedia-site'] && mimeType === 'text/html') {
        const res = await fetch(input, {})
        const html = await res.text()
        metaTags = extractMetaTags(html)
      }
      return {
        contentType,
        mimeType,
        contentLength: headers['content-length']
          ? Number(headers['content-length'])
          : null,
        charset,
        headers,
        metaTags,
      }
    }
    return null
  }),
})

function changesForBlockNodes(
  nodes: HMBlockNode[],
  parentId: string,
): DocumentChange[] {
  const changes: DocumentChange[] = []

  let lastPlacedBlockId = ''

  nodes.forEach((node) => {
    const block = node.block
    changes.push(
      new DocumentChange({
        op: {
          case: 'moveBlock',
          value: {
            blockId: block.id,
            parent: parentId,
            leftSibling: lastPlacedBlockId,
          },
        },
      }),
    )
    changes.push(
      new DocumentChange({
        op: {
          case: 'replaceBlock',
          // @ts-expect-error
          value: block,
        },
      }),
    )
    lastPlacedBlockId = block.id || ''

    if (node.children) {
      changes.push(...changesForBlockNodes(node.children, block.id))
    }
  })

  return changes
}

function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, '').trim()
}

export async function importWpPost({
  post,
  destinationId,
  signAccountUid,
  importId,
}: {
  post: WpPost
  destinationId: string
  signAccountUid: string
  importId: string
}) {
  const parentId = unpackHmId(destinationId)
  if (!parentId) {
    throw new Error('Invalid destination id')
  }

  // Title
  const title = stripHtml(post.title?.rendered ?? 'Untitled')

  const linkUrl = new URL(post.link)

  let baseSeg =
    (post.slug && toSlug(post.slug)) ||
    (lastPathSegment(linkUrl) && toSlug(lastPathSegment(linkUrl)!)) ||
    (post.title?.rendered && toSlug(stripHtml(post.title.rendered))) ||
    ''

  if (!baseSeg) baseSeg = post.id != null ? `post-${post.id}` : 'post'
  // baseSeg = post.id != null ? `${baseSeg}-${post.id}` : baseSeg

  const docPath = [...(parentId.path || []), baseSeg]

  // Convert HTML to blocks
  const html = post.content?.rendered ?? ''
  const blocks = await htmlToBlocks(html, /*sourcePath*/ post.link, {
    uploadLocalFile,
    resolveHMLink: async (href: string) => {
      // Convert absolute site-internal links into Hypermedia doc links
      try {
        const u = new URL(href, linkUrl.origin)
        // Only rewrite links that stay on the same host
        if (u.host === linkUrl.host) {
          const p = u.pathname.split('/').filter(Boolean)
          const resultLink = packHmId(
            hmId(parentId.uid, {path: [...(parentId.path || []), ...p]}),
          )
          return resultLink
        }
      } catch (e) {
        console.log('something wrong with converting internal url:\n', e)
      }
      return href
    },
  })

  // Publish date
  const displayPublishTime = post.date_gmt
    ? new Date(post.date_gmt).toDateString()
    : post.date
    ? new Date(post.date).toDateString()
    : null

  const changes: DocumentChange[] = []
  function addChange(op: PartialMessage<DocumentChange>['op']) {
    changes.push(new DocumentChange({op}))
  }

  addChange({
    case: 'setMetadata',
    value: {key: 'name', value: title || 'Untitled'},
  })

  if (displayPublishTime) {
    addChange({
      case: 'setMetadata',
      value: {key: 'displayPublishTime', value: displayPublishTime},
    })
  }

  let coverUrl: string | undefined =
    post._embedded?.['wp:featuredmedia']?.[0]?.source_url

  if (!coverUrl && post.featured_media) {
    try {
      const mediaRes = await fetch(
        `${linkUrl.origin}/wp-json/wp/v2/media/${post.featured_media}`,
      )
      if (mediaRes.ok) {
        const media = await mediaRes.json()
        coverUrl = media?.source_url
      }
    } catch {}
  }

  if (coverUrl?.startsWith('http')) {
    try {
      const file = await downloadFile(coverUrl)
      const cid = await uploadFile(file)
      // const ipfsUrl = cid.startsWith('ipfs://') ? cid : `ipfs://${cid}`
      addChange({case: 'setMetadata', value: {key: 'cover', value: cid}})
    } catch (e) {
      console.warn('Cover upload failed:', (e as any)?.message || e)
    }
  }

  if (post.excerpt?.rendered) {
    const plain = stripHtml(post.excerpt.rendered)
    const decoded = decodeHtmlEntities(plain)
    addChange({
      case: 'setMetadata',
      value: {key: 'summary', value: decoded.trim()},
    })
  }

  changes.push(...changesForBlockNodes(blocks, ''))

  await grpcClient.documents.createDocumentChange({
    signingKeyName: signAccountUid,
    account: parentId.uid,
    path: hmIdPathToEntityQueryPath(docPath),
    changes,
  })
}

function toSlug(s: string): string {
  const decoded = decodeHtmlEntities(s || '')
  const ascii = decoded.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alnum → dash
    .replace(/^-+|-+$/g, '') // trim dashes
    .slice(0, 80) // keep it reasonable
}

function lastPathSegment(u: URL): string | null {
  const segs = u.pathname.split('/').filter(Boolean)
  return segs.length ? segs[segs.length - 1] : null
}

function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    hellip: '…',
    ndash: '–',
    mdash: '—',
    rsquo: '’',
    lsquo: '‘',
    rdquo: '”',
    ldquo: '“',
  }

  let out = input.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, ent) => {
    if (ent[0] === '#') {
      const code =
        ent[1].toLowerCase() === 'x'
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10)
      if (!Number.isNaN(code)) return String.fromCodePoint(code)
      return _
    }
    return ent in named ? named[ent] : _
  })

  // // Uncomment to remove brackets and trim space from ellipsis
  // out = out
  //   .replace(/\s*\[\s*(?:…|&hellip;|\.{3})\s*\]\s*$/i, '...')
  //   .replace(/…\s*$/, '...')
  //   .replace(/\s+(\.\.\.)$/, '...') // trim space before ...

  return out
}

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let i = 0
  let active = 0

  return new Promise((resolve, reject) => {
    const next = () => {
      if (i >= items.length && active === 0) return resolve(results)
      while (active < limit && i < items.length) {
        const idx = i++
        active++
        worker(items[idx], idx)
          .then((r) => (results[idx] = r))
          .catch(reject)
          .finally(() => {
            active--
            next()
          })
      }
    }
    next()
  })
}

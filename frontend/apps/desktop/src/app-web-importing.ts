import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared/constants'
import * as cheerio from 'cheerio'
import {readFile} from 'fs/promises'
import http from 'http'
import https from 'https'
import {nanoid} from 'nanoid'
import {join} from 'path'
import z from 'zod'
import {userDataPath} from './app-paths'
import {t} from './app-trpc'
import {PostsFile, ScrapeStatus, scrapeUrl} from './web-scraper'

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
      console.log('Imported site', importId)
    })
    .catch((error) => {
      importingStatus[importId] = {mode: 'error', error: error.message}
      console.error('Error importing site', importId, error)
    })
}

async function importPost({
  destinationId,
  signAccountUid,
  title,
  path,
  importId,
}: {
  destinationId: string
  signAccountUid: string
  title: string
  path: string
  importId: string
}) {
  const postOrigUrl = new URL(path)
  console.log('postOrigUrl pathname', postOrigUrl.pathname)
  const postHtml = await readFile(
    join(
      userDataPath,
      'importer',
      'imports',
      importId,
      'pages',
      postOrigUrl.pathname,
    ),
  )
  console.log('postHtml', !!postHtml)
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
        join(userDataPath, 'importer', 'imports', importId, 'posts.json'),
      )
      const posts = JSON.parse(postsData.toString()) as PostsFile
      for (const post of posts) {
        const {path, title} = post
        await importPost({
          destinationId,
          signAccountUid,
          title,
          path,
        })
      }
      console.log('Will import', posts.length, 'posts')
      console.log({importId, destinationId, signAccountUid})
      return {}
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

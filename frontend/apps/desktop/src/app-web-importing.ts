import {PartialMessage} from '@bufbuild/protobuf'
import {Block, DocumentChange} from '@shm/shared/client/grpc-types'
import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared/constants'
import {hmIdPathToEntityQueryPath, unpackHmId} from '@shm/shared/utils'
import * as cheerio from 'cheerio'
import {readFile} from 'fs/promises'
import http from 'http'
import https from 'https'
import {nanoid} from 'nanoid'
import {join, resolve} from 'path'
import z from 'zod'
import {grpcClient} from './app-grpc'
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
  const postHtmlPath = join(
    userDataPath,
    'importer',
    'scrapes',
    importId,
    'pages',
    post.htmlFile,
  )
  const postHtml = await readFile(postHtmlPath)
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
  const $ = cheerio.load(postHtml)
  const elements: Array<
    {type: 'Text'; text: string} | {type: 'Image'; link: string | null}
  > = []

  await Promise.all(
    $('body')
      .children()
      .map(async (_, el) => {
        const $el = $(el)

        if ($el.is('p')) {
          const text = $el.text().trim()
          if (text) {
            elements.push({type: 'Text', text})
          }
        } else if ($el.is('figure')) {
          const img = $el.find('img')
          if (img.length) {
            const src = img.attr('src')
            if (src) {
              const absoluteImageUrl = resolve(postHtmlPath, '..', src)
              const uploadedCID = await uploadLocalFile(absoluteImageUrl)
              if (uploadedCID) {
                elements.push({type: 'Image', link: `ipfs://${uploadedCID}`})
              }
            }
          }
        }
      }),
  )

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
  const blocks: PartialMessage<Block>[] = elements
    .map((element) => {
      if (element.type === 'Text') {
        return {
          id: nanoid(8),
          type: 'Paragraph',
          text: element.text,
          revision: '',
          link: '',
          attributes: {},
          annotations: [],
        }
      } else if (element.type === 'Image') {
        return {
          id: nanoid(8),
          type: 'Image',
          link: element.link || '',
          revision: '',
          text: '',
          attributes: {},
          annotations: [],
        }
      }
      return null
    })
    .filter((block) => block !== null)
  let lastPlacedBlockId = ''

  blocks.forEach((block) => {
    addChange({
      case: 'moveBlock',
      value: {
        blockId: block.id,
        parent: '',
        leftSibling: lastPlacedBlockId,
      },
    })
    addChange({
      case: 'replaceBlock',
      value: block,
    })
    lastPlacedBlockId = block.id || ''
  })
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

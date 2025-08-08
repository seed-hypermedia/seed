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
import {fetchAndSaveWpPosts} from './wordpress-import'

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
      console.error('Error importing site', url, error)
      importingStatus[importId] = {mode: 'error', error: error.message}
    })
}

async function importWpSite(url: string, importId: string) {
  return await fetchAndSaveWpPosts(url, importId)
  // (status) => {
  //   importingStatus[importId] = {...status, mode: 'scraping'}
  // }
}

export function startWpImport(siteUrl: string, importId: string) {
  importingStatus[importId] = {mode: 'importing'}
  console.log('here???????')
  importWpSite(siteUrl, importId)
    .then((result) => {
      console.log(result)
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
  importWpSite: t.procedure
    .input(z.object({url: z.string()}).strict())
    .mutation(async ({input}) => {
      const importId = nanoid(10)
      startWpImport(input.url, importId)
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

/**
 * WordPress WXR import orchestration.
 * Coordinates parsing, author key generation, and document creation.
 */
import {DocumentChange} from '@shm/shared/client/grpc-types'
import {Role} from '@shm/shared/client/.generated/documents/v3alpha/access_control_pb'
import {hmIdPathToEntityQueryPath} from '@shm/shared'
import {htmlToBlocks} from '@shm/shared/html-to-blocks'
import {nanoid} from 'nanoid'
import {grpcClient} from './app-grpc'
import {uploadFile} from './app-web-importing'
import {parseWXR, WXRParseResult, WXRPost} from './wxr-parser'
import {
  createAuthorKeyName,
  extractSlugFromLink,
  fallbackAuthorLogin,
  getAuthorDisplayName,
  isEmailUsableForAuthored,
  normalizeAuthorLogin,
  normalizeWXRSlug,
} from './wxr-import-utils'
import {createImportFile, parseImportFile, SeedImportData, SeedImportFileV1, serializeImportFile} from './wxr-crypto'
import {
  clearImportState,
  getImportFile,
  getImportState,
  markImportComplete,
  markImportError,
  setImportFile,
  setImportState,
  updateImportProgress,
  WXRImportState,
} from './wxr-import-store'
import http from 'http'
import https from 'https'

export interface WXRImportOptions {
  // The WXR file content.
  wxrContent: string

  // Destination space UID.
  destinationUid: string

  // Destination path within the space.
  destinationPath: string[]

  // Publisher's signing key name.
  publisherKeyName: string

  // Import mode.
  mode: 'ghostwritten' | 'authored'

  // Password for authored mode (to encrypt author keys).
  password?: string

  // Overwrite existing documents at same path (default: false).
  overwriteExisting?: boolean

  // Progress callback.
  onProgress?: (progress: ImportProgress) => void
}

export interface ImportResultItem {
  path: string[]
  title: string
}

export interface ImportResults {
  imported: number
  skipped: ImportResultItem[]
  failed: Array<ImportResultItem & {error: string}>
}

export interface ImportProgress {
  phase: 'parsing' | 'authors' | 'posts' | 'complete' | 'error'
  total: number
  completed: number
  currentItem?: string
  error?: string
  results?: ImportResults
}

/**
 * Start a new WXR import.
 */
export async function startWXRImport(options: WXRImportOptions): Promise<string> {
  const {wxrContent, destinationUid, destinationPath, publisherKeyName, mode, overwriteExisting = false} = options

  const onProgress = options.onProgress || (() => {})

  // Parse WXR file.
  onProgress({phase: 'parsing', total: 0, completed: 0})
  const wxr = parseWXR(wxrContent)

  // Create import data structure (async for authored mode to generate mnemonics).
  const importData = await createImportData(wxr, mode)

  // Create import state.
  const importId = nanoid(10)
  const state: WXRImportState = {
    importId,
    isAuthored: mode === 'authored',
    destinationUid,
    destinationPath,
    publisherKeyName,
    overwriteExisting,
    phase: 'pending',
    totalPosts: importData.posts.length,
    importedPosts: 0,
    lastUpdated: Date.now(),
  }

  // Save state and import file.
  setImportState(state)

  const importFile = createImportFile(importData, options.password)
  setImportFile(importFile)

  // Start execution in background (don't await - return immediately so UI can show progress).
  executeImport(state, importData, onProgress).catch((error) => {
    console.error('WXR import failed:', error)
    markImportError(error instanceof Error ? error.message : 'Unknown error')
  })

  return importId
}

/**
 * Resume an existing import.
 */
export async function resumeWXRImport(
  password?: string,
  onProgress?: (progress: ImportProgress) => void,
): Promise<void> {
  const state = getImportState()
  if (!state) {
    throw new Error('No import to resume')
  }

  const importFile = getImportFile()
  if (!importFile) {
    throw new Error('Import file not found')
  }

  const data = parseImportFile(serializeImportFile(importFile), password)

  await executeImport(state, data, onProgress)
}

/**
 * Execute the import process.
 */
async function executeImport(
  state: WXRImportState,
  data: SeedImportData,
  onProgress?: (progress: ImportProgress) => void,
): Promise<void> {
  const progress = onProgress || (() => {})

  try {
    const authorKeyScope = `${state.destinationUid}:${data.source.siteUrl}`

    // Phase: Register/verify author keys (for authored mode).
    // This runs on both initial import and resume to ensure keys exist.
    if (state.isAuthored) {
      const isInitialRun = state.phase === 'pending'
      if (isInitialRun) {
        state.phase = 'authors'
        setImportState(state)
      }

      const authoredEligibleLogins = Object.entries(data.authors)
        .filter(([, author]) => isEmailUsableForAuthored(author.email))
        .map(([login]) => login)
      progress({
        phase: 'authors',
        total: authoredEligibleLogins.length,
        completed: 0,
      })

      // Get list of existing keys to check if author keys need registration.
      const existingKeys = await grpcClient.daemon.listKeys({})
      const existingKeysByName = new Map(existingKeys.keys.map((key) => [key.name, key]))

      let authorCount = 0
      for (const login of authoredEligibleLogins) {
        const author = data.authors[login]
        const keyName = createAuthorKeyName(authorKeyScope, login)
        const existingKey = existingKeysByName.get(keyName)

        if (author.mnemonic && !existingKey) {
          // Register key for this author.
          const result = await grpcClient.daemon.registerKey({
            mnemonic: author.mnemonic,
            name: keyName,
          })
          author.publicKey = result.publicKey

          // Update saved data with public key.
          const file = getImportFile()
          if (file && !file.encrypted) {
            ;(file.data as SeedImportData).authors[login] = author
            setImportFile(file)
          }
        } else if (existingKey && !author.publicKey) {
          author.publicKey = existingKey.publicKey
        }
        authorCount++
        progress({
          phase: 'authors',
          total: authoredEligibleLogins.length,
          completed: authorCount,
          currentItem: author.displayName,
        })
      }
    }

    // Phase: Import posts.
    state.phase = 'posts'
    setImportState(state)

    const remainingPosts = data.posts.filter((p) => !p.imported)

    // Initialize results tracking.
    const results: ImportResults = {
      imported: 0,
      skipped: [],
      failed: [],
    }

    progress({
      phase: 'posts',
      total: data.posts.length,
      completed: state.importedPosts,
    })

    // Create a shared image cache for the import session.
    const imageCache = new Map<string, string>()
    const existingWriterCapsByPath = new Map<string, Set<string>>()

    for (const postInfo of remainingPosts) {
      // Look up full post data from wxrPosts map.
      const wxrPost = data.wxrPosts[postInfo.id]
      if (!wxrPost) {
        console.warn(`WXR post data not found for ID ${postInfo.id}, skipping`)
        continue
      }

      const postPath = [...state.destinationPath, ...postInfo.path]
      const postTitle = wxrPost.title || `Post ${postInfo.id}`

      progress({
        phase: 'posts',
        total: data.posts.length,
        completed: state.importedPosts,
        currentItem: postTitle,
      })

      const normalizedAuthorLogin = normalizeAuthorLogin(postInfo.authorLogin) || fallbackAuthorLogin(postInfo.id)
      const author = data.authors[normalizedAuthorLogin]
      const authorDisplayName = getAuthorDisplayName(
        normalizedAuthorLogin || fallbackAuthorLogin(postInfo.id),
        author?.displayName,
      )
      const canUseAuthoredSigner =
        state.isAuthored && !!author && isEmailUsableForAuthored(author.email) && !!author.publicKey

      const displayAuthor = state.isAuthored && canUseAuthoredSigner ? undefined : authorDisplayName

      // Determine signing key - use author's key for authored mode, publisher's key for ghostwritten.
      const signingKeyName = canUseAuthoredSigner
        ? createAuthorKeyName(authorKeyScope, normalizedAuthorLogin)
        : state.publisherKeyName

      // In authored mode, grant write capability to the author's ephemeral key for this specific post path.
      if (canUseAuthoredSigner && author?.publicKey) {
        const pathQuery = hmIdPathToEntityQueryPath(postPath)
        let delegates = existingWriterCapsByPath.get(pathQuery)

        if (!delegates) {
          const existingCaps = await grpcClient.accessControl.listCapabilities({
            account: state.destinationUid,
            path: pathQuery,
          })
          delegates = new Set(
            existingCaps.capabilities.filter((cap) => cap.role === Role.WRITER).map((cap) => cap.delegate),
          )
          existingWriterCapsByPath.set(pathQuery, delegates)
        }

        if (!delegates.has(author.publicKey)) {
          await grpcClient.accessControl.createCapability({
            account: state.destinationUid,
            delegate: author.publicKey,
            role: Role.WRITER,
            path: pathQuery,
            signingKeyName: state.publisherKeyName,
          })
          delegates.add(author.publicKey)
        }
      }

      // Create the document.
      try {
        const result = await importPost(
          {
            id: wxrPost.id,
            title: wxrPost.title,
            slug: wxrPost.slug,
            content: wxrPost.content,
            postDateGmt: wxrPost.postDateGmt,
            categories: wxrPost.categories,
            tags: wxrPost.tags,
          },
          {
            destinationUid: state.destinationUid,
            documentPath: postPath,
            signingKeyName,
            displayAuthor,
            imageCache,
            overwriteExisting: state.overwriteExisting,
          },
        )

        if (result === 'skipped') {
          results.skipped.push({path: postPath, title: postTitle})
        } else {
          results.imported++
        }
      } catch (error) {
        console.error(`Failed to import post ${postInfo.id}:`, error)
        results.failed.push({
          path: postPath,
          title: postTitle,
          error:
            error instanceof Error
              ? `[author=${normalizedAuthorLogin || 'unknown'}][signing=${signingKeyName}] ${error.message}`
              : 'Unknown error',
        })
        // Continue with next post instead of failing the entire import.
      }

      // Mark as processed (imported, skipped, or failed).
      postInfo.imported = true
      state.importedPosts++
      updateImportProgress(postInfo.id, state.importedPosts)

      // Update saved file.
      const file = getImportFile()
      if (file && !file.encrypted) {
        const idx = (file.data as SeedImportData).posts.findIndex((p) => p.id === postInfo.id)
        if (idx >= 0) {
          ;(file.data as SeedImportData).posts[idx].imported = true
        }
        setImportFile(file)
      }
    }

    // Mark complete with results.
    markImportComplete(results)
    progress({
      phase: 'complete',
      total: data.posts.length,
      completed: data.posts.length,
      results,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    markImportError(errorMessage)
    progress({
      phase: 'error',
      total: state.totalPosts,
      completed: state.importedPosts,
      error: errorMessage,
    })
    throw error
  }
}

/**
 * Create import data from parsed WXR.
 */
async function createImportData(wxr: WXRParseResult, mode: string): Promise<SeedImportData> {
  const authors: SeedImportData['authors'] = {}
  const allPosts = [...wxr.posts, ...wxr.pages]
  const pagesById = new Map<number, WXRPost>()
  const pagePathCache = new Map<number, string[]>()

  for (const post of allPosts) {
    if (post.type === 'page' && post.id > 0) {
      pagesById.set(post.id, post)
    }
  }

  const resolvePagePath = (page: WXRPost, visiting: Set<number>): string[] => {
    const cached = pagePathCache.get(page.id)
    if (cached) return cached

    const ownSlug = normalizeWXRSlug(page.slug, page.id)

    if (visiting.has(page.id)) {
      return [ownSlug]
    }

    visiting.add(page.id)

    let parentPath: string[] = []
    if (page.parentId && page.parentId > 0) {
      const parent = pagesById.get(page.parentId)
      if (parent) {
        parentPath = resolvePagePath(parent, visiting)
      }
    }

    visiting.delete(page.id)

    const resolved = [...parentPath, ownSlug]
    pagePathCache.set(page.id, resolved)
    return resolved
  }

  // Build author entries from declared WXR author metadata.
  for (const author of wxr.authors) {
    const login = normalizeAuthorLogin(author.login)
    if (!login) continue

    const email = (author.email || '').trim()
    const displayName = getAuthorDisplayName(login, author.displayName)
    const hasUsableEmail = isEmailUsableForAuthored(email)

    authors[login] = {
      displayName,
      email,
      // Generate mnemonics only for authors that can sign in authored mode.
      mnemonic: mode === 'authored' && hasUsableEmail ? await generateMnemonic() : undefined,
    }
  }

  // Build post list with paths and wxrPosts map.
  const posts: SeedImportData['posts'] = []
  const wxrPosts: SeedImportData['wxrPosts'] = {}

  for (const post of allPosts) {
    if (post.status !== 'publish') continue

    const authorLogin = normalizeAuthorLogin(post.authorLogin) || fallbackAuthorLogin(post.id)

    if (!authors[authorLogin]) {
      authors[authorLogin] = {
        displayName: getAuthorDisplayName(authorLogin),
        email: '',
      }
    }

    // For posts, use the last segment of the <link> URL as the slug, which is
    // the canonical URL slug WordPress serves (may differ from wp:post_name).
    // Fall back to wp:post_name if the link is missing or unparseable.
    const linkSlug = post.type === 'post' ? extractSlugFromLink(post.link) : null
    const normalizedSlug = normalizeWXRSlug(linkSlug || post.slug, post.id)

    let path: string[]
    if (post.type === 'post') {
      path = ['posts', normalizedSlug]
    } else if (post.type === 'page') {
      path = resolvePagePath(post, new Set<number>())
    } else {
      path = [normalizedSlug]
    }

    posts.push({
      id: post.id,
      path,
      authorLogin,
      imported: false,
    })

    // Store post data needed for actual import.
    wxrPosts[post.id] = {
      id: post.id,
      title: post.title,
      slug: normalizedSlug,
      content: post.content,
      postDateGmt: post.postDateGmt,
      categories: post.categories,
      tags: post.tags,
    }
  }

  return {
    source: {
      type: 'wordpress-wxr',
      siteTitle: wxr.siteTitle,
      siteUrl: wxr.siteUrl,
      exportDate: new Date().toISOString(),
    },
    authors,
    imageCache: {},
    progress: {
      totalPosts: posts.length,
      importedPosts: 0,
      phase: 'pending',
    },
    posts,
    wxrPosts,
  }
}

/**
 * Generate a BIP39-compatible mnemonic using the daemon.
 */
async function generateMnemonic(): Promise<string[]> {
  const result = await grpcClient.daemon.genMnemonic({})
  return result.mnemonic
}

/**
 * Sanitize a taxonomy value (category or tag name) for storage.
 * Replaces commas with spaces, collapses multiple spaces, and trims.
 */
function sanitizeTaxonomyValue(name: string): string {
  return name
    .replace(/,/g, ' ') // Replace commas with spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces into single space
    .trim() // Trim leading/trailing whitespace
}

/**
 * Build a comma-separated string from an array of taxonomy values.
 * Returns null if the result would be empty.
 */
function buildTaxonomyString(values: string[]): string | null {
  const sanitized = values.map(sanitizeTaxonomyValue).filter((v) => v.length > 0) // Remove empty values
  return sanitized.length > 0 ? sanitized.join(',') : null
}

/**
 * Minimal post data needed for import.
 */
type ImportablePost = Pick<WXRPost, 'id' | 'title' | 'slug' | 'content' | 'postDateGmt' | 'categories' | 'tags'>

export type ImportPostResult = 'imported' | 'skipped'

/**
 * Import a single post as a document.
 * Returns 'imported' if a new document was created, 'skipped' if the document already exists.
 */
export async function importPost(
  post: ImportablePost,
  options: {
    destinationUid: string
    documentPath: string[]
    signingKeyName: string
    displayAuthor?: string
    imageCache: Map<string, string>
    overwriteExisting?: boolean
  },
): Promise<ImportPostResult> {
  const {destinationUid, documentPath, signingKeyName, displayAuthor, overwriteExisting = false} = options

  // Build the document path.
  const docPath = documentPath
  const pathString = hmIdPathToEntityQueryPath(docPath)

  // Check if document already exists at this path.
  let baseVersion: string | undefined
  try {
    const existingDoc = await grpcClient.documents.getDocument({
      account: destinationUid,
      path: pathString,
    })
    // If we got here without error, the document exists.
    if (!overwriteExisting) {
      // Document exists and we're not overwriting - skip it.
      console.log(`Document already exists at ${pathString}, skipping (overwrite disabled)`)
      return 'skipped'
    }
    // Document exists and we want to overwrite - get the version for base_version.
    baseVersion = existingDoc.version
    console.log(`Document exists at ${pathString}, overwriting (base_version: ${baseVersion})`)
  } catch {
    // Document doesn't exist (expected for new imports), proceed with creation.
  }

  // Convert HTML content to blocks.
  const blocks = await htmlToBlocks(post.content, '', {
    uploadLocalFile: async () => null,
    resolveHMLink: async (href) => href,
  })

  // Build document changes.
  const changes: DocumentChange[] = []

  // Set metadata.
  changes.push(
    new DocumentChange({
      op: {
        case: 'setMetadata',
        value: {key: 'name', value: post.title},
      },
    }),
  )

  if (post.postDateGmt) {
    changes.push(
      new DocumentChange({
        op: {
          case: 'setMetadata',
          value: {
            key: 'displayPublishTime',
            value: new Date(post.postDateGmt).toDateString(),
          },
        },
      }),
    )
  }

  // For ghostwritten mode, store original author as displayAuthor.
  if (displayAuthor) {
    changes.push(
      new DocumentChange({
        op: {
          case: 'setMetadata',
          value: {key: 'displayAuthor', value: displayAuthor},
        },
      }),
    )
  }

  // Store imported categories.
  const categoriesValue = buildTaxonomyString(post.categories)
  if (categoriesValue) {
    changes.push(
      new DocumentChange({
        op: {
          case: 'setMetadata',
          value: {key: 'importCategories', value: categoriesValue},
        },
      }),
    )
  }

  // Store imported tags.
  const tagsValue = buildTaxonomyString(post.tags)
  if (tagsValue) {
    changes.push(
      new DocumentChange({
        op: {
          case: 'setMetadata',
          value: {key: 'importTags', value: tagsValue},
        },
      }),
    )
  }

  // Add blocks.
  changes.push(...blocksToChanges(blocks))

  // Create or update the document.
  await grpcClient.documents.createDocumentChange({
    signingKeyName,
    account: destinationUid,
    path: pathString,
    changes,
    baseVersion: baseVersion || '',
  })

  return 'imported'
}

/**
 * Convert blocks to document changes.
 */
function blocksToChanges(blocks: any[], parentId = ''): DocumentChange[] {
  const changes: DocumentChange[] = []
  let lastBlockId = ''

  for (const node of blocks) {
    const block = node.block || node

    changes.push(
      new DocumentChange({
        op: {
          case: 'moveBlock',
          value: {
            blockId: block.id,
            parent: parentId,
            leftSibling: lastBlockId,
          },
        },
      }),
    )

    changes.push(
      new DocumentChange({
        op: {
          case: 'replaceBlock',
          value: block,
        },
      }),
    )

    lastBlockId = block.id || ''

    if (node.children) {
      changes.push(...blocksToChanges(node.children, block.id))
    }
  }

  return changes
}

/**
 * Download and upload an image, returning its CID.
 */
async function downloadAndUploadImage(url: string, cache: Map<string, string>): Promise<string | null> {
  if (cache.has(url)) {
    return cache.get(url) || null
  }

  try {
    const blob = await downloadFile(url)
    const cid = await uploadFile(blob)
    cache.set(url, cid)
    return cid
  } catch (error) {
    console.error(`Failed to download image: ${url}`, error)
    return null
  }
}

/**
 * Download a file from URL.
 */
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
        } else if (response.statusCode === 301 || response.statusCode === 302) {
          // Follow redirects.
          const location = response.headers.location
          if (location) {
            downloadFile(location).then(resolve).catch(reject)
          } else {
            reject(new Error(`Redirect without location header`))
          }
        } else {
          reject(new Error(`Failed to download file: ${response.statusCode}`))
        }
      })
      .on('error', reject)
  })
}

/**
 * Cancel and clean up the current import.
 */
export function cancelWXRImport(): void {
  clearImportState()
}

/**
 * Check if there's an import in progress.
 */
export function hasActiveImport(): boolean {
  const state = getImportState()
  return state !== null && state.phase !== 'complete' && state.phase !== 'error'
}

/**
 * Get current import status.
 */
export function getImportStatus(): WXRImportState | null {
  return getImportState()
}

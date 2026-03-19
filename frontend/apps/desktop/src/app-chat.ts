import {createAnthropic} from '@ai-sdk/anthropic'
import {createGoogleGenerativeAI} from '@ai-sdk/google'
import {createOpenAI} from '@ai-sdk/openai'
import {HMBlockNode, HMComment, HMCommentSchema} from '@seed-hypermedia/client/hm-types'
import {extractViewTermFromUrl, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {jsonSchema, stepCountIs, streamText, type ModelMessage} from 'ai'
import crypto from 'crypto'
import {ipcMain} from 'electron'
import fs from 'fs/promises'
import path from 'path'
import z from 'zod'
import {readConfig, resolveProviderForUsage, setLastUsedProvider, type AgentProvider} from './app-ai-config'
import {appInvalidateQueries} from './app-invalidation'
import {userDataPath} from './app-paths'
import {t} from './app-trpc'
import {getAllWindows} from './app-windows'
import {navigateDesktopUrl} from './assistant-navigation'
import {executeChatSearch} from './chat-search'
import {getChatProviderRequestOptions} from './chat-provider-options'
import {resolveChatStreamError} from './chat-stream-error'
import {desktopRequest} from './desktop-api'
import {grpcClient} from './grpc-client'
import * as log from './logger'
import {
  appendChatTextPart,
  appendChatToolCalls,
  applyChatToolResults,
  type ChatMessagePart,
  type ChatToolCall,
  type ChatToolResult,
} from './models/chat-parts'
import {resolveOmnibarUrlToHypermediaUrl} from './omnibar-url'

const chatDir = path.join(userDataPath, 'chat-sessions')

/** A persisted chat message within a local assistant session. */
export type ChatMessage = {
  role: 'user' | 'assistant' | 'tool'
  content: string
  errorMessage?: string
  isError?: boolean
  parts?: ChatMessagePart[]
  toolCalls?: ChatToolCall[]
  toolResults?: ChatToolResult[]
  createdAt: string
}

type ChatSession = {
  id: string
  title: string
  providerId?: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

async function ensureChatDir() {
  await fs.mkdir(chatDir, {recursive: true})
}

function sessionPath(sessionId: string) {
  return path.join(chatDir, `${sessionId}.json`)
}

async function readSession(sessionId: string): Promise<ChatSession | null> {
  try {
    const content = await fs.readFile(sessionPath(sessionId), 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

async function writeSession(session: ChatSession): Promise<void> {
  await ensureChatDir()
  await fs.writeFile(sessionPath(session.id), JSON.stringify(session, null, 2), 'utf-8')
}

async function listSessions(): Promise<Array<{id: string; title: string; createdAt: string; updatedAt: string}>> {
  await ensureChatDir()
  const files = await fs.readdir(chatDir)
  const sessions: Array<{id: string; title: string; createdAt: string; updatedAt: string}> = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const content = await fs.readFile(path.join(chatDir, file), 'utf-8')
      const session: ChatSession = JSON.parse(content)
      sessions.push({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      })
    } catch {
      // skip corrupt files
    }
  }
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return sessions
}

function broadcastChatEvent(event: {type: string; sessionId: string; [key: string]: any}) {
  getAllWindows().forEach((window) => {
    window.webContents.send('chatStreamEvent', event)
  })
}

// Active stream abort controllers, keyed by sessionId
const activeStreams = new Map<string, AbortController>()

ipcMain.on('chatStopStream', (_, sessionId: string) => {
  const controller = activeStreams.get(sessionId)
  if (controller) {
    controller.abort()
    activeStreams.delete(sessionId)
  }
})

/**
 * Resolves the preferred provider order against the currently configured providers.
 */
export function resolveConfiguredProvider(
  providers: AgentProvider[],
  preferredProviderIds: Array<string | null | undefined>,
): AgentProvider | undefined {
  for (const providerId of preferredProviderIds) {
    if (!providerId) continue
    const provider = providers.find((candidate) => candidate.id === providerId)
    if (provider) return provider
  }
  return providers[0]
}

// Provider model factory

function createProviderModel(provider: AgentProvider) {
  switch (provider.type) {
    case 'openai': {
      if (provider.authMode === 'login') {
        const accessToken = provider.openaiAuth?.accessToken
        if (!accessToken) {
          throw new Error('OpenAI login is missing an access token. Reconnect in Settings > Assistant Providers.')
        }

        const openai = createOpenAI({
          apiKey: accessToken,
          baseURL: provider.baseUrl || 'https://chatgpt.com/backend-api/codex',
          headers: {
            ...(provider.openaiAuth?.chatgptAccountId
              ? {'ChatGPT-Account-ID': provider.openaiAuth.chatgptAccountId}
              : {}),
          },
        })
        return openai(provider.model)
      }

      if (!provider.apiKey) {
        throw new Error('OpenAI credentials are missing. Reconnect in Settings > Assistant Providers.')
      }
      const openai = createOpenAI({
        apiKey: provider.apiKey,
        ...(provider.baseUrl ? {baseURL: provider.baseUrl} : {}),
      })
      return openai.chat(provider.model)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: provider.apiKey,
        ...(provider.baseUrl ? {baseURL: provider.baseUrl} : {}),
      })
      return anthropic(provider.model)
    }
    case 'gemini': {
      if (!provider.apiKey) {
        throw new Error('Gemini credentials are missing. Reconnect in Settings > Assistant Providers.')
      }
      const google = createGoogleGenerativeAI({
        apiKey: provider.apiKey,
        ...(provider.baseUrl ? {baseURL: provider.baseUrl} : {}),
      })
      return google(provider.model)
    }
    case 'ollama': {
      const ollama = createOpenAI({
        baseURL: (provider.baseUrl || 'http://localhost:11434') + '/v1',
        apiKey: 'ollama',
      })
      return ollama.chat(provider.model)
    }
    default:
      throw new Error(`Unsupported provider type: ${(provider as any).type}`)
  }
}

/**
 * Parse a URL, extracting any view term suffix.
 * e.g. "hm://z6Mk.../path/:comments" → {id, viewTerm: "comments"}
 * e.g. "hm://z6Mk.../path/:directory" → {id, viewTerm: "directory"}
 * e.g. "hm://z6Mk.../path" → {id, viewTerm: null}
 */
function parseDocumentUrl(url: string) {
  const extracted = extractViewTermFromUrl(url)
  const cleanUrl = extracted.url
  const id = unpackHmId(cleanUrl)
  if (!id) return null

  return {
    id,
    viewTerm: extracted.viewTerm ? extracted.viewTerm.slice(1) : null,
    viewArg: extracted.commentId || extracted.activityFilter || extracted.accountUid,
  }
}

// Helper: convert HMBlockNode[] to markdown
function blockNodesToMarkdown(nodes: HMBlockNode[], depth = 0, listType?: string): string {
  const parts: string[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (!node.block) continue
    const block = node.block as any
    const text = block.text || ''
    const attrs = block.attributes || {}
    const childrenType: string | undefined =
      typeof attrs?.toJson === 'function'
        ? attrs.toJson({emitDefaultValues: true, enumAsInteger: false})?.childrenType
        : attrs?.childrenType

    let blockMd = ''
    switch (block.type) {
      case 'Heading': {
        const level = '#'.repeat(Math.min((block.attributes?.level || depth) + 1, 6))
        blockMd = `${level} ${text}`
        break
      }
      case 'Code': {
        const lang = block.attributes?.language || ''
        blockMd = '```' + lang + '\n' + text + '\n```'
        break
      }
      case 'Math':
        blockMd = '$$\n' + text + '\n$$'
        break
      case 'Image':
        blockMd = `![${text || ''}](${block.link || block.ref || ''})`
        break
      case 'Video':
        blockMd = `[Video: ${text || block.link || ''}]`
        break
      case 'File':
        blockMd = `[File: ${text || block.link || ''}]`
        break
      case 'Embed':
        blockMd = `[Embed: ${block.link || ''}]`
        break
      case 'Button':
        blockMd = `[${text || 'Button'}](${block.link || ''})`
        break
      case 'WebEmbed':
        blockMd = `[Web: ${block.link || text || ''}]`
        break
      default:
        if (text) {
          if (listType === 'Unordered') {
            blockMd = `${'  '.repeat(Math.max(depth - 1, 0))}- ${text}`
          } else if (listType === 'Ordered') {
            blockMd = `${'  '.repeat(Math.max(depth - 1, 0))}${i + 1}. ${text}`
          } else if (listType === 'Blockquote') {
            blockMd = `> ${text}`
          } else {
            blockMd = text
          }
        }
    }

    if (blockMd) parts.push(blockMd)
    if (node.children?.length) {
      parts.push(blockNodesToMarkdown(node.children, depth + 1, childrenType))
    }
  }
  return parts.join('\n\n')
}

// Helper: parse a comment from gRPC response
function parseComment(raw: any): HMComment | null {
  const json = typeof raw.toJson === 'function' ? raw.toJson({emitDefaultValues: true, enumAsInteger: false}) : raw
  const parsed = HMCommentSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

// Helper: get metadata as plain object from gRPC Struct
function getPlainMetadata(metadata: any): Record<string, any> | null {
  if (!metadata) return null
  if (typeof metadata.toJson === 'function') {
    return metadata.toJson({emitDefaultValues: true, enumAsInteger: false})
  }
  return metadata
}

// Helper: resolve account UIDs to display names, with caching within a single read call
async function resolveAccountNames(uids: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(uids.filter(Boolean)))
  const names: Record<string, string> = {}
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const result = await desktopRequest('Account', uid)
        if (result.type === 'account' && result.metadata?.name) {
          names[uid] = result.metadata.name
        } else {
          names[uid] = uid.slice(0, 12) + '...'
        }
      } catch {
        names[uid] = uid.slice(0, 12) + '...'
      }
    }),
  )
  return names
}

function displayName(names: Record<string, string>, uid: string | undefined): string {
  if (!uid) return 'unknown'
  return names[uid] || uid.slice(0, 12) + '...'
}

async function readResourceTitle(id: ReturnType<typeof unpackHmId>): Promise<string | undefined> {
  if (!id) return undefined

  try {
    const result = await desktopRequest('ResourceMetadata', id)
    const metadata = getPlainMetadata(result.metadata)
    return typeof metadata?.name === 'string' && metadata.name ? metadata.name : undefined
  } catch {
    return undefined
  }
}

async function readSiteName(uid: string): Promise<string | undefined> {
  const homeId = unpackHmId(`hm://${uid}`)
  if (!homeId) return undefined
  return readResourceTitle(homeId)
}

function formatDocumentDisplayLabel(title?: string, siteName?: string): string {
  if (title && siteName && title !== siteName) {
    return `${title} in ${siteName}`
  }
  return title || siteName || 'Untitled document'
}

function formatCommentsDisplayLabel(title?: string): string {
  return title ? `${title} Comments` : 'Comments'
}

type ChatReadToolView = 'document' | 'comments' | 'directory' | 'versions' | 'citations' | 'collaborators'

type ChatReadToolOutput = {
  summary: string
  resourceUrl: string
  view: ChatReadToolView
  markdown: string
  title?: string
  displayLabel?: string
}

function createToolErrorOutput(summary: string, extra: Record<string, unknown> = {}) {
  return {
    summary,
    isError: true,
    ...extra,
  }
}

function describeReadView(view: ChatReadToolView): string {
  switch (view) {
    case 'document':
      return 'document'
    case 'comments':
      return 'comments'
    case 'directory':
      return 'directory'
    case 'versions':
      return 'version history'
    case 'citations':
      return 'citations'
    case 'collaborators':
      return 'collaborators'
  }
}

function createReadToolOutput(input: {
  url: string
  view: ChatReadToolView
  markdown: string
  title?: string
  displayLabel?: string
}): ChatReadToolOutput {
  return {
    summary:
      input.view === 'document'
        ? `Read ${input.title ? `"${input.title}"` : 'the document'}.`
        : `Read the ${describeReadView(input.view)} view.`,
    resourceUrl: input.url,
    view: input.view,
    markdown: input.markdown,
    ...(input.title ? {title: input.title} : {}),
    ...(input.displayLabel ? {displayLabel: input.displayLabel} : {}),
  }
}

function summarizeToolOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object' && 'summary' in output && typeof output.summary === 'string') {
    return output.summary
  }
  if (output === undefined) return 'Completed.'

  try {
    return JSON.stringify(output)
  } catch {
    return String(output)
  }
}

// Read handlers for each view type

async function readDocument(id: ReturnType<typeof unpackHmId>) {
  if (!id) return 'Error: invalid document ID'
  const doc = await grpcClient.documents.getDocument({
    account: id.uid,
    path: hmIdPathToEntityQueryPath(id.path),
    version: id.version || undefined,
  })
  const metadata = getPlainMetadata(doc.metadata)
  const title = metadata?.name || 'Untitled'
  const content = doc.content ? blockNodesToMarkdown(doc.content as HMBlockNode[]) : '(empty document)'
  return {
    title,
    markdown: `# ${title}\n\n${content}`,
  }
}

async function readComments(id: ReturnType<typeof unpackHmId>, commentId?: string) {
  if (!id) return 'Error: invalid document ID'
  const res = await grpcClient.comments.listComments({
    targetAccount: id.uid,
    targetPath: hmIdPathToEntityQueryPath(id.path),
    pageSize: 100,
  })
  const parsed = res.comments.map(parseComment).filter((c): c is HMComment => c !== null)
  if (parsed.length === 0) return 'No comments found on this document.'
  const selectedComments =
    commentId && parsed.some((comment) => comment.id === commentId)
      ? parsed.filter((comment) => comment.id === commentId)
      : parsed
  const authorUids = selectedComments.map((c) => c.author).filter(Boolean) as string[]
  const names = await resolveAccountNames(authorUids)
  const comments: string[] = []
  for (const c of selectedComments) {
    const content = c.content ? blockNodesToMarkdown(c.content as HMBlockNode[]) : ''
    const replyInfo = c.replyParent ? ` (reply to ${c.replyParent})` : ''
    comments.push(`**${displayName(names, c.author)}**${replyInfo}:\n${content}`)
  }
  return {
    markdown: `## Comments\n\n${comments.join('\n\n---\n\n')}`,
    commentAuthorName:
      commentId && selectedComments.length === 1 ? displayName(names, selectedComments[0].author) : undefined,
  }
}

async function readDirectory(id: ReturnType<typeof unpackHmId>) {
  if (!id) return 'Error: invalid document ID'
  const apiPath = hmIdPathToEntityQueryPath(id.path)
  const res = await grpcClient.documents.listDirectory({
    account: id.uid,
    directoryPath: apiPath,
  })
  const children: string[] = []
  for (const doc of res.documents) {
    const docPath = doc.path || ''
    // Skip the parent itself
    if (docPath === apiPath) continue
    // Skip nested children (only direct children)
    const parentSegments = apiPath ? apiPath.split('/').filter(Boolean) : []
    const childSegments = docPath.split('/').filter(Boolean)
    if (childSegments.length > parentSegments.length + 1) continue
    const metadata = getPlainMetadata(doc.metadata)
    const title = metadata?.name || childSegments[childSegments.length - 1] || 'Untitled'
    const childUrl = `hm://${id.uid}/${childSegments.join('/')}`
    children.push(`- [${title}](${childUrl})`)
  }
  if (children.length === 0) return 'No child documents found.'
  return `## Directory\n\n${children.join('\n')}`
}

async function readVersions(id: ReturnType<typeof unpackHmId>) {
  if (!id) return 'Error: invalid document ID'
  const result = await desktopRequest('ListChanges', {targetId: id})
  if (!result.changes || result.changes.length === 0) return 'No version history found for this document.'
  const authorUids = result.changes.map((c) => c.author).filter(Boolean) as string[]
  const names = await resolveAccountNames(authorUids)
  const lines: string[] = [`## Version History\n`]
  if (result.latestVersion) {
    lines.push(`Latest version: \`${result.latestVersion}\`\n`)
  }
  for (const change of result.changes) {
    const date = change.createTime ? new Date(change.createTime).toLocaleString() : 'unknown date'
    const changeId = change.id ? `\`${change.id.slice(0, 12)}...\`` : 'unknown'
    lines.push(`- ${changeId} by ${displayName(names, change.author)} at ${date}`)
  }
  return lines.join('\n')
}

async function readCitations(id: ReturnType<typeof unpackHmId>) {
  if (!id) return 'Error: invalid document ID'
  const result = await desktopRequest('ListCitations', {targetId: id})
  if (!result.citations || result.citations.length === 0) return 'No citations found for this document.'
  // Resolve source document metadata for richer display
  const sourceIds = result.citations.map((m) => unpackHmId(m.source)).filter((s) => s !== null)
  const sourceMetadata: Record<string, string> = {}
  await Promise.all(
    sourceIds.map(async (srcId) => {
      if (!srcId) return
      try {
        const res = await desktopRequest('ResourceMetadata', srcId)
        if (res?.metadata?.name) sourceMetadata[srcId.id] = res.metadata.name
      } catch {
        // skip - will use URL fallback
      }
    }),
  )
  const lines: string[] = [`## Citations\n`]
  for (const mention of result.citations) {
    const sourceId = unpackHmId(mention.source)
    const sourceName = sourceId ? sourceMetadata[sourceId.id] || mention.source : mention.source || 'unknown'
    const sourceType = mention.sourceType || 'link'
    const fragment = mention.targetFragment ? ` (fragment: ${mention.targetFragment})` : ''
    lines.push(`- [${sourceType}] "${sourceName}" (${mention.source})${fragment}`)
  }
  return lines.join('\n')
}

async function readCollaborators(id: ReturnType<typeof unpackHmId>) {
  if (!id) return 'Error: invalid document ID'
  const result = await desktopRequest('ListCapabilities', {targetId: id})
  if (!result.capabilities || result.capabilities.length === 0) return 'No collaborators found for this document.'
  // Collect all unique account UIDs (issuers and delegates)
  const uids: string[] = []
  for (const cap of result.capabilities) {
    if (cap.issuer) uids.push(cap.issuer)
    if (cap.delegate) uids.push(cap.delegate)
  }
  const names = await resolveAccountNames(uids)
  const lines: string[] = [`## Collaborators\n`]
  for (const cap of result.capabilities) {
    const delegate = displayName(names, cap.delegate)
    const issuer = displayName(names, cap.issuer)
    const role = cap.role || 'unknown role'
    const path = cap.path ? ` (path: ${cap.path})` : ''
    lines.push(`- **${delegate}** — ${role}, granted by ${issuer}${path}`)
  }
  return lines.join('\n')
}

// Plain tool objects using inputSchema (not parameters) to match AI SDK v4 internal expectations.
// Typed as Record<string, any> to avoid excessive type instantiation depth with Zod + AI SDK.
const chatTools: Record<string, any> = {
  search: {
    description:
      'Search Hypermedia documents and contacts when you do not know the exact hm:// URL yet. Supports the full client search request fields: query, accountUid, includeBody, contextSize, perspectiveAccountUid, searchType, and pageSize. Use this before read or navigate when the user asks about a title, topic, or person rather than a specific URL.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          description: 'The search query. Supports phrases and wildcards.',
        },
        accountUid: {
          type: 'string',
          description: 'Optional account UID to scope search to a single account.',
        },
        includeBody: {
          type: 'boolean',
          description: 'Set true to search document bodies and comments in addition to titles and contacts.',
        },
        contextSize: {
          type: 'integer',
          minimum: 0,
          description: 'Optional match context size in runes. Defaults to 48.',
        },
        perspectiveAccountUid: {
          type: 'string',
          description: 'Optional logged-in account UID used when filtering contact visibility.',
        },
        searchType: {
          type: 'string',
          enum: ['keyword', 'semantic', 'hybrid'],
          description:
            'Search strategy. Use hybrid for general discovery, keyword for exact text, semantic for concept matches.',
        },
        pageSize: {
          type: 'integer',
          minimum: 1,
          description: 'Maximum number of results to return.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    }),
    execute: async (input: {
      query: string
      accountUid?: string
      includeBody?: boolean
      contextSize?: number
      perspectiveAccountUid?: string
      searchType?: 'keyword' | 'semantic' | 'hybrid'
      pageSize?: number
    }) => {
      try {
        return await executeChatSearch(input)
      } catch (e) {
        return createToolErrorOutput(`Error: ${(e as Error).message}`, {query: input.query})
      }
    },
  },
  read: {
    description:
      'Read a Hypermedia document, its comments, directory listing, version history, citations, or collaborators.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The hm:// URL to read',
        },
      },
      required: ['url'],
      additionalProperties: false,
    }),
    execute: async ({url}: {url: string}) => {
      try {
        const parsed = parseDocumentUrl(url)
        if (!parsed) {
          return createToolErrorOutput(`Error: Could not parse URL "${url}". Use an hm:// URL.`, {resourceUrl: url})
        }
        const {id, viewTerm, viewArg} = parsed
        const [resourceTitle, siteName] = await Promise.all([readResourceTitle(id), readSiteName(id.uid)])
        switch (viewTerm) {
          case 'comments': {
            const commentsResult = await readComments(id, viewArg)
            if (typeof commentsResult === 'string') {
              return createToolErrorOutput(commentsResult, {resourceUrl: url})
            }

            return createReadToolOutput({
              url,
              view: 'comments',
              markdown: commentsResult.markdown,
              title: resourceTitle,
              displayLabel: commentsResult.commentAuthorName
                ? `Comment by ${commentsResult.commentAuthorName}`
                : formatCommentsDisplayLabel(resourceTitle),
            })
          }
          case 'directory':
            return createReadToolOutput({
              url,
              view: 'directory',
              markdown: await readDirectory(id),
              title: resourceTitle,
              displayLabel: formatDocumentDisplayLabel(resourceTitle, siteName),
            })
          case 'activity':
            switch (viewArg) {
              case 'versions':
                return createReadToolOutput({
                  url,
                  view: 'versions',
                  markdown: await readVersions(id),
                  title: resourceTitle,
                  displayLabel: formatDocumentDisplayLabel(resourceTitle, siteName),
                })
              case 'citations':
                return createReadToolOutput({
                  url,
                  view: 'citations',
                  markdown: await readCitations(id),
                  title: resourceTitle,
                  displayLabel: formatDocumentDisplayLabel(resourceTitle, siteName),
                })
              default:
                return createReadToolOutput({
                  url,
                  view: 'versions',
                  markdown: await readVersions(id),
                  title: resourceTitle,
                  displayLabel: formatDocumentDisplayLabel(resourceTitle, siteName),
                })
            }
          case 'collaborators':
            return createReadToolOutput({
              url,
              view: 'collaborators',
              markdown: await readCollaborators(id),
              title: resourceTitle,
              displayLabel: formatDocumentDisplayLabel(resourceTitle, siteName),
            })
          default: {
            const documentResult = await readDocument(id)
            if (typeof documentResult === 'string') {
              return createToolErrorOutput(documentResult, {resourceUrl: url})
            }
            return createReadToolOutput({
              url,
              view: 'document',
              markdown: documentResult.markdown,
              title: documentResult.title,
              displayLabel: formatDocumentDisplayLabel(documentResult.title, siteName),
            })
          }
        }
      } catch (e) {
        return createToolErrorOutput(`Error: ${(e as Error).message}`, {resourceUrl: url})
      }
    },
  },
  resolveUrl: {
    description:
      'Use when the user provides a Web https URL. Once you have a hm:// URL, resolution is not needed. Use this before reading or navigating to a http(s) URL. Once you have resolved to a HM URL, skip this tool. that format (hm:// paths are consistent with web).',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to resolve. Accepts http(s) URLs. Returns the matching hm:// URL.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    }),
    execute: async ({url}: {url: string}) => {
      const resolved = await resolveOmnibarUrlToHypermediaUrl(url)
      if (!resolved) {
        return createToolErrorOutput(`Error: Could not resolve "${url}" to a Hypermedia URL.`, {inputUrl: url})
      }
      return {
        summary: `Resolved the URL to ${resolved}.`,
        inputUrl: url,
        resourceUrl: resolved,
        resolvedUrl: resolved,
      }
    },
  },
  navigate: {
    description:
      'Use when the user asks for navigation, opening, showing, or if the intent is strongly implied. Opens a Hypermedia resource in the app. Accepts parseable hm:// URLs, including view suffixes like /:comments, /:collaborators, /:activity/citations, and block fragments like #block or #block[5:15].',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The hm:// URL to open',
        },
        newWindow: {
          type: 'boolean',
          description: 'True to open in a new window instead of the current window.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    }),
    execute: async ({url, newWindow = false}: {url: string; newWindow?: boolean}) => {
      const summary = navigateDesktopUrl(url, {newWindow})
      return {
        summary,
        resourceUrl: url,
        newWindow,
      }
    },
  },
}

/** Chat-related TRPC routes backed by local session storage and live stream events. */
export const chatApi = t.router({
  listSessions: t.procedure.query(async () => {
    return await listSessions()
  }),

  getSession: t.procedure.input(z.string()).query(async ({input}) => {
    return await readSession(input)
  }),

  createSession: t.procedure.input(z.object({title: z.string().optional()}).optional()).mutation(async ({input}) => {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const config = await readConfig()
    const preferredProvider = resolveConfiguredProvider(config.agentProviders || [], [
      config.lastUsedProviderId,
      config.selectedProviderId,
    ])
    const session: ChatSession = {
      id,
      title: input?.title || 'New Chat',
      providerId: preferredProvider?.id,
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    await writeSession(session)
    appInvalidateQueries(['CHAT_SESSIONS'])
    return session
  }),

  setSessionProvider: t.procedure
    .input(z.object({sessionId: z.string(), providerId: z.string()}))
    .mutation(async ({input}) => {
      const session = await readSession(input.sessionId)
      if (!session) throw new Error('Session not found')
      session.providerId = input.providerId
      await writeSession(session)
      setLastUsedProvider(input.providerId).catch(() => {})
      appInvalidateQueries(['CHAT_SESSION', input.sessionId])
      return null
    }),

  deleteSession: t.procedure.input(z.string()).mutation(async ({input}) => {
    try {
      await fs.unlink(sessionPath(input))
    } catch {
      // already gone
    }
    appInvalidateQueries(['CHAT_SESSIONS'])
    return null
  }),

  sendMessage: t.procedure
    .input(
      z.object({
        sessionId: z.string(),
        content: z.union([z.string(), z.array(z.string())]),
        providerId: z.string().optional(),
        documentContext: z
          .object({
            url: z.string().optional(),
            title: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({input}) => {
      const session = await readSession(input.sessionId)
      if (!session) throw new Error('Session not found')

      const config = await readConfig()
      const providers = config.agentProviders || []
      const selectedProvider = resolveConfiguredProvider(providers, [
        input.providerId,
        session.providerId,
        config.lastUsedProviderId,
        config.selectedProviderId,
      ])
      if (!selectedProvider) throw new Error('No AI provider configured. Add one in Settings > Assistant Providers.')

      const provider = await resolveProviderForUsage(selectedProvider.id).catch((error) => {
        throw new Error((error as Error).message || 'Could not load provider credentials.')
      })

      // Save provider to session and update last used globally
      session.providerId = provider.id
      setLastUsedProvider(provider.id).catch(() => {})

      // Support single string or array of strings (for queued messages)
      const contents = Array.isArray(input.content) ? input.content : [input.content]

      for (const content of contents) {
        const userMessage: ChatMessage = {
          role: 'user',
          content,
          createdAt: new Date().toISOString(),
        }
        session.messages.push(userMessage)
        broadcastChatEvent({type: 'message_added', sessionId: input.sessionId, message: userMessage})
      }
      session.updatedAt = new Date().toISOString()

      // Update title from first message
      if (session.messages.filter((m) => m.role === 'user').length === contents.length) {
        const firstContent = contents[0]
        session.title = firstContent.slice(0, 60) + (firstContent.length > 60 ? '...' : '')
      }

      await writeSession(session)
      appInvalidateQueries(['CHAT_SESSION', input.sessionId])

      // Build system prompt with document context
      const systemParts: string[] = [
        'You are the Seed Assistant. Part of Seed desktop app. Connected to the p2p Hypermedia (HM) network, an augmented web.',
        'Be nice but not overly friendly and "helpful". Be consise. Do not offer follow-up help. Don\'t say anything that the user hasnt asked for.',
        'There are many HM resource types: document, comments, contacts, capabilities. Documents have human-readable paths.',
        'Resources in Seed use hm:// URLs. For example: hm://z6Mk.../path-segment',
        'When you mention an hm:// resource or view in your reply, format it as a Markdown link with a descriptive label, for example `[Project notes](hm://z6Mk.../notes)`.',
        'Document URLs support suffixes for different views:',
        '  - "hm://…/path?version=VERSION_ID" - Exact version of the document',
        '  - "hm://…/path#BLOCK_ID" - A specific block in the document',
        '  - "hm://…/path#BLOCK_ID+" - A block plus children blocks (a section)',
        '  - "hm://…/path/:comments" - Read discussions/comments on the document',
        '  - "hm://…/path/:comments/COMMENT_ID" - Read discussions/comments on the document',
        '  - "hm://…/path/:directory" - List child documents (subdocuments)',
        '  - "hm://…/path/:activity/versions" - List version history (changes/authors/dates)',
        '  - "hm://…/path/:activity/citations" - List citations/backlinks to this document',
        '  - "hm://…/path/:collaborators" - List collaborators and their access roles',
        'To explore a section of a site, read the directory first, then read each child document.',
        `The current time is: ${new Date().toISOString()}`,
      ]
      if (input.documentContext?.url) {
        systemParts.push('')
        systemParts.push(`The user is currently viewing: ${input.documentContext.url}`)
        if (input.documentContext.title) {
          systemParts.push(`Document title: "${input.documentContext.title}"`)
        }
        systemParts.push(
          'You can use this URL with the `read` tool to inspect the document or with `navigate` to reopen specific views.',
        )
      }
      const system = systemParts.join('\n')

      const messages = session.messages.reduce<ModelMessage[]>((items, m) => {
        if (m.isError || !m.content) return items
        if (m.role === 'user') {
          items.push({role: 'user', content: m.content})
        } else {
          items.push({role: 'assistant', content: m.content})
        }
        return items
      }, [])

      const model = createProviderModel(provider)
      const abortController = new AbortController()
      activeStreams.set(input.sessionId, abortController)

      let fullText = ''
      let lastStreamError: unknown
      let orderedParts: ChatMessagePart[] = []
      const allToolCalls: ChatToolCall[] = []
      const allToolResults: ChatToolResult[] = []

      try {
        broadcastChatEvent({type: 'stream_start', sessionId: input.sessionId})

        const result = streamText({
          model,
          ...getChatProviderRequestOptions(provider, system),
          messages,
          tools: chatTools,
          stopWhen: stepCountIs(5),
          abortSignal: abortController.signal,
          onError: ({error}) => {
            lastStreamError = error
          },
          onChunk: ({chunk}) => {
            switch (chunk.type) {
              case 'text-delta': {
                if (!chunk.text) break

                fullText += chunk.text
                orderedParts = appendChatTextPart(orderedParts, chunk.text)
                broadcastChatEvent({type: 'text_delta', sessionId: input.sessionId, delta: chunk.text})
                break
              }
              case 'tool-call': {
                if (allToolCalls.some((existing) => existing.id === chunk.toolCallId)) break

                const mappedCall: ChatToolCall = {
                  id: chunk.toolCallId,
                  name: chunk.toolName,
                  args: ((chunk as any).input ?? (chunk as any).args ?? {}) as Record<string, unknown>,
                }

                orderedParts = appendChatToolCalls(orderedParts, [mappedCall])
                allToolCalls.push(mappedCall)
                broadcastChatEvent({
                  type: 'tool_calls',
                  sessionId: input.sessionId,
                  toolCalls: [mappedCall],
                })
                break
              }
              case 'tool-result': {
                if (chunk.preliminary) break

                const mappedResult: ChatToolResult = {
                  id: chunk.toolCallId,
                  name: chunk.toolName,
                  result: summarizeToolOutput(chunk.output),
                  rawOutput: chunk.output,
                }

                orderedParts = applyChatToolResults(orderedParts, [mappedResult])
                const existingResultIndex = allToolResults.findIndex((existing) => existing.id === mappedResult.id)
                if (existingResultIndex >= 0) {
                  allToolResults[existingResultIndex] = mappedResult
                } else {
                  allToolResults.push(mappedResult)
                }
                broadcastChatEvent({
                  type: 'tool_results',
                  sessionId: input.sessionId,
                  toolResults: [mappedResult],
                })
                break
              }
            }
          },
        })

        await result.consumeStream()

        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: fullText,
          ...(orderedParts.length > 0 ? {parts: orderedParts} : {}),
          ...(allToolCalls.length > 0 ? {toolCalls: allToolCalls} : {}),
          ...(allToolResults.length > 0 ? {toolResults: allToolResults} : {}),
          createdAt: new Date().toISOString(),
        }

        session.messages.push(assistantMessage)
        session.updatedAt = new Date().toISOString()
        await writeSession(session)

        broadcastChatEvent({type: 'stream_end', sessionId: input.sessionId, message: assistantMessage})
        appInvalidateQueries(['CHAT_SESSION', input.sessionId])

        return assistantMessage
      } catch (error) {
        // On abort, save partial content as the assistant message
        if (abortController.signal.aborted) {
          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: fullText || '(stopped)',
            ...(orderedParts.length > 0 ? {parts: orderedParts} : {}),
            ...(allToolCalls.length > 0 ? {toolCalls: allToolCalls} : {}),
            ...(allToolResults.length > 0 ? {toolResults: allToolResults} : {}),
            createdAt: new Date().toISOString(),
          }

          session.messages.push(assistantMessage)
          session.updatedAt = new Date().toISOString()
          await writeSession(session)

          broadcastChatEvent({type: 'stream_end', sessionId: input.sessionId, message: assistantMessage})
          appInvalidateQueries(['CHAT_SESSION', input.sessionId])

          return assistantMessage
        }

        const chatError = resolveChatStreamError(error, lastStreamError)
        const errMsg = chatError.message
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: fullText,
          errorMessage: errMsg,
          isError: true,
          ...(orderedParts.length > 0 ? {parts: orderedParts} : {}),
          ...(allToolCalls.length > 0 ? {toolCalls: allToolCalls} : {}),
          ...(allToolResults.length > 0 ? {toolResults: allToolResults} : {}),
          createdAt: new Date().toISOString(),
        }

        log.error('Chat stream error', {error: errMsg})
        session.messages.push(assistantMessage)
        session.updatedAt = new Date().toISOString()
        await writeSession(session)

        broadcastChatEvent({type: 'stream_end', sessionId: input.sessionId, message: assistantMessage})
        appInvalidateQueries(['CHAT_SESSION', input.sessionId])

        return assistantMessage
      } finally {
        activeStreams.delete(input.sessionId)
      }
    }),
})

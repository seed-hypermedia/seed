import {createAnthropic} from '@ai-sdk/anthropic'
import {createOpenAI} from '@ai-sdk/openai'
import {HMBlockNode, HMComment, HMCommentSchema} from '@seed-hypermedia/client/hm-types'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
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
import {desktopRequest} from './desktop-api'
import {grpcClient} from './grpc-client'
import {getChatProviderRequestOptions} from './chat-provider-options'
import * as log from './logger'

const chatDir = path.join(userDataPath, 'chat-sessions')

export type ChatMessage = {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: Array<{
    id: string
    name: string
    args: Record<string, unknown>
  }>
  toolResults?: Array<{
    id: string
    name: string
    result: string
  }>
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

// View term suffixes that can be appended to hm:// URLs
// Supports sub-paths like :activity/versions, :activity/citations
const VIEW_TERM_PATTERN = /\/:(comments|directory|activity|collaborators|feed)(?:\/(.+))?$/

/**
 * Parse a URL, extracting any view term suffix.
 * e.g. "hm://z6Mk.../path/:comments" → {id, viewTerm: "comments"}
 * e.g. "hm://z6Mk.../path/:directory" → {id, viewTerm: "directory"}
 * e.g. "hm://z6Mk.../path" → {id, viewTerm: null}
 */
function parseDocumentUrl(url: string) {
  let viewTerm: string | null = null
  let viewArg: string | undefined
  let cleanUrl = url

  const viewMatch = url.match(VIEW_TERM_PATTERN)
  if (viewMatch) {
    viewTerm = viewMatch[1]
    viewArg = viewMatch[2]
    cleanUrl = url.replace(VIEW_TERM_PATTERN, '')
  }

  const id = unpackHmId(cleanUrl)
  if (!id) return null
  return {id, viewTerm, viewArg}
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
  return `# ${title}\n\n${content}`
}

async function readComments(id: ReturnType<typeof unpackHmId>) {
  if (!id) return 'Error: invalid document ID'
  const res = await grpcClient.comments.listComments({
    targetAccount: id.uid,
    targetPath: hmIdPathToEntityQueryPath(id.path),
    pageSize: 100,
  })
  const parsed = res.comments.map(parseComment).filter((c): c is HMComment => c !== null)
  if (parsed.length === 0) return 'No comments found on this document.'
  const authorUids = parsed.map((c) => c.author).filter(Boolean) as string[]
  const names = await resolveAccountNames(authorUids)
  const comments: string[] = []
  for (const c of parsed) {
    const content = c.content ? blockNodesToMarkdown(c.content as HMBlockNode[]) : ''
    const replyInfo = c.replyParent ? ` (reply to ${c.replyParent})` : ''
    comments.push(`**${displayName(names, c.author)}**${replyInfo}:\n${content}`)
  }
  return `## Comments\n\n${comments.join('\n\n---\n\n')}`
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
  getCurrentTime: {
    description: 'Get the current date and time',
    inputSchema: jsonSchema({type: 'object', properties: {}, additionalProperties: false}),
    execute: async () => {
      return new Date().toISOString()
    },
  },
  calculate: {
    description: 'Evaluate a mathematical expression',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {expression: {type: 'string', description: 'The math expression to evaluate'}},
      required: ['expression'],
      additionalProperties: false,
    }),
    execute: async ({expression}: {expression: string}) => {
      try {
        const result = Function(`"use strict"; return (${expression})`)()
        return String(result)
      } catch (e) {
        return `Error: ${(e as Error).message}`
      }
    },
  },
  read: {
    description:
      'Read a Hypermedia document, its comments, directory listing, version history, citations, or collaborators. Supports hm:// URLs with optional view term suffixes: /:comments for discussions, /:directory for child documents, /:activity/versions for version history, /:activity/citations for citations/backlinks, /:collaborators for access control. Without a suffix, reads the document content as markdown.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'The hm:// URL to read. Examples: "hm://z6Mk.../path" reads the document, "hm://z6Mk.../path/:comments" reads comments, "hm://z6Mk.../path/:directory" lists children, "hm://z6Mk.../path/:activity/versions" lists version history, "hm://z6Mk.../path/:activity/citations" lists citations, "hm://z6Mk.../path/:collaborators" lists collaborators.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    }),
    execute: async ({url}: {url: string}) => {
      try {
        const parsed = parseDocumentUrl(url)
        if (!parsed) return `Error: Could not parse URL "${url}". Use an hm:// URL.`
        const {id, viewTerm, viewArg} = parsed
        switch (viewTerm) {
          case 'comments':
            return await readComments(id)
          case 'directory':
            return await readDirectory(id)
          case 'activity':
            switch (viewArg) {
              case 'versions':
                return await readVersions(id)
              case 'citations':
                return await readCitations(id)
              default:
                return await readVersions(id)
            }
          case 'collaborators':
            return await readCollaborators(id)
          default:
            return await readDocument(id)
        }
      } catch (e) {
        return `Error: ${(e as Error).message}`
      }
    },
  },
}

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
    const session: ChatSession = {
      id,
      title: input?.title || 'New Chat',
      providerId: config.lastUsedProviderId || config.selectedProviderId,
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
      const providerId =
        input.providerId || session.providerId || config.lastUsedProviderId || config.selectedProviderId
      const selectedProvider = providerId ? providers.find((p) => p.id === providerId) : providers[0]
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
        'You are a helpful assistant integrated into Seed, a Hypermedia document editor and collaboration platform.',
        'You can read documents, their comments/discussions, and directory listings using the `read` tool.',
        '',
        'Documents in Seed use hm:// URLs. For example: hm://z6Mk.../path-segment',
        'Use the `read` tool with an hm:// URL to read a document.',
        'Append suffixes to the URL for different views:',
        '  - read("hm://…/path") - Read the document content as markdown',
        '  - read("hm://…/path/:comments") - Read discussions/comments on the document',
        '  - read("hm://…/path/:directory") - List child documents (subdocuments)',
        '  - read("hm://…/path/:activity/versions") - List version history (changes/authors/dates)',
        '  - read("hm://…/path/:activity/citations") - List citations/backlinks to this document',
        '  - read("hm://…/path/:collaborators") - List collaborators and their access roles',
        '',
        'To explore a section of a site, read the directory first, then read each child document.',
      ]
      if (input.documentContext?.url) {
        systemParts.push('')
        systemParts.push(`The user is currently viewing: ${input.documentContext.url}`)
        if (input.documentContext.title) {
          systemParts.push(`Document title: "${input.documentContext.title}"`)
        }
        systemParts.push('You can use this URL with the `read` tool to access the document they are looking at.')
      }
      const system = systemParts.join('\n')

      const messages: ModelMessage[] = session.messages.map((m) => {
        if (m.role === 'user') return {role: 'user' as const, content: m.content}
        return {role: 'assistant' as const, content: m.content}
      })

      const model = createProviderModel(provider)
      const abortController = new AbortController()
      activeStreams.set(input.sessionId, abortController)

      let fullText = ''
      const allToolCalls: ChatMessage['toolCalls'] = []
      const allToolResults: ChatMessage['toolResults'] = []

      try {
        broadcastChatEvent({type: 'stream_start', sessionId: input.sessionId})

        const result = streamText({
          model,
          ...getChatProviderRequestOptions(provider, system),
          messages,
          tools: chatTools,
          stopWhen: stepCountIs(5),
          abortSignal: abortController.signal,
          onStepFinish: ({toolCalls, toolResults}) => {
            if (toolCalls && toolCalls.length > 0) {
              const mappedCalls = toolCalls.map((tc: any) => ({
                id: tc.toolCallId,
                name: tc.toolName,
                args: tc.input ?? tc.args ?? {},
              }))
              broadcastChatEvent({
                type: 'tool_calls',
                sessionId: input.sessionId,
                toolCalls: mappedCalls,
              })
              for (const mc of mappedCalls) {
                allToolCalls.push(mc)
              }
            }
            if (toolResults && toolResults.length > 0) {
              const mappedResults = toolResults.map((tr: any) => {
                const result = tr.output ?? tr.result
                return {
                  id: tr.toolCallId,
                  name: tr.toolName,
                  result: typeof result === 'string' ? result : JSON.stringify(result),
                }
              })
              broadcastChatEvent({
                type: 'tool_results',
                sessionId: input.sessionId,
                toolResults: mappedResults,
              })
              for (const mr of mappedResults) {
                allToolResults.push(mr)
              }
            }
          },
        })

        for await (const chunk of result.textStream) {
          fullText += chunk
          broadcastChatEvent({type: 'text_delta', sessionId: input.sessionId, delta: chunk})
        }

        // Collect tool usage from the final result (only for non-aborted streams)
        const finalResult = await result
        const steps = await finalResult.steps
        for (const step of steps) {
          if (step.toolCalls) {
            for (const tc of step.toolCalls) {
              const id = (tc as any).toolCallId
              if (!allToolCalls.some((existing) => existing.id === id)) {
                allToolCalls.push({
                  id,
                  name: (tc as any).toolName,
                  args: (tc as any).input ?? (tc as any).args ?? {},
                })
              }
            }
          }
          if (step.toolResults) {
            for (const tr of step.toolResults) {
              const id = (tr as any).toolCallId
              if (!allToolResults.some((existing) => existing.id === id)) {
                const trResult = (tr as any).output ?? (tr as any).result
                allToolResults.push({
                  id,
                  name: (tr as any).toolName,
                  result: typeof trResult === 'string' ? trResult : JSON.stringify(trResult),
                })
              }
            }
          }
        }

        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: fullText,
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

        const errMsg = (error as Error).message
        log.error('Chat stream error', {error: errMsg})
        broadcastChatEvent({type: 'stream_error', sessionId: input.sessionId, error: errMsg})
        throw error
      } finally {
        activeStreams.delete(input.sessionId)
      }
    }),
})

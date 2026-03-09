import {createAnthropic} from '@ai-sdk/anthropic'
import {createOpenAI} from '@ai-sdk/openai'
import {jsonSchema, stepCountIs, streamText, type ModelMessage} from 'ai'
import crypto from 'crypto'
import {ipcMain} from 'electron'
import fs from 'fs/promises'
import path from 'path'
import z from 'zod'
import {readConfig, type AgentProvider} from './app-ai-config'
import {appInvalidateQueries} from './app-invalidation'
import {userDataPath} from './app-paths'
import {t} from './app-trpc'
import {getAllWindows} from './app-windows'
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
    const session: ChatSession = {
      id,
      title: input?.title || 'New Chat',
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    await writeSession(session)
    appInvalidateQueries(['CHAT_SESSIONS'])
    return session
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
    .input(z.object({sessionId: z.string(), content: z.string(), providerId: z.string().optional()}))
    .mutation(async ({input}) => {
      const session = await readSession(input.sessionId)
      if (!session) throw new Error('Session not found')

      const config = await readConfig()
      const providers = config.agentProviders || []
      const providerId = input.providerId || config.selectedProviderId
      const provider = providerId ? providers.find((p) => p.id === providerId) : providers[0]
      if (!provider) throw new Error('No AI provider configured. Add one in Settings > AI Providers.')

      const userMessage: ChatMessage = {
        role: 'user',
        content: input.content,
        createdAt: new Date().toISOString(),
      }
      session.messages.push(userMessage)
      session.updatedAt = new Date().toISOString()

      // Update title from first message
      if (session.messages.filter((m) => m.role === 'user').length === 1) {
        session.title = input.content.slice(0, 60) + (input.content.length > 60 ? '...' : '')
      }

      await writeSession(session)
      appInvalidateQueries(['CHAT_SESSION', input.sessionId])

      broadcastChatEvent({type: 'message_added', sessionId: input.sessionId, message: userMessage})

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
          messages,
          tools: chatTools,
          stopWhen: stepCountIs(5),
          abortSignal: abortController.signal,
          onStepFinish: ({toolCalls, toolResults}) => {
            if (toolCalls && toolCalls.length > 0) {
              broadcastChatEvent({
                type: 'tool_calls',
                sessionId: input.sessionId,
                toolCalls: toolCalls.map((tc: any) => ({
                  id: tc.toolCallId,
                  name: tc.toolName,
                  args: tc.args,
                })),
              })
              for (const tc of toolCalls) {
                allToolCalls.push({id: (tc as any).toolCallId, name: (tc as any).toolName, args: (tc as any).args})
              }
            }
            if (toolResults && toolResults.length > 0) {
              broadcastChatEvent({
                type: 'tool_results',
                sessionId: input.sessionId,
                toolResults: toolResults.map((tr: any) => ({
                  id: tr.toolCallId,
                  name: tr.toolName,
                  result: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
                })),
              })
              for (const tr of toolResults) {
                const trResult = (tr as any).result
                allToolResults.push({
                  id: (tr as any).toolCallId,
                  name: (tr as any).toolName,
                  result: typeof trResult === 'string' ? trResult : JSON.stringify(trResult),
                })
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
                allToolCalls.push({id, name: (tc as any).toolName, args: (tc as any).args})
              }
            }
          }
          if (step.toolResults) {
            for (const tr of step.toolResults) {
              const id = (tr as any).toolCallId
              if (!allToolResults.some((existing) => existing.id === id)) {
                const trResult = (tr as any).result
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

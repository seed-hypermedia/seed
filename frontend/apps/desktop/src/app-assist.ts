import {createAnthropic} from '@ai-sdk/anthropic'
import {createOpenAI} from '@ai-sdk/openai'
import {
  entityQueryPathToHmIdPath,
  HMDocumentInfo,
  hmIdPathToEntityQueryPath,
  NavRoute,
  navRouteSchema,
  packHmId,
  unpackHmId,
} from '@shm/shared'
import {LanguageModelV1, streamText, Tool} from 'ai'
import fs from 'fs/promises'
import {nanoid} from 'nanoid'
import path from 'path'
import z from 'zod'
import {grpcClient} from './app-grpc'
import {userDataPath} from './app-paths'
import {t} from './app-trpc'
import {dispatchAllWindowsAppEvent} from './app-windows'
import * as log from './logger'

export type ListedAssistThread = {
  id: string
  initialPrompt: string
  summary?: string
  createdAt: Date
}

export type AssistMessage = {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool' | 'reasoning'
  content: string
  createdAt: Date
  completeTime?: Date
  providerName?: string
  modelName?: string
  toolCallId?: string
  toolName?: string
  toolRequest?: any
  toolResult?: any
  toolResultTime?: Date
}

export type AssistThread = {
  id: string
  messages: AssistMessage[]
  createdAt: Date
  updatedAt: Date
}

const assistThreadsPath = path.join(userDataPath, 'assist-threads')
const assistThreadsIndexPath = path.join(assistThreadsPath, 'index.json')
const assistSettingsPath = path.join(userDataPath, 'assist', 'settings.json')

// In-memory cache for thread index
let threadIndexCache: ListedAssistThread[] | null = null
// In-memory cache for settings
let settingsCache: z.infer<typeof settingsSchema> | null = null

// Ensure directories exist
async function ensureDirectories() {
  try {
    await fs.mkdir(assistThreadsPath, {recursive: true})
    await fs.mkdir(path.dirname(assistSettingsPath), {recursive: true})
  } catch (error) {
    log.error('Failed to create assist directories:', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// Load thread index from disk
async function loadThreadIndexFromDisk(): Promise<ListedAssistThread[]> {
  try {
    const data = await fs.readFile(assistThreadsIndexPath, 'utf-8')
    const threads = JSON.parse(data)
    return threads.map((t: any) => ({
      ...t,
      createdAt: new Date(t.createdAt),
    }))
  } catch (error) {
    return []
  }
}

// Get thread index (from cache or load from disk)
async function getThreadIndex(): Promise<ListedAssistThread[]> {
  if (threadIndexCache === null) {
    threadIndexCache = await loadThreadIndexFromDisk()
  }
  return threadIndexCache
}

// Save thread index to disk and update cache
async function saveThreadIndex(threads: ListedAssistThread[]) {
  await ensureDirectories()
  await fs.writeFile(assistThreadsIndexPath, JSON.stringify(threads, null, 2))
  threadIndexCache = threads
}

// Load thread
async function loadThread(threadId: string): Promise<AssistThread | null> {
  try {
    const threadPath = path.join(assistThreadsPath, `${threadId}.json`)
    const data = await fs.readFile(threadPath, 'utf-8')
    const thread = JSON.parse(data)
    return {
      ...thread,
      createdAt: new Date(thread.createdAt),
      updatedAt: new Date(thread.updatedAt),
      messages: thread.messages.map((m: any) => ({
        ...m,
        createdAt: new Date(m.createdAt),
      })),
    }
  } catch (error) {
    return null
  }
}

// Save thread
async function saveThread(thread: AssistThread) {
  await ensureDirectories()
  const threadPath = path.join(assistThreadsPath, `${thread.id}.json`)
  await fs.writeFile(threadPath, JSON.stringify(thread, null, 2))
}

// Create initial system messages
function createSystemMessages(route?: NavRoute): AssistMessage[] {
  let message = `You are a "Seed Assist", an AI assistant built into Seed Hypermedia desktop app, a document-centric publishing network.`
  if (route) {
    message += `\n You are currently in the ${route.key} page.`
  }
  if (route?.key === 'document') {
    message += `\n The document id is ${packHmId(route.id)}.`
  }
  return [
    {
      id: nanoid(),
      role: 'system',
      content: message,
      createdAt: new Date(),
    },
  ]
}

function dispatchAssistMessage(message: AssistMessage) {
  dispatchAllWindowsAppEvent({
    key: 'assistMessage',
    message,
  })
}

const tools: Record<string, Tool> = {
  // getWeather: {
  //   description: 'Get the weather in a location',
  //   parameters: z.object({location: z.string()}),
  //   execute: async ({location}) => {
  //     console.log('getWeather', location)
  //     return `The weather in ${location} is sunny`
  //   },
  // },
  readDocument: {
    description: 'Read the content of a document',
    parameters: z.object({documentId: z.string()}),
    execute: async ({documentId}) => {
      const id = unpackHmId(documentId)
      if (!id)
        throw new Error(
          'Invalid document id. Should be hm://ACCOUNT_ID/...PATH?v=OPTIONAL_VERSION',
        )
      console.log('readDocument', documentId)
      const doc = await grpcClient.documents.getDocument({
        account: id.uid,
        path: hmIdPathToEntityQueryPath(id.path),
      })
      return doc.toJson()
    },
  },
  listDocuments: {
    description: 'List all documents in the account/site/document',
    parameters: z.object({
      documentId: z.string(),
      mode: z.enum(['all-recursive-children', 'direct-children']),
    }),
    execute: async ({documentId, mode}) => {
      const id = unpackHmId(documentId)
      if (!id)
        throw new Error(
          'Invalid document id. Should be hm://ACCOUNT_ID/...PATH?v=OPTIONAL_VERSION',
        )
      const docs = await grpcClient.documents.listDocuments({
        account: id.uid,
      })
      let result = docs.documents
        .map((d) => {
          const docInfo = d.toJson() as any
          return {
            ...docInfo,
            path: entityQueryPathToHmIdPath(docInfo.path),
          } as HMDocumentInfo
        })
        .filter((d) => {
          return id.path
            ? id.path.every((p, index) => d.path[index] === p)
            : true
        })
      if (mode === 'direct-children') {
        result = result.filter(
          (d) => d.path.length === (id.path?.length ?? 0) + 1,
        )
      }
      return result
    },
  },
}

let model: LanguageModelV1 | null = null

const anthropicModelSchema = z.enum([
  'claude-4-opus-20250514',
  'claude-4-sonnet-20250514',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-latest',
])

const openaiModelSchema = z.enum(['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'])

function createModel(
  settings: z.infer<typeof settingsSchema>,
): LanguageModelV1 | null {
  if (settings.provider === 'openai') {
    if (!settings.apiKeys.openai) {
      throw new Error('OpenAI API key is required')
    }
    const modelName = openaiModelSchema.parse(settings.model)
    const provider = createOpenAI({
      apiKey: settings.apiKeys.openai,
    })
    return provider(modelName)
  }
  if (settings.provider === 'anthropic') {
    if (!settings.apiKeys.anthropic) {
      throw new Error('Anthropic API key is required')
    }
    const modelName = anthropicModelSchema.parse(settings.model)
    const provider = createAnthropic({
      apiKey: settings.apiKeys.anthropic,
    })
    return provider(modelName)
  }
  return null
}

async function getModel(): Promise<
  [LanguageModelV1 | null, string | null, string | null]
> {
  const settings = await getSettings()
  if (!settings.model || !settings.provider) {
    return [null, null, null]
  }
  if (model) return [model, settings.provider, settings.model]

  model = createModel(settings)
  return [model, settings.provider!, settings.model!]
}

const settingsSchema = z.object({
  model: z.string().nullable(),
  provider: z.enum(['openai', 'anthropic']).nullable(),
  apiKeys: z.record(z.string().nullable()),
})

// Load settings from disk
async function loadSettingsFromDisk(): Promise<z.infer<typeof settingsSchema>> {
  try {
    const data = await fs.readFile(assistSettingsPath, 'utf-8')
    const settings = JSON.parse(data)
    return settingsSchema.parse(settings)
  } catch (error) {
    // Return default settings if file doesn't exist or is invalid
    return {
      model: null,
      provider: null,
      apiKeys: {},
    }
  }
}

// Get settings (from cache or load from disk)
async function getSettings(): Promise<z.infer<typeof settingsSchema>> {
  if (settingsCache === null) {
    settingsCache = await loadSettingsFromDisk()
  }
  return settingsCache
}

// Save settings to disk and update cache
async function saveSettings(settings: z.infer<typeof settingsSchema>) {
  await ensureDirectories()
  const validatedSettings = settingsSchema.parse(settings)
  await fs.writeFile(
    assistSettingsPath,
    JSON.stringify(validatedSettings, null, 2),
  )
  settingsCache = validatedSettings
  model = createModel(validatedSettings)
}

const threadAborters = new Map<string, AbortController | null>()

async function generateAssistantResponse(thread: AssistThread): Promise<void> {
  const [model, providerName, modelName] = await getModel()
  if (!model || !providerName || !modelName) {
    throw new Error('No model selected')
  }
  let currentResponseMessage: AssistMessage = {
    id: nanoid(),
    role: 'assistant',
    content: '',
    createdAt: new Date(),
    providerName,
    modelName,
  }
  let currentToolMessage: AssistMessage | null = null
  async function finalizeResponseMessage() {
    currentResponseMessage.completeTime = new Date()
    thread.messages.push(currentResponseMessage)
    thread.updatedAt = new Date()
    dispatchAssistMessage(currentResponseMessage)
    await saveThread(thread)
  }
  async function finalizeToolMessage(message: AssistMessage) {
    message.completeTime = new Date()
    thread.messages.push(message)
    thread.updatedAt = new Date()
    dispatchAssistMessage(message)
    await saveThread(thread)
  }
  try {
    const messages = thread.messages
      .filter((m) => m.role !== 'tool') // Filter out tool messages for now
      .map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }))

    const abort = new AbortController()

    const {textStream} = streamText({
      model,
      tools,
      onChunk: ({chunk}) => {
        ;(async () => {
          if (chunk.type === 'tool-call') {
            await finalizeResponseMessage()
            currentResponseMessage = {
              id: nanoid(),
              role: 'assistant',
              content: '',
              createdAt: new Date(),
              modelName,
              providerName,
            }
            currentToolMessage = {
              id: nanoid(),
              role: 'tool',
              content: '',
              createdAt: new Date(),
              modelName,
              providerName,
              toolName: chunk.toolName,
              toolCallId: chunk.toolCallId,
              toolRequest: chunk.args,
            }
            dispatchAssistMessage(currentResponseMessage)
          }
        })()
          .then(() => {})
          .catch((e) => {
            console.error('error', e)
          })
        console.log('chunk', chunk)
      },
      onStepFinish: (step) => {
        console.log('step', step)
        if (step.toolResults && currentToolMessage) {
          step.toolResults.forEach((toolResult: any) => {
            if (toolResult.toolCallId === currentToolMessage.toolCallId) {
              currentToolMessage.toolResult = toolResult.result
              currentToolMessage.toolResultTime = new Date()
              finalizeToolMessage(currentToolMessage).catch(console.error)
            }
          })
        }
      },
      onFinish: (message) => {
        console.log('finish', message)
      },
      onError: (error) => {
        console.log('error', error)
      },
      maxSteps: 10,
      messages,
      abortSignal: abort.signal,
    })

    // to stop the response:
    // abort.abort()

    // Dispatch initial message
    dispatchAssistMessage(currentResponseMessage)

    // Stream the response
    for await (const textPart of textStream) {
      currentResponseMessage.content += textPart
      dispatchAssistMessage(currentResponseMessage)
    }

    await finalizeResponseMessage()
  } catch (error: unknown) {
    const e = error as Error
    log.error('AI generation error:', {error: e.message})

    // Create error message
    const errorMessage: AssistMessage = {
      id: nanoid(),
      role: 'assistant',
      content: `I encountered an error: ${e.message}`,
      createdAt: new Date(),
    }

    dispatchAssistMessage(errorMessage)
    thread.messages.push(errorMessage)
    thread.updatedAt = new Date()
    await saveThread(thread)
  }
}

export const assistApi = t.router({
  listThreads: t.procedure.query(async () => {
    return await getThreadIndex()
  }),
  abortThread: t.procedure
    .input(z.object({threadId: z.string()}))
    .mutation(async ({input}) => {
      const abort = threadAborters.get(input.threadId)
      if (abort) {
        abort.abort()
      }
      return {success: true}
    }),
  startThread: t.procedure
    .input(z.object({prompt: z.string(), route: navRouteSchema.optional()}))
    .mutation(async ({input}) => {
      const threadId = nanoid(10)
      const now = new Date()

      const userMessage: AssistMessage = {
        id: nanoid(),
        role: 'user',
        content: input.prompt,
        createdAt: now,
      }

      const messages: AssistMessage[] = [
        ...createSystemMessages(input.route),
        userMessage,
      ]

      const thread: AssistThread = {
        id: threadId,
        messages,
        createdAt: now,
        updatedAt: now,
      }

      await saveThread(thread)

      // Update index
      const threads = await getThreadIndex()
      threads.unshift({
        id: threadId,
        initialPrompt: input.prompt,
        createdAt: now,
      })
      await saveThreadIndex(threads)

      // Dispatch user message
      dispatchAssistMessage(userMessage)

      // Generate AI response
      generateAssistantResponse(thread)
        .then(() => {})
        .catch((e) => {
          console.error('error on initial thread generation', e)
        })

      return {threadId}
    }),
  continueThread: t.procedure
    .input(z.object({threadId: z.string(), prompt: z.string()}))
    .mutation(async ({input}) => {
      console.log('continueThread', input.threadId, input.prompt)
      const thread = await loadThread(input.threadId)
      if (!thread) {
        throw new Error('Thread not found')
      }

      const userMessage: AssistMessage = {
        id: nanoid(),
        role: 'user',
        content: input.prompt,
        createdAt: new Date(),
      }

      dispatchAssistMessage(userMessage)

      thread.messages.push(userMessage)
      thread.updatedAt = new Date()

      await saveThread(thread)

      // Generate AI response
      await generateAssistantResponse(thread)

      return {success: true}
    }),
  getThread: t.procedure
    .input(z.object({threadId: z.string()}))
    .query(async ({input}) => {
      const thread = await loadThread(input.threadId)
      if (!thread) {
        throw new Error('Thread not found')
      }
      return thread
    }),
  getSettings: t.procedure.query(async () => {
    return await getSettings()
  }),
  setSettings: t.procedure.input(settingsSchema).mutation(async ({input}) => {
    console.log('setSettings', input)
    await saveSettings(input)
    return {success: true}
  }),
})

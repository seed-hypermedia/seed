/**
 * Mastra-style agent loop for the Knowledge Manager.
 *
 * Why "Mastra-style" rather than the Mastra SDK directly: Mastra ships as an
 * npm package with a deep dependency on Vite + Hono. Bundling it into the
 * minified Bun-built `dist/*.js` we ship to the server hits import-graph
 * problems. We re-implement the small slice of Mastra we actually need:
 *
 *   - tool registration (JSON-Schema → DeepSeek `tools` parameter)
 *   - bounded tool-call loop (max 30 calls / final_answer terminator)
 *   - per-thread message history (Telegram chat id, mention id)
 *
 * If/when the Mastra runtime gets first-class Bun support, we replace the
 * inner loop with `agent.run({threadId, message})` keeping the tool surface.
 */

import type {SeedCli} from '../seedcli.js'
import type {AuditRun} from '../audit.js'
import type {Mention} from '../mentions.js'
import {buildAgentTools, type ToolDef} from './tools-bridge.js'
import {COMMUNITY_AGENT_SYSTEM, OPERATOR_AGENT_SYSTEM} from './prompts.js'

const MAX_TOOL_CALLS = 30
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions'

type Role = 'system' | 'user' | 'assistant' | 'tool'
type Message = {
  role: Role
  content: string | null
  name?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {name: string; arguments: string}
  }>
  tool_call_id?: string
}

type RunArgs = {
  systemPrompt: string
  userMessage: string
  history?: Message[]
  tools: ToolDef[]
  audit?: AuditRun
  maxTokens?: number
  temperature?: number
}

type RunResult = {
  finalAnswer: string | null
  /** Updated history including system + user + assistant + tool messages.
   *  Caller persists it per thread to support multi-turn. */
  history: Message[]
  toolCallCount: number
}

async function runAgent(args: RunArgs): Promise<RunResult> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) {
    args.audit?.trace({ts: new Date().toISOString(), level: 'error', event: 'mastra_no_deepseek_key'})
    return {finalAnswer: null, history: args.history ?? [], toolCallCount: 0}
  }

  // Mandatory final_answer tool ensures the model terminates explicitly.
  const allTools: ToolDef[] = [
    ...args.tools,
    {
      name: 'final_answer',
      description: 'Emit the final reply to the user. Call this exactly once when ready.',
      parameters: {
        type: 'object',
        properties: {
          body: {type: 'string', description: 'The reply body. Plain text or simple markdown.'},
        },
        required: ['body'],
      },
      handler: async () => '',
    },
  ]

  const tools = allTools.map((t) => ({
    type: 'function' as const,
    function: {name: t.name, description: t.description, parameters: t.parameters},
  }))

  const messages: Message[] = [
    {role: 'system', content: args.systemPrompt},
    ...(args.history ?? []),
    {role: 'user', content: args.userMessage},
  ]

  let toolCallCount = 0
  let finalAnswer: string | null = null

  for (let step = 0; step < MAX_TOOL_CALLS + 1; step++) {
    const t0 = Date.now()
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages,
      tools,
      tool_choice: step === MAX_TOOL_CALLS ? {type: 'function', function: {name: 'final_answer'}} : 'auto',
      temperature: args.temperature ?? 0.4,
      max_tokens: args.maxTokens ?? 600,
    })
    let res: Response
    try {
      res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${apiKey}`},
        body,
      })
    } catch (err) {
      args.audit?.trace({
        ts: new Date().toISOString(),
        level: 'error',
        event: 'mastra_network_error',
        data: {message: err instanceof Error ? err.message : String(err)},
      })
      break
    }
    const latencyMs = Date.now() - t0
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      args.audit?.trace({
        ts: new Date().toISOString(),
        level: 'error',
        event: 'mastra_http_error',
        data: {status: res.status, body: text.slice(0, 300), latencyMs},
      })
      break
    }
    const json = (await res.json()) as {
      choices?: Array<{message?: Message; finish_reason?: string}>
      usage?: {prompt_tokens?: number; completion_tokens?: number; total_tokens?: number}
    }
    const choice = json.choices?.[0]
    const message = choice?.message
    if (!message) break

    args.audit?.llm({
      ts_start: new Date(t0).toISOString(),
      ts_end: new Date().toISOString(),
      latency_ms: latencyMs,
      model: 'deepseek-chat',
      completion: message.content ?? '',
      tool_calls: message.tool_calls,
      usage: {
        prompt: json.usage?.prompt_tokens,
        completion: json.usage?.completion_tokens,
        total: json.usage?.total_tokens,
      },
    })

    messages.push(message)

    if (!message.tool_calls || message.tool_calls.length === 0) {
      // Plain assistant text without tool call. Treat as final answer.
      finalAnswer = (message.content ?? '').trim() || null
      break
    }

    let answeredViaFinal = false
    for (const call of message.tool_calls) {
      toolCallCount++
      const tool = allTools.find((t) => t.name === call.function.name)
      if (!tool) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: `error: unknown tool ${call.function.name}`,
        })
        continue
      }
      let parsed: any = {}
      try {
        parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {}
      } catch {
        // pass through to handler with empty args
      }
      if (tool.name === 'final_answer') {
        finalAnswer = String(parsed.body ?? '').trim() || null
        answeredViaFinal = true
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: 'final_answer',
          content: 'ok',
        })
        continue
      }
      const t1 = Date.now()
      let result = ''
      try {
        result = await tool.handler(parsed)
      } catch (err) {
        result = `error: ${err instanceof Error ? err.message : String(err)}`
      }
      const latency = Date.now() - t1
      args.audit?.tool({
        ts_start: new Date(t1).toISOString(),
        ts_end: new Date().toISOString(),
        latency_ms: latency,
        tool: tool.name,
        args: parsed,
        result: result.slice(0, 200),
      })
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: tool.name,
        content: result,
      })
    }

    if (answeredViaFinal) break
    if (toolCallCount >= MAX_TOOL_CALLS) {
      // Force a terminal step on the next loop iteration (tool_choice locked
      // to final_answer above).
      continue
    }
  }

  args.audit?.trace({
    ts: new Date().toISOString(),
    level: 'info',
    event: 'mastra_agent_done',
    data: {toolCallCount, finalAnswerBytes: finalAnswer?.length ?? 0},
  })

  return {finalAnswer, history: messages, toolCallCount}
}

/**
 * Drives a community reply for an incoming mention. Used by poll-driver in
 * Workstream B/C integration. Returns the final body or null on failure.
 */
export async function runMastraReply(opts: {
  question: string
  context: string
  mention: Mention
  cli: SeedCli
  audit?: AuditRun
}): Promise<string | null> {
  const tools = buildAgentTools({cli: opts.cli, audit: opts.audit})
  const userMessage =
    `Question (asked in comment ${opts.mention.commentId} on doc ${opts.mention.docId}):\n` +
    `${opts.question}\n\n` +
    (opts.context
      ? `Pre-fetched context (use the tools above to drill deeper if needed):\n${opts.context}`
      : `No pre-fetched context. Use the tools to gather what you need.`)

  const result = await runAgent({
    systemPrompt: COMMUNITY_AGENT_SYSTEM,
    userMessage,
    tools,
    audit: opts.audit,
    maxTokens: 500,
    temperature: 0.4,
  })
  return result.finalAnswer
}

/**
 * Operator-facing multi-turn chat. Caller persists `history` per chat id.
 */
export async function runMastraOperator(opts: {
  question: string
  systemContextBlob: string
  history?: Message[]
  cli: SeedCli
  audit?: AuditRun
}): Promise<{finalAnswer: string | null; history: Message[]}> {
  const tools = buildAgentTools({cli: opts.cli, audit: opts.audit})
  const userMessage = `Operator question: ${opts.question}\n\n## System context\n${opts.systemContextBlob}`
  const result = await runAgent({
    systemPrompt: OPERATOR_AGENT_SYSTEM,
    userMessage,
    history: opts.history,
    tools,
    audit: opts.audit,
    maxTokens: 800,
    temperature: 0.2,
  })
  return {finalAnswer: result.finalAnswer, history: result.history}
}

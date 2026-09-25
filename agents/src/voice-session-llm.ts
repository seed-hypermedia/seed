/**
 * The "LLM" stage of the voice pipeline is the Seed agent session itself.
 *
 * LiveKit's voice pipeline expects an {@link llm.LLM} that turns a chat context into a stream of
 * assistant text. {@link SeedSessionLLM} satisfies that contract by handing the user's transcript
 * to the agents server over the internal voice API: `POST /agents/api/voice/turn` appends the
 * transcript to the real session as a user message, runs the agent (tools, memory, model — all
 * as if typed), and streams the reply text back as NDJSON deltas, which this adapter re-emits as
 * {@link llm.ChatChunk}s for TTS.
 *
 * Consequences of the session being stateful:
 *  - only the LAST user message of the LiveKit chat context is sent; history lives in the session
 *  - the LiveKit `Agent` instructions and any tools are ignored (the session has its own)
 *  - every failure is non-retryable: a retry would post the transcript a second time
 *  - a reply may take minutes when the agent uses tools, so there is no client-side timeout;
 *    an interruption aborts the fetch through the stream's abort controller
 *
 * {@link VoiceServerClient} also carries the two non-streaming calls the worker makes around a
 * job: `room-config` (which session and speech keys a room maps to) and `leave`.
 */
import {DEFAULT_API_CONNECT_OPTIONS, llm, type APIConnectOptions} from '@livekit/agents'
import {SpeechTextStream} from './voice-speech-text'

/** Everything the worker needs to build the pipeline for one room. */
export type VoiceRoomConfig = {
  sessionId: string
  deepgramApiKey: string
  cartesiaApiKey: string
  deepgramModel: string
  cartesiaModel: string
  cartesiaVoice: string
  language: string
  turnDetector: boolean
}

export type VoiceTurnLine = {delta?: string; done?: boolean; text?: string; error?: string}

/** HTTP client for the agents server's internal voice routes (bearer-token guarded). */
export class VoiceServerClient {
  readonly #serverUrl: string
  readonly #token: string

  constructor(options: {serverUrl: string; token: string}) {
    this.#serverUrl = options.serverUrl.replace(/\/+$/, '')
    this.#token = options.token
  }

  get serverUrl(): string {
    return this.#serverUrl
  }

  async #post(route: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(`${this.#serverUrl}/agents/api/voice/${route}`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      throw new Error(`voice ${route} failed: HTTP ${res.status}${detail ? ` ${detail}` : ''}`)
    }
    return res
  }

  /** Resolves the session and speech-provider settings behind a LiveKit room. */
  async roomConfig(room: string): Promise<VoiceRoomConfig> {
    const res = await this.#post('room-config', {room})
    const json = (await res.json()) as Partial<VoiceRoomConfig>
    if (typeof json.sessionId !== 'string') throw new Error('voice room-config: response has no sessionId')
    return {
      sessionId: json.sessionId,
      deepgramApiKey: json.deepgramApiKey ?? '',
      cartesiaApiKey: json.cartesiaApiKey ?? '',
      deepgramModel: json.deepgramModel ?? 'nova-3',
      cartesiaModel: json.cartesiaModel ?? 'sonic-3',
      cartesiaVoice: json.cartesiaVoice ?? '',
      language: json.language ?? 'en',
      turnDetector: json.turnDetector === true,
    }
  }

  /** Sends one user turn into the session; the response body streams NDJSON reply lines. */
  async turn(room: string, text: string, signal: AbortSignal): Promise<Response> {
    return this.#post('turn', {room, text}, signal)
  }

  /** Tells the server the worker left the room so it can forget the room record. */
  async leave(room: string): Promise<void> {
    await this.#post('leave', {room})
  }
}

/** Reads an NDJSON body line by line, yielding parsed objects; blank lines are skipped. */
export async function* readNdjson(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<VoiceTurnLine> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const {value, done} = await reader.read()
      if (done) break
      buffer += decoder.decode(value, {stream: true})
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) yield JSON.parse(line) as VoiceTurnLine
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    const rest = buffer.trim()
    if (rest && !signal.aborted) yield JSON.parse(rest) as VoiceTurnLine
  } finally {
    reader.cancel().catch(() => {})
  }
}

/** The text of the most recent user message in the chat context, or undefined when there is none. */
export function lastUserText(chatCtx: llm.ChatContext): string | undefined {
  for (let i = chatCtx.items.length - 1; i >= 0; i--) {
    const item = chatCtx.items[i]
    if (item?.type === 'message' && item.role === 'user') {
      const text = item.textContent?.trim()
      return text ? text : undefined
    }
  }
  return undefined
}

export type SeedSessionLLMOptions = {
  client: VoiceServerClient
  room: string
  /** Called with each spoken delta and the final reply text, for logging. */
  onLog?: (line: string) => void
}

export class SeedSessionLLM extends llm.LLM {
  readonly #options: SeedSessionLLMOptions

  constructor(options: SeedSessionLLMOptions) {
    super()
    this.#options = options
  }

  label(): string {
    return 'seed.session'
  }

  override get model(): string {
    return 'seed-session'
  }

  override get provider(): string {
    return 'seed'
  }

  chat({chatCtx, connOptions}: {chatCtx: llm.ChatContext; connOptions?: APIConnectOptions}): llm.LLMStream {
    return new SeedSessionLLMStream(this, {
      chatCtx,
      // Never retry: a retried turn would post the transcript to the session again.
      connOptions: {...(connOptions ?? DEFAULT_API_CONNECT_OPTIONS), maxRetry: 0},
      options: this.#options,
    })
  }
}

class SeedSessionLLMStream extends llm.LLMStream {
  readonly #options: SeedSessionLLMOptions

  constructor(
    owner: SeedSessionLLM,
    init: {chatCtx: llm.ChatContext; connOptions: APIConnectOptions; options: SeedSessionLLMOptions},
  ) {
    super(owner, {chatCtx: init.chatCtx, connOptions: init.connOptions})
    this.#options = init.options
  }

  protected async run(): Promise<void> {
    const text = lastUserText(this.chatCtx)
    if (!text) return
    const signal = this.abortController.signal
    const id = `seed-turn-${crypto.randomUUID()}`
    const speech = new SpeechTextStream()
    const log = this.#options.onLog
    const emit = (content: string) => {
      if (!content) return
      this.queue.put({id, delta: {role: 'assistant', content}})
    }
    let res: Response
    try {
      res = await this.#options.client.turn(this.#options.room, text, signal)
    } catch (err) {
      if (signal.aborted) return
      throw err
    }
    if (!res.body) throw new Error('voice turn: empty response body')
    let finalText: string | undefined
    try {
      for await (const line of readNdjson(res.body, signal)) {
        if (typeof line.error === 'string') throw new Error(`voice turn: ${line.error}`)
        if (typeof line.delta === 'string' && line.delta.length > 0) emit(speech.push(line.delta))
        if (line.done) {
          finalText = line.text ?? ''
          break
        }
      }
    } catch (err) {
      if (signal.aborted) return
      throw err
    }
    if (signal.aborted) return
    emit(speech.flush())
    if (finalText === undefined) throw new Error('voice turn: stream ended without a done line')
    log?.(`[voice:llm] turn complete (${finalText.length} chars)`)
  }
}

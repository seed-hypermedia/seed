import {
  DEFAULT_API_CONNECT_OPTIONS,
  USERDATA_TIMED_TRANSCRIPT,
  tokenize,
  tts,
  type APIConnectOptions,
} from '@livekit/agents'

/**
 * Synthesizes complete sentences independently so tool pauses never leave a provider context
 * idle. Use bounded WebSocket requests: Cartesia 1.9's HTTP synthesize path sends a WebSocket-only
 * option and silently treats the resulting HTTP 400 as empty audio.
 */
export class SentenceTTS extends tts.StreamAdapter {
  private readonly boundedProvider: SentenceProvider
  private readonly sentences: tokenize.basic.SentenceTokenizer

  constructor(source: tts.TTS) {
    const provider = new SentenceProvider(source)
    const sentences = new tokenize.basic.SentenceTokenizer()
    super(provider, sentences)
    this.boundedProvider = provider
    this.sentences = sentences
  }

  /** Keeps sentence captions separated when LiveKit concatenates the timed text stream. */
  override stream(options?: {connOptions?: APIConnectOptions}): tts.StreamAdapterWrapper {
    return new SentenceCaptionStream(this.boundedProvider, this.sentences, options?.connOptions)
  }
}

class SentenceCaptionStream extends tts.StreamAdapterWrapper {
  override async next() {
    const result = await super.next()
    if (!result.done && result.value !== tts.SynthesizeStream.END_OF_STREAM) {
      const captions = result.value.frame.userdata[USERDATA_TIMED_TRANSCRIPT] as Array<{text: string}> | undefined
      // The basic tokenizer trims sentence separators. Timed text is concatenated, not joined,
      // by the client's transcription synchronizer, so preserve the boundary explicitly.
      for (const caption of captions ?? []) if (!/\s$/.test(caption.text)) caption.text += ' '
    }
    return result
  }
}

class SentenceProvider extends tts.TTS {
  label = 'seed.sentence-provider'
  constructor(private readonly source: tts.TTS) {
    super(source.sampleRate, source.numChannels, {streaming: false})
  }

  synthesize(text: string, options?: APIConnectOptions, signal?: AbortSignal): tts.ChunkedStream {
    return new SentenceAudio(text, this, this.source, options, signal)
  }

  stream(): tts.SynthesizeStream {
    throw new Error('SentenceProvider accepts only complete sentences')
  }
}

class SentenceAudio extends tts.ChunkedStream {
  label = 'seed.sentence-audio'
  constructor(
    private readonly text: string,
    private readonly owner: tts.TTS,
    private readonly source: tts.TTS,
    private readonly options?: APIConnectOptions,
    signal?: AbortSignal,
  ) {
    super(text, owner, options, signal)
  }

  protected async run(): Promise<void> {
    if (this.abortSignal.aborted) return
    // The outer chunk stream owns retries; never replay a partially spoken sentence internally.
    const stream = this.source.stream({connOptions: {...(this.options ?? DEFAULT_API_CONNECT_OPTIONS), maxRetry: 0}})
    const abort = () => stream.close()
    this.abortSignal.addEventListener('abort', abort, {once: true})
    let samples = 0
    try {
      stream.pushText(this.text)
      stream.endInput()
      for await (const audio of stream) {
        if (this.abortSignal.aborted) return
        if (audio === tts.SynthesizeStream.END_OF_STREAM) continue
        samples += audio.frame.samplesPerChannel
        // StreamAdapter adds sentence-level timing on its own timeline. Cartesia's word times
        // restart at zero for each bounded request and otherwise overwrite/duplicate those
        // captions in Agent.ttsNode. Forward the audio once, with only the adapter's alignment.
        delete audio.frame.userdata[USERDATA_TIMED_TRANSCRIPT]
        this.queue.put({...audio, timedTranscripts: undefined})
      }
      if (!samples && !this.abortSignal.aborted) throw new Error('Speech synthesis returned no audio')
    } catch (error) {
      if (!this.abortSignal.aborted) {
        // ChunkedStream's background task does not catch rejected run promises. Report through
        // the standard TTS error channel so AgentSession handles the failure, not the process.
        this.owner.emit('error', {
          type: 'tts_error',
          timestamp: Date.now(),
          label: this.label,
          error: error instanceof Error ? error : new Error(String(error)),
          recoverable: false,
        })
      }
    } finally {
      this.abortSignal.removeEventListener('abort', abort)
      stream.close()
    }
  }
}

import {beforeAll, expect, test} from 'bun:test'
import {
  DEFAULT_API_CONNECT_OPTIONS,
  AudioByteStream,
  USERDATA_TIMED_TRANSCRIPT,
  initializeLogger,
  tts,
  voice,
  type APIConnectOptions,
} from '@livekit/agents'
import {SentenceTTS} from './voice-tts'

beforeAll(() => initializeLogger({pretty: false, level: 'silent'}))

// No hosted synthesis: exercise the real LiveKit adapter with a bounded provider request.
class TestTTS extends tts.TTS {
  label = 'test'
  texts: string[] = []
  signals: AbortSignal[] = []
  active = 0
  empty = false
  aligned = false
  completed = Promise.withResolvers<void>()

  constructor() {
    super(24000, 1, {streaming: true})
  }

  synthesize(): tts.ChunkedStream {
    throw new Error('The broken HTTP synthesis endpoint must never be used')
  }

  stream(options?: {connOptions?: APIConnectOptions}): tts.SynthesizeStream {
    const provider = this
    const result = new (class extends tts.SynthesizeStream {
      label = 'test-stream'
      async run() {
        provider.active++
        let text = ''
        try {
          for await (const input of this.input) {
            if (typeof input === 'string') text += input
          }
          if (this.abortSignal.aborted) return
          provider.texts.push(text)
          if (!provider.empty)
            this.queue.put({
              timedTranscripts: provider.aligned
                ? [voice.createTimedString({text: 'provider word ', startTime: 0, endTime: 0.01})]
                : undefined,
              requestId: 'test',
              segmentId: 'test',
              final: true,
              frame: new AudioByteStream(24000, 1, 240).write(new Int16Array(240).buffer)[0]!,
            })
          this.queue.put(tts.SynthesizeStream.END_OF_STREAM)
        } finally {
          provider.active--
          provider.completed.resolve()
        }
      }
    })(this, options?.connOptions)
    this.signals.push(result.abortSignal)
    return result
  }
}

test('finishes synthesis before a tool pause and speaks later text exactly once', async () => {
  const provider = new TestTTS()
  const speech = new SentenceTTS(provider)
  const stream = speech.stream()
  let samples = 0
  const drain = (async () => {
    for await (const audio of stream) {
      if (audio !== tts.SynthesizeStream.END_OF_STREAM) samples += audio.frame.samplesPerChannel
    }
  })()
  stream.pushText('I am checking that for you now. ')
  stream.flush()
  await provider.completed.promise
  // The tool can take arbitrarily long here: there is no provider context/timer left running.
  expect(provider.active).toBe(0)
  expect(provider.texts).toEqual(['I am checking that for you now.'])
  stream.pushText('Here is the complete answer after checking. And the final detail.')
  stream.endInput()
  await drain
  expect(provider.texts.join(' ')).toBe(
    'I am checking that for you now. Here is the complete answer after checking. And the final detail.',
  )
  expect(samples).toBeGreaterThan(0)
  await speech.close()
})

test('interruption aborts synthesis and never starts the buffered remainder', async () => {
  const provider = new TestTTS()
  const speech = new SentenceTTS(provider)
  const stream = speech.stream()
  let samples = 0
  const drain = (async () => {
    for await (const audio of stream) {
      if (audio !== tts.SynthesizeStream.END_OF_STREAM) samples += audio.frame.samplesPerChannel
    }
  })()
  stream.pushText('Here is a complete opening sentence. ')
  stream.flush()
  await provider.completed.promise
  stream.pushText('Unfinished remainder')
  stream.close()
  await drain
  expect(provider.signals[0]?.aborted).toBe(true)
  expect(provider.texts).toEqual(['Here is a complete opening sentence.'])
  await speech.close()
})

test('empty provider output is an error, not a successful silent reply', async () => {
  const provider = new TestTTS()
  provider.empty = true
  const speech = new SentenceTTS(provider)
  const errors: string[] = []
  speech.on('error', (event) => errors.push(event.error.message))
  const stream = speech.stream({connOptions: {...DEFAULT_API_CONNECT_OPTIONS, maxRetry: 0}})
  stream.pushText('This sentence must not silently disappear.')
  stream.endInput()
  for await (const _ of stream) {
    /* drain */
  }
  expect(errors.some((message) => message.includes('no audio'))).toBe(true)
  await speech.close()
})

test('sentence adapter emits one transcript timeline even when the source provides word timestamps', async () => {
  const provider = new TestTTS()
  provider.aligned = true
  const speech = new SentenceTTS(provider)
  const stream = speech.stream()
  const text = 'Yes, I am receiving you. Can you hear this reply clearly?'
  stream.pushText(text)
  stream.endInput()
  const captions: string[] = []
  for await (const audio of stream) {
    if (audio === tts.SynthesizeStream.END_OF_STREAM) continue
    // The real Agent.ttsNode gives packet-level timestamps precedence over frame userdata.
    expect(audio.timedTranscripts).toBeUndefined()
    const timed = audio.frame.userdata[USERDATA_TIMED_TRANSCRIPT] as Array<{text: string}> | undefined
    captions.push(...(timed || []).map((item) => item.text))
  }
  expect(captions.join('').trimEnd()).toBe(text)
  expect(provider.texts.join(' ')).toBe(text)
  await speech.close()
})

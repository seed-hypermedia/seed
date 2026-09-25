import {describe, expect, test} from 'bun:test'
import * as config from '@/config'

describe('config', () => {
  test('explicit local API and IPFS flags beat the environment', () => {
    // Packaged desktop builds pin both local surfaces explicitly; a developer shell must never
    // redirect the spawned binary to another node.
    const parsed = config.parseArgs(
      ['--hm-server-url=http://localhost:56004', '--ipfs-server-url=http://localhost:56001'],
      {
        SEED_AGENTS_HM_SERVER_URL: 'https://somewhere-else.example',
        SEED_AGENTS_IPFS_SERVER_URL: 'https://files.somewhere-else.example',
      } as NodeJS.ProcessEnv,
    )
    expect(config.create(parsed).activity).toMatchObject({
      hmServerUrl: 'http://localhost:56004',
      ipfsServerUrl: 'http://localhost:56001',
    })
  })

  test('the IPFS server can be split from the HM API or default to the same origin', () => {
    const fromEnv = config.create(
      config.flags({
        SEED_AGENTS_HM_SERVER_URL: 'http://localhost:58004',
        SEED_AGENTS_IPFS_SERVER_URL: 'http://localhost:58001',
      } as NodeJS.ProcessEnv),
    )
    expect(fromEnv.activity).toMatchObject({
      hmServerUrl: 'http://localhost:58004',
      ipfsServerUrl: 'http://localhost:58001',
    })

    const bare = config.create(config.flags({} as NodeJS.ProcessEnv))
    expect(bare.activity).toMatchObject({
      hmServerUrl: 'https://hyper.media',
      ipfsServerUrl: 'https://hyper.media',
    })
  })

  test('log level defaults to info, honors env and flag, and rejects unknown levels', () => {
    expect(config.create(config.flags({} as NodeJS.ProcessEnv)).logLevel).toBe('info')
    expect(config.create(config.flags({SEED_AGENTS_LOG_LEVEL: 'debug'} as NodeJS.ProcessEnv)).logLevel).toBe('debug')
    expect(config.create(config.parseArgs(['--log-level', 'warn'], {} as NodeJS.ProcessEnv)).logLevel).toBe('warn')
    expect(() => config.create(config.flags({SEED_AGENTS_LOG_LEVEL: 'loud'} as NodeJS.ProcessEnv))).toThrow(
      'Invalid log level',
    )
  })

  test('voice is off by default, with dev LiveKit credentials and placeholder speech keys', () => {
    const bare = config.create(config.flags({} as NodeJS.ProcessEnv)).voice
    expect(bare).toEqual({
      enabled: false,
      livekitUrl: 'ws://localhost:7880',
      livekitPublicUrl: 'ws://localhost:7880',
      livekitApiKey: 'devkey',
      livekitApiSecret: 'secret',
      deepgramApiKey: 'your-deepgram-api-key',
      cartesiaApiKey: 'your-cartesia-api-key',
      deepgramModel: 'nova-3',
      cartesiaModel: 'sonic-3',
      cartesiaVoice: '6c9e08ad-6629-4ba3-a640-a0bae916dfff',
      language: 'en',
      turnDetector: false,
      worker: 'off',
      internalToken: undefined,
      agentName: 'seed-voice',
    })
    // Placeholders and blanks are "not configured"; anything else counts as a server key.
    expect(config.isVoiceKeyConfigured('your-deepgram-api-key')).toBe(false)
    expect(config.isVoiceKeyConfigured('your-cartesia-api-key')).toBe(false)
    expect(config.isVoiceKeyConfigured('  ')).toBe(false)
    expect(config.isVoiceKeyConfigured('dg_live_123')).toBe(true)
  })

  test('voice env and flags: enabling defaults the worker to child; public URL falls back to the internal one', () => {
    const fromEnv = config.create(
      config.flags({
        SEED_AGENTS_VOICE_ENABLED: 'true',
        SEED_AGENTS_LIVEKIT_URL: 'ws://livekit:7880/',
        SEED_AGENTS_LIVEKIT_PUBLIC_URL: 'wss://voice.example.com',
        SEED_AGENTS_LIVEKIT_API_KEY: 'k',
        SEED_AGENTS_LIVEKIT_API_SECRET: 's',
        SEED_AGENTS_DEEPGRAM_API_KEY: 'dg',
        SEED_AGENTS_CARTESIA_API_KEY: 'ca',
        SEED_AGENTS_VOICE_TURN_DETECTOR: '1',
        SEED_AGENTS_VOICE_WORKER: 'external',
        SEED_AGENTS_VOICE_INTERNAL_TOKEN: 'shared',
        SEED_AGENTS_VOICE_LANGUAGE: 'es',
      } as NodeJS.ProcessEnv),
    ).voice
    expect(fromEnv).toMatchObject({
      enabled: true,
      livekitUrl: 'ws://livekit:7880',
      livekitPublicUrl: 'wss://voice.example.com',
      livekitApiKey: 'k',
      livekitApiSecret: 's',
      deepgramApiKey: 'dg',
      cartesiaApiKey: 'ca',
      turnDetector: true,
      worker: 'external',
      internalToken: 'shared',
      language: 'es',
    })

    const flagged = config.create(
      config.parseArgs(['--voice-enabled=1', '--livekit-url', 'ws://127.0.0.1:7880'], {
        SEED_AGENTS_VOICE_WORKER: 'off',
      } as NodeJS.ProcessEnv),
    ).voice
    expect(flagged).toMatchObject({
      enabled: true,
      livekitUrl: 'ws://127.0.0.1:7880',
      livekitPublicUrl: 'ws://127.0.0.1:7880',
      worker: 'off',
    })
    expect(config.create(config.flags({SEED_AGENTS_VOICE_ENABLED: '1'} as NodeJS.ProcessEnv)).voice.worker).toBe(
      'child',
    )
    expect(() =>
      config.create(
        config.flags({SEED_AGENTS_VOICE_ENABLED: '1', SEED_AGENTS_VOICE_WORKER: 'thread'} as NodeJS.ProcessEnv),
      ),
    ).toThrow('Invalid voice worker mode')
    expect(() => config.create(config.flags({SEED_AGENTS_LIVEKIT_URL: 'ftp://livekit'} as NodeJS.ProcessEnv))).toThrow(
      'LiveKit URL',
    )
  })
})

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

  test('convert settings come from the environment with Datalab defaults and accept flags', () => {
    const defaults = config.create(config.flags({} as NodeJS.ProcessEnv)).convert
    expect(defaults).toEqual({
      datalabApiKey: undefined,
      relayUrl: undefined,
      mode: 'accurate',
      extras: 'extract_links,chart_understanding,infographic',
      concurrency: 4,
      allowancePagesPerMonth: 1000,
      globalCeilingPagesPerMonth: 20000,
    })
    const fromEnv = config.create(
      config.flags({
        SEED_AGENTS_DATALAB_API_KEY: ' key-1 ',
        SEED_AGENTS_CONVERT_RELAY_URL: 'https://agents.example/',
        SEED_AGENTS_DATALAB_MODE: 'balanced',
        SEED_AGENTS_DATALAB_EXTRAS: ' extract_links , infographic,',
        SEED_AGENTS_DATALAB_CONCURRENCY: '2',
        SEED_AGENTS_DATALAB_ALLOWANCE_PAGES_PER_MONTH: '50',
        SEED_AGENTS_DATALAB_GLOBAL_CEILING_PAGES_PER_MONTH: '500',
      } as NodeJS.ProcessEnv),
    ).convert
    expect(fromEnv).toEqual({
      datalabApiKey: 'key-1',
      relayUrl: 'https://agents.example',
      mode: 'balanced',
      extras: 'extract_links,infographic',
      concurrency: 2,
      allowancePagesPerMonth: 50,
      globalCeilingPagesPerMonth: 500,
    })
    const fromFlags = config.create(
      config.parseArgs(
        ['--convert-relay-url=http://127.0.0.1:3051', '--datalab-allowance-pages', '7'],
        {} as NodeJS.ProcessEnv,
      ),
    ).convert
    expect(fromFlags.relayUrl).toBe('http://127.0.0.1:3051')
    expect(fromFlags.allowancePagesPerMonth).toBe(7)
    expect(() => config.parseArgs(['--datalab-concurrency=abc'], {} as NodeJS.ProcessEnv)).toThrow(
      /datalab-concurrency/,
    )
    expect(() => config.create(config.flags({SEED_AGENTS_DATALAB_MODE: 'turbo'} as NodeJS.ProcessEnv))).toThrow(
      /datalab-mode/,
    )
    expect(() => config.create(config.flags({SEED_AGENTS_CONVERT_RELAY_URL: 'ftp://x'} as NodeJS.ProcessEnv))).toThrow(
      /relay URL/,
    )
  })

  test('log level defaults to info, honors env and flag, and rejects unknown levels', () => {
    expect(config.create(config.flags({} as NodeJS.ProcessEnv)).logLevel).toBe('info')
    expect(config.create(config.flags({SEED_AGENTS_LOG_LEVEL: 'debug'} as NodeJS.ProcessEnv)).logLevel).toBe('debug')
    expect(config.create(config.parseArgs(['--log-level', 'warn'], {} as NodeJS.ProcessEnv)).logLevel).toBe('warn')
    expect(() => config.create(config.flags({SEED_AGENTS_LOG_LEVEL: 'loud'} as NodeJS.ProcessEnv))).toThrow(
      'Invalid log level',
    )
  })
})

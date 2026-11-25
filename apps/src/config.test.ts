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

  test('SEED_APPS_* names are read, and win over the SEED_AGENTS_* names deployments still set', () => {
    const both = config.flags({
      SEED_APPS_HTTP_PORT: '4000',
      SEED_AGENTS_HTTP_PORT: '5000',
      SEED_AGENTS_LOG_LEVEL: 'debug',
    } as NodeJS.ProcessEnv)
    expect(both['server-port']).toBe(4000)
    expect(both['log-level']).toBe('debug')
    expect(config.envVar({SEED_AGENTS_DATA_DIR: '/old'} as NodeJS.ProcessEnv, 'DATA_DIR')).toBe('/old')
    expect(config.envVar({} as NodeJS.ProcessEnv, 'DATA_DIR')).toBeUndefined()
  })

  test('the public URL is where clients reach this server, without a trailing slash', () => {
    expect(config.create(config.flags({} as NodeJS.ProcessEnv)).publicUrl).toBeUndefined()
    expect(
      config.create(config.flags({SEED_APPS_PUBLIC_URL: 'https://hyper.media/hm/api/apps/'} as NodeJS.ProcessEnv))
        .publicUrl,
    ).toBe('https://hyper.media/hm/api/apps')
    expect(config.create(config.parseArgs(['--public-url=https://site.example/hm/api/apps'], {})).publicUrl).toBe(
      'https://site.example/hm/api/apps',
    )
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

  test('the free-disk floor defaults to 512 MiB, honors env and flag, and zero turns it off', () => {
    expect(config.create(config.flags({} as NodeJS.ProcessEnv)).storage.minFreeDiskBytes).toBe(512 * 1_048_576)
    expect(
      config.create(config.flags({SEED_AGENTS_MIN_FREE_DISK_MIB: '0'} as NodeJS.ProcessEnv)).storage.minFreeDiskBytes,
    ).toBe(0)
    expect(
      config.create(config.parseArgs(['--min-free-disk-mib=1024'], {} as NodeJS.ProcessEnv)).storage.minFreeDiskBytes,
    ).toBe(1024 * 1_048_576)
    expect(() => config.parseArgs(['--min-free-disk-mib=-1'], {} as NodeJS.ProcessEnv)).toThrow()
    expect(() => config.parseArgs(['--min-free-disk-mib=lots'], {} as NodeJS.ProcessEnv)).toThrow()
  })
  test('database tuning and retention default to the hosted values and honor env and flags', () => {
    const defaults = config.create(config.flags({} as NodeJS.ProcessEnv)).database
    expect(defaults).toMatchObject({
      cacheBytes: 256 * 1_048_576,
      mmapBytes: 1024 * 1_048_576,
      walLimitBytes: 64 * 1_048_576,
      toolOutputStoreLimitChars: 128 * 1024,
      retention: {mode: 'on', durableIdleMs: 14 * 86_400_000, journalAgeMs: 30 * 86_400_000},
    })
    const tuned = config.create(
      config.parseArgs(['--retention', 'report', '--retention-journal-days=0.5'], {
        SEED_AGENTS_SQLITE_CACHE_MIB: '512',
        SEED_AGENTS_RETENTION_DURABLE_IDLE_DAYS: '0',
        SEED_AGENTS_TOOL_OUTPUT_STORE_LIMIT_KIB: '0',
      } as NodeJS.ProcessEnv),
    ).database
    expect(tuned.cacheBytes).toBe(512 * 1_048_576)
    expect(tuned.toolOutputStoreLimitChars).toBe(0)
    expect(tuned.retention).toMatchObject({mode: 'report', durableIdleMs: 0, journalAgeMs: 43_200_000})
    expect(
      config.create(config.flags({SEED_AGENTS_RETENTION: 'off'} as NodeJS.ProcessEnv)).database.retention.mode,
    ).toBe('off')
    expect(() => config.create(config.flags({SEED_AGENTS_RETENTION: 'maybe'} as NodeJS.ProcessEnv))).toThrow()
    expect(() => config.create(config.flags({SEED_AGENTS_SQLITE_CACHE_MIB: 'lots'} as NodeJS.ProcessEnv))).toThrow()
    expect(() => config.parseArgs(['--retention-mib-per-sec=-1'], {} as NodeJS.ProcessEnv)).toThrow()
  })
})

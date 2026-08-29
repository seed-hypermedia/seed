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
})

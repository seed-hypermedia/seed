import {describe, expect, test} from 'bun:test'
import * as config from '@/config'

describe('config', () => {
  test('an explicit --hm-server-url flag beats the environment', () => {
    // Packaged desktop builds pin their spawned agents server to the user's local daemon with an
    // explicit flag; a stray SEED_AGENTS_HM_SERVER_URL in the user's shell (e.g. the dev env
    // pointing at the dev daemon) must never redirect them.
    const parsed = config.parseArgs(['--hm-server-url=http://localhost:58001'], {
      SEED_AGENTS_HM_SERVER_URL: 'https://somewhere-else.example',
    } as NodeJS.ProcessEnv)
    expect(config.create(parsed).activity.hmServerUrl).toBe('http://localhost:58001')
  })

  test('the environment beats the built-in default, which stands alone otherwise', () => {
    const fromEnv = config.flags({SEED_AGENTS_HM_SERVER_URL: 'http://localhost:58001'} as NodeJS.ProcessEnv)
    expect(fromEnv['hm-server-url']).toBe('http://localhost:58001')
    const bare = config.flags({} as NodeJS.ProcessEnv)
    expect(bare['hm-server-url']).toBe('https://hyper.media')
  })
})

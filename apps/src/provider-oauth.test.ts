import {describe, expect, test} from 'bun:test'
import type * as piAi from '@earendil-works/pi-ai'
import {
  loginOpenAICodexHeadless,
  parseAuthorizationInput,
  PersistedOAuthStore,
  ProviderOAuthManager,
  type OAuthLoginFn,
} from '@/provider-oauth'

type OAuthCredentials = piAi.OAuthCredentials

const CREDENTIALS: OAuthCredentials = {
  access: 'access-token',
  refresh: 'refresh-token',
  expires: Date.now() + 3600_000,
  accountId: 'acct_123',
}

/** Login fn mirroring pi's flow: announce the auth URL, then wait for a manually submitted code. */
function manualCodeLogin(
  codeToCredentials: (code: string) => OAuthCredentials | Promise<OAuthCredentials>,
): OAuthLoginFn {
  return async ({onAuth, onManualCodeInput}) => {
    onAuth({url: 'https://auth.openai.com/oauth/authorize?test=1'})
    const code = await onManualCodeInput()
    return codeToCredentials(code)
  }
}

describe('ProviderOAuthManager', () => {
  test('runs a full login: authUrl, manual code submission, completion with secret name', async () => {
    const manager = new ProviderOAuthManager({openai: manualCodeLogin(() => CREDENTIALS)})
    const stored: OAuthCredentials[] = []
    const started = await manager.start('acc-1', 'openai', async (credentials) => {
      stored.push(credentials)
      return 'openai-subscription-oauth'
    })
    expect(started.status).toBe('pending')
    expect(started.authUrl).toContain('https://auth.openai.com/oauth/authorize')

    manager.submitCode('acc-1', started.loginId, 'the-code')
    await Bun.sleep(1)

    const status = manager.status('acc-1', started.loginId)
    expect(status.status).toBe('completed')
    expect(status.secretName).toBe('openai-subscription-oauth')
    expect(stored).toEqual([CREDENTIALS])
  })

  test('a code submitted before the flow asks for one is queued, not lost', async () => {
    let askedForCode = false
    const manager = new ProviderOAuthManager({
      openai: async ({onAuth, onManualCodeInput}) => {
        onAuth({url: 'https://example.com/auth'})
        await Bun.sleep(5)
        askedForCode = true
        const code = await onManualCodeInput()
        expect(code).toBe('early-code')
        return CREDENTIALS
      },
    })
    const started = await manager.start('acc-1', 'openai', async () => 'secret')
    manager.submitCode('acc-1', started.loginId, 'early-code')
    expect(askedForCode).toBe(false)
    await Bun.sleep(10)
    expect(manager.status('acc-1', started.loginId).status).toBe('completed')
  })

  test('a failing login reports failed with the error message', async () => {
    const manager = new ProviderOAuthManager({
      openai: manualCodeLogin(() => {
        throw new Error('Token exchange failed')
      }),
    })
    const started = await manager.start('acc-1', 'openai', async () => 'secret')
    manager.submitCode('acc-1', started.loginId, 'bad-code')
    await Bun.sleep(1)
    const status = manager.status('acc-1', started.loginId)
    expect(status.status).toBe('failed')
    expect(status.error).toBe('Token exchange failed')
  })

  test('cancel fails the pending login and unwinds the flow', async () => {
    let flowError: unknown
    const manager = new ProviderOAuthManager({
      openai: async ({onAuth, onManualCodeInput}) => {
        onAuth({url: 'https://example.com/auth'})
        try {
          await onManualCodeInput()
        } catch (error) {
          flowError = error
          throw error
        }
        return CREDENTIALS
      },
    })
    const started = await manager.start('acc-1', 'openai', async () => 'secret')
    const canceled = manager.cancel('acc-1', started.loginId)
    expect(canceled.status).toBe('failed')
    expect(canceled.error).toBe('Sign-in canceled')
    await Bun.sleep(1)
    expect(flowError).toBeInstanceOf(Error)
    // Late completion after cancel must not store credentials.
    expect(() => manager.submitCode('acc-1', started.loginId, 'late')).toThrow('no longer pending')
  })

  test('starting a new login for the same account replaces the pending one', async () => {
    const manager = new ProviderOAuthManager({openai: manualCodeLogin(() => CREDENTIALS)})
    const first = await manager.start('acc-1', 'openai', async () => 'secret')
    const second = await manager.start('acc-1', 'openai', async () => 'secret')
    expect(manager.status('acc-1', first.loginId).status).toBe('failed')
    expect(manager.status('acc-1', first.loginId).error).toBe('Replaced by a new sign-in')
    expect(manager.status('acc-1', second.loginId).status).toBe('pending')
  })

  test('logins are scoped to the account that started them', async () => {
    const manager = new ProviderOAuthManager({openai: manualCodeLogin(() => CREDENTIALS)})
    const started = await manager.start('acc-1', 'openai', async () => 'secret')
    expect(() => manager.status('acc-2', started.loginId)).toThrow('Sign-in not found')
    expect(() => manager.submitCode('acc-2', started.loginId, 'code')).toThrow('Sign-in not found')
  })

  test('unsupported provider types are rejected', async () => {
    const manager = new ProviderOAuthManager()
    await expect(manager.start('acc-1', 'anthropic', async () => 'secret')).rejects.toThrow(
      'does not support subscription sign-in',
    )
  })
})

describe('parseAuthorizationInput', () => {
  test('accepts a full redirect URL, a query string, code#state, and a bare code', () => {
    expect(parseAuthorizationInput('http://localhost:1455/auth/callback?code=abc&state=xyz')).toEqual({
      code: 'abc',
      state: 'xyz',
    })
    expect(parseAuthorizationInput('code=abc&state=xyz')).toEqual({code: 'abc', state: 'xyz'})
    expect(parseAuthorizationInput('abc#xyz')).toEqual({code: 'abc', state: 'xyz'})
    expect(parseAuthorizationInput('  abc  ')).toEqual({code: 'abc'})
    expect(parseAuthorizationInput('')).toEqual({})
  })
})

describe('loginOpenAICodexHeadless', () => {
  /** Unsigned JWT with the ChatGPT account claim, shaped like OpenAI's access token. */
  function fakeAccessToken(chatgptAccountId: string): string {
    const payload = Buffer.from(
      JSON.stringify({'https://api.openai.com/auth': {chatgpt_account_id: chatgptAccountId}}),
    ).toString('base64url')
    return `x.${payload}.y`
  }

  test('never binds a listener: code arrives via submit, token exchange uses the PKCE verifier', async () => {
    const originalFetch = globalThis.fetch
    let tokenRequest: URLSearchParams | undefined
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      tokenRequest = new URLSearchParams(String(init?.body))
      return Response.json({access_token: fakeAccessToken('acct_42'), refresh_token: 'refresh-42', expires_in: 3600})
    }) as typeof fetch
    try {
      let authUrl = ''
      const credentials = await loginOpenAICodexHeadless({
        onAuth: (info) => {
          authUrl = info.url
        },
        onPrompt: async () => {
          throw new Error('unused')
        },
        onManualCodeInput: async () => {
          const state = new URL(authUrl).searchParams.get('state')
          return `http://localhost:1455/auth/callback?code=the-code&state=${state}`
        },
      })
      const params = new URL(authUrl).searchParams
      expect(params.get('client_id')).toBeTruthy()
      expect(params.get('redirect_uri')).toBe('http://localhost:1455/auth/callback')
      expect(params.get('code_challenge_method')).toBe('S256')
      expect(tokenRequest?.get('code')).toBe('the-code')
      expect(tokenRequest?.get('code_verifier')).toBeTruthy()
      expect(credentials.accountId).toBe('acct_42')
      expect(credentials.access).toContain('.')
      expect(credentials.refresh).toBe('refresh-42')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('rejects a submitted redirect whose state does not match', async () => {
    await expect(
      loginOpenAICodexHeadless({
        onAuth: () => {},
        onPrompt: async () => {
          throw new Error('unused')
        },
        onManualCodeInput: async () => 'http://localhost:1455/auth/callback?code=abc&state=wrong',
      }),
    ).rejects.toThrow('State mismatch')
  })
})

describe('PersistedOAuthStore', () => {
  test('persists modifications and serializes concurrent writers', async () => {
    const persisted: string[] = []
    const store = new PersistedOAuthStore('openai-codex', {...CREDENTIALS, access: 'a1'}, async (credential) => {
      await Bun.sleep(2)
      persisted.push(credential.access)
    })

    const reads: string[] = []
    await Promise.all([
      store.modify('openai-codex', async (current) => {
        reads.push((current as piAi.OAuthCredential).access)
        await Bun.sleep(1)
        return {...CREDENTIALS, type: 'oauth', access: 'a2'}
      }),
      store.modify('openai-codex', async (current) => {
        reads.push((current as piAi.OAuthCredential).access)
        return {...CREDENTIALS, type: 'oauth', access: 'a3'}
      }),
    ])

    // The second writer saw the first one's write, and both writes persisted in order.
    expect(reads).toEqual(['a1', 'a2'])
    expect(persisted).toEqual(['a2', 'a3'])
    expect(((await store.read('openai-codex')) as piAi.OAuthCredential).access).toBe('a3')
    expect(await store.read('anthropic')).toBeUndefined()
    expect(await store.list()).toEqual([{providerId: 'openai-codex', type: 'oauth'}])
  })

  test('a failing persist callback does not break subsequent access', async () => {
    const store = new PersistedOAuthStore('openai-codex', CREDENTIALS, async () => {
      throw new Error('disk full')
    })
    const next = await store.modify('openai-codex', async () => ({...CREDENTIALS, type: 'oauth', access: 'updated'}))
    expect((next as piAi.OAuthCredential).access).toBe('updated')
    expect(((await store.read('openai-codex')) as piAi.OAuthCredential).access).toBe('updated')
  })

  test('a rejected modification propagates and leaves the credential unchanged', async () => {
    const store = new PersistedOAuthStore('openai-codex', CREDENTIALS, async () => {})
    await expect(
      store.modify('openai-codex', async () => {
        throw new Error('invalid_grant')
      }),
    ).rejects.toThrow('invalid_grant')
    expect(((await store.read('openai-codex')) as piAi.OAuthCredential).access).toBe(CREDENTIALS.access)
  })
})

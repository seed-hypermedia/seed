import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import z from 'zod'
import {appInvalidateQueries} from './app-invalidation'
import {userDataPath} from './app-paths'
import {t} from './app-trpc'

const configPath = path.join(userDataPath, 'ai-config.json')

// Types

export type AgentProviderType = 'openai' | 'anthropic' | 'ollama'
export type OpenAIAuthMode = 'apiKey' | 'login'

type OpenAIAuthSession = {
  idToken: string
  accessToken: string
  refreshToken: string
  email?: string
  chatgptAccountId?: string
  chatgptPlanType?: string
  lastRefreshAt: string
}

export type AgentProvider = {
  id: string
  label: string
  type: AgentProviderType
  model: string
  apiKey?: string
  baseUrl?: string
  authMode?: OpenAIAuthMode
  openaiAuth?: OpenAIAuthSession
}

type AIConfig = {
  agentProviders?: AgentProvider[]
  selectedProviderId?: string
  lastUsedProviderId?: string
  // Legacy fields kept for migration
  providers?: {openai?: {apiKey?: string}}
}

type OpenAILoginSessionStatus = 'pending' | 'success' | 'error'

type OpenAILoginSession = {
  id: string
  providerId: string
  userCode: string
  deviceAuthId: string
  verificationUrl: string
  intervalSeconds: number
  status: OpenAILoginSessionStatus
  message?: string
  email?: string
  chatgptPlanType?: string
  chatgptAccountId?: string
  timeout: NodeJS.Timeout
}

type OpenAITokenResponse = {
  id_token: string
  access_token: string
  refresh_token: string
}

type OpenAIDeviceCodeResponse = {
  device_auth_id?: unknown
  user_code?: unknown
  usercode?: unknown
  interval?: unknown
}

type OpenAIDevicePollSuccessResponse = {
  authorization_code?: unknown
  code_verifier?: unknown
}

type OpenAIRefreshResponse = {
  id_token?: string
  access_token?: string
  refresh_token?: string
}

const OPENAI_AUTH_ISSUER = 'https://auth.openai.com'
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_REFRESH_TOKEN_URL = `${OPENAI_AUTH_ISSUER}/oauth/token`
const OPENAI_REFRESH_INTERVAL_MS = 8 * 60 * 1000
const OPENAI_LOGIN_TIMEOUT_MS = 15 * 60 * 1000
const OPENAI_DEVICE_AUTH_USER_CODE_URL = `${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/usercode`
const OPENAI_DEVICE_AUTH_TOKEN_URL = `${OPENAI_AUTH_ISSUER}/api/accounts/deviceauth/token`
const OPENAI_DEVICE_AUTH_BROWSER_URL = `${OPENAI_AUTH_ISSUER}/codex/device`
const OPENAI_DEVICE_AUTH_REDIRECT_URI = `${OPENAI_AUTH_ISSUER}/deviceauth/callback`
const openaiLoginSessions = new Map<string, OpenAILoginSession>()

// Config read/write

export async function readConfig(): Promise<AIConfig> {
  try {
    const content = await fs.readFile(configPath, 'utf-8')
    const config: AIConfig = JSON.parse(content)
    return migrateConfig(config)
  } catch {
    return {}
  }
}

async function writeConfig(config: AIConfig): Promise<void> {
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
  appInvalidateQueries(['AI_CONFIG'])
  appInvalidateQueries(['AI_PROVIDERS'])
  appInvalidateQueries(['AI_SELECTED_PROVIDER'])
  appInvalidateQueries(['AI_LAST_USED_PROVIDER'])
}

// Migration from old format

function migrateConfig(config: AIConfig): AIConfig {
  if (config.agentProviders) return config
  const legacyKey = config.providers?.openai?.apiKey
  if (!legacyKey) return config
  const provider: AgentProvider = {
    id: crypto.randomUUID(),
    label: 'OpenAI',
    type: 'openai',
    model: 'gpt-4o-mini',
    apiKey: legacyKey,
    authMode: 'apiKey',
  }
  const migrated: AIConfig = {
    ...config,
    agentProviders: [provider],
    selectedProviderId: provider.id,
  }
  // Write migrated config back (fire-and-forget)
  writeConfig(migrated).catch(() => {})
  return migrated
}

// Legacy helpers for backward compat

function getNestedValue(obj: Record<string, any>, path: string): any {
  const keys = path.split('.')
  let current: any = obj
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined
    current = current[key]
  }
  return current
}

function setNestedValue(obj: Record<string, any>, path: string, value: any): Record<string, any> {
  const keys = path.split('.')
  const result = {...obj}
  let current: any = result
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    current[key] = current[key] != null && typeof current[key] === 'object' ? {...current[key]} : {}
    current = current[key]
  }
  current[keys[keys.length - 1]] = value
  return result
}

function maskApiKey(key?: string): string | undefined {
  if (!key) return undefined
  if (key.length <= 7) return '*'.repeat(key.length)
  return key.slice(0, 7) + '*'.repeat(Math.min(20, key.length - 7))
}

function stripSensitiveOpenAIAuth(auth?: OpenAIAuthSession) {
  if (!auth) return undefined
  return {
    email: auth.email,
    chatgptAccountId: auth.chatgptAccountId,
    chatgptPlanType: auth.chatgptPlanType,
    lastRefreshAt: auth.lastRefreshAt,
  }
}

function providerForRenderer(provider: AgentProvider, mode: 'list' | 'edit') {
  const isOpenAILogin = provider.type === 'openai' && provider.authMode === 'login'
  return {
    ...provider,
    apiKey: isOpenAILogin ? undefined : mode === 'list' ? maskApiKey(provider.apiKey) : provider.apiKey,
    openaiAuth: stripSensitiveOpenAIAuth(provider.openaiAuth),
  }
}

function parseJwtClaims(token: string): Record<string, any> {
  const parts = token.split('.')
  if (parts.length < 2 || !parts[1]) return {}
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
    const auth =
      payload && typeof payload['https://api.openai.com/auth'] === 'object'
        ? payload['https://api.openai.com/auth']
        : {}
    const profile =
      payload && typeof payload['https://api.openai.com/profile'] === 'object'
        ? payload['https://api.openai.com/profile']
        : {}
    return {
      ...auth,
      ...profile,
      ...(typeof payload?.email === 'string' ? {email: payload.email} : {}),
    }
  } catch {
    return {}
  }
}

function buildOpenAIAuthSession(tokens: {
  idToken: string
  accessToken: string
  refreshToken: string
}): OpenAIAuthSession {
  const claims = parseJwtClaims(tokens.idToken)
  return {
    ...tokens,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    chatgptAccountId: typeof claims.chatgpt_account_id === 'string' ? claims.chatgpt_account_id : undefined,
    chatgptPlanType: typeof claims.chatgpt_plan_type === 'string' ? claims.chatgpt_plan_type : undefined,
    lastRefreshAt: new Date().toISOString(),
  }
}

function isOpenAIProviderUsingLogin(provider: AgentProvider): boolean {
  return provider.type === 'openai' && provider.authMode === 'login'
}

function shouldRefreshOpenAIAuth(provider: AgentProvider): boolean {
  if (!isOpenAIProviderUsingLogin(provider)) return false
  if (!provider.openaiAuth?.lastRefreshAt || !provider.openaiAuth?.accessToken) return true
  const lastRefresh = Date.parse(provider.openaiAuth.lastRefreshAt)
  if (!Number.isFinite(lastRefresh)) return true
  return Date.now() - lastRefresh > OPENAI_REFRESH_INTERVAL_MS
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseDeviceAuthIntervalSeconds(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 5
}

async function requestOpenAIDeviceCode(): Promise<{
  userCode: string
  deviceAuthId: string
  intervalSeconds: number
}> {
  const res = await fetch(OPENAI_DEVICE_AUTH_USER_CODE_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({client_id: OPENAI_CLIENT_ID}),
  })
  if (!res.ok) {
    const message = await parseFailedResponseMessage(res)
    throw new Error(`OpenAI device login request failed: ${message}`)
  }
  const data = (await res.json()) as OpenAIDeviceCodeResponse
  const userCodeRaw = typeof data.user_code === 'string' ? data.user_code : data.usercode
  if (typeof userCodeRaw !== 'string' || !userCodeRaw) {
    throw new Error('OpenAI device login did not return a user code.')
  }
  if (typeof data.device_auth_id !== 'string' || !data.device_auth_id) {
    throw new Error('OpenAI device login did not return a device auth ID.')
  }
  return {
    userCode: userCodeRaw,
    deviceAuthId: data.device_auth_id,
    intervalSeconds: parseDeviceAuthIntervalSeconds(data.interval),
  }
}

async function pollOpenAIDeviceAuthorizationCode(
  sessionId: string,
): Promise<{authorizationCode: string; codeVerifier: string}> {
  const initialSession = openaiLoginSessions.get(sessionId)
  if (!initialSession) throw new Error('OpenAI login session not found.')

  while (true) {
    const session = openaiLoginSessions.get(sessionId)
    if (!session) throw new Error('OpenAI login session expired.')
    if (session.status !== 'pending') throw new Error(session.message || 'OpenAI login was cancelled.')

    const res = await fetch(OPENAI_DEVICE_AUTH_TOKEN_URL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        device_auth_id: session.deviceAuthId,
        user_code: session.userCode,
      }),
    })

    if (res.ok) {
      const data = (await res.json()) as OpenAIDevicePollSuccessResponse
      if (typeof data.authorization_code !== 'string' || !data.authorization_code) {
        throw new Error('OpenAI device login did not return an authorization code.')
      }
      if (typeof data.code_verifier !== 'string' || !data.code_verifier) {
        throw new Error('OpenAI device login did not return a code verifier.')
      }
      return {
        authorizationCode: data.authorization_code,
        codeVerifier: data.code_verifier,
      }
    }

    if (res.status === 403 || res.status === 404) {
      await delay(Math.max(1, initialSession.intervalSeconds) * 1000)
      continue
    }

    const message = await parseFailedResponseMessage(res)
    throw new Error(`OpenAI device login failed: ${message}`)
  }
}

async function parseFailedResponseMessage(res: Response) {
  const bodyText = await res.text().catch(() => '')
  if (!bodyText) return `HTTP ${res.status}`

  try {
    const body = JSON.parse(bodyText)
    if (typeof body?.error_description === 'string' && body.error_description) return body.error_description
    if (typeof body?.error?.message === 'string' && body.error.message) return body.error.message
    if (typeof body?.error === 'string' && body.error) return body.error
  } catch {}

  return bodyText
}

async function exchangeAuthorizationCode(params: {
  code: string
  codeVerifier: string
  redirectUri: string
}): Promise<OpenAITokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: OPENAI_CLIENT_ID,
    code_verifier: params.codeVerifier,
  })
  const res = await fetch(OPENAI_REFRESH_TOKEN_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body,
  })
  if (!res.ok) {
    const message = await parseFailedResponseMessage(res)
    throw new Error(`OpenAI login failed: ${message}`)
  }
  return (await res.json()) as OpenAITokenResponse
}

async function refreshOpenAITokens(refreshToken: string): Promise<OpenAIRefreshResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: OPENAI_CLIENT_ID,
    refresh_token: refreshToken,
  })
  const res = await fetch(OPENAI_REFRESH_TOKEN_URL, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body,
  })
  if (!res.ok) {
    const message = await parseFailedResponseMessage(res)
    throw new Error(`OpenAI login refresh failed: ${message}`)
  }
  return (await res.json()) as OpenAIRefreshResponse
}

function setLoginSessionError(session: OpenAILoginSession, message: string) {
  session.status = 'error'
  session.message = message
}

function completeLoginSessionSuccess(session: OpenAILoginSession, authSession: OpenAIAuthSession) {
  session.status = 'success'
  session.message = 'Connected'
  session.email = authSession.email
  session.chatgptPlanType = authSession.chatgptPlanType
  session.chatgptAccountId = authSession.chatgptAccountId
}

async function runOpenAILoginSession(sessionId: string) {
  try {
    const {authorizationCode, codeVerifier} = await pollOpenAIDeviceAuthorizationCode(sessionId)
    const activeSession = openaiLoginSessions.get(sessionId)
    if (!activeSession || activeSession.status !== 'pending') return

    const tokens = await exchangeAuthorizationCode({
      code: authorizationCode,
      codeVerifier,
      redirectUri: OPENAI_DEVICE_AUTH_REDIRECT_URI,
    })
    const authSession = buildOpenAIAuthSession({
      idToken: tokens.id_token,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    })
    await persistOpenAILoginForProvider(activeSession.providerId, authSession)
    completeLoginSessionSuccess(activeSession, authSession)
  } catch (error) {
    const activeSession = openaiLoginSessions.get(sessionId)
    if (activeSession && activeSession.status === 'pending') {
      const message = (error as Error).message || 'OpenAI login failed.'
      setLoginSessionError(activeSession, message)
    }
  } finally {
    const activeSession = openaiLoginSessions.get(sessionId)
    if (!activeSession) return
    clearTimeout(activeSession.timeout)
    setTimeout(() => openaiLoginSessions.delete(activeSession.id), 5 * 60 * 1000)
  }
}

async function persistOpenAILoginForProvider(providerId: string, authSession: OpenAIAuthSession) {
  const config = await readConfig()
  const providers = config.agentProviders || []
  const index = providers.findIndex((provider) => provider.id === providerId)
  if (index === -1) throw new Error('Provider not found')
  const provider = providers[index]
  if (provider.type !== 'openai') throw new Error('Provider is not OpenAI')
  providers[index] = {
    ...provider,
    authMode: 'login',
    openaiAuth: authSession,
    apiKey: undefined,
  }
  config.agentProviders = providers
  await writeConfig(config)
}

async function resolveOpenAIProvider(
  providerId: string,
): Promise<{config: AIConfig; index: number; provider: AgentProvider}> {
  const config = await readConfig()
  const providers = config.agentProviders || []
  const index = providers.findIndex((provider) => provider.id === providerId)
  if (index === -1) throw new Error('Provider not found')
  return {config, index, provider: providers[index]}
}

async function refreshOpenAILoginProvider(providerId: string): Promise<AgentProvider> {
  const {config, index, provider} = await resolveOpenAIProvider(providerId)
  if (!isOpenAIProviderUsingLogin(provider)) return provider
  const authSession = provider.openaiAuth
  if (!authSession?.refreshToken) {
    throw new Error('OpenAI login is missing refresh credentials. Please reconnect.')
  }

  const refreshResponse = await refreshOpenAITokens(authSession.refreshToken)
  const idToken = refreshResponse.id_token || authSession.idToken
  const accessToken = refreshResponse.access_token || authSession.accessToken
  const refreshToken = refreshResponse.refresh_token || authSession.refreshToken
  const nextAuthSession = buildOpenAIAuthSession({idToken, accessToken, refreshToken})
  const nextProvider: AgentProvider = {
    ...provider,
    authMode: 'login',
    openaiAuth: nextAuthSession,
    apiKey: undefined,
  }
  const providers = config.agentProviders || []
  providers[index] = nextProvider
  config.agentProviders = providers
  await writeConfig(config)
  return nextProvider
}

// Zod schemas

const agentProviderTypeSchema = z.enum(['openai', 'anthropic', 'ollama'])
const openAIAuthModeSchema = z.enum(['apiKey', 'login'])

const addProviderSchema = z.object({
  type: agentProviderTypeSchema,
  label: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  authMode: openAIAuthModeSchema.optional(),
})

const updateProviderSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  type: agentProviderTypeSchema.optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  authMode: openAIAuthModeSchema.optional(),
})

const DEFAULT_LABELS: Record<AgentProviderType, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
}

const DEFAULT_MODELS: Record<AgentProviderType, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-20250514',
  ollama: 'llama3',
}

export async function setLastUsedProvider(providerId: string) {
  const config = await readConfig()
  config.lastUsedProviderId = providerId
  await writeConfig(config)
}

export async function resolveProviderForUsage(providerId: string): Promise<AgentProvider> {
  const {provider} = await resolveOpenAIProvider(providerId)
  if (!shouldRefreshOpenAIAuth(provider)) return provider
  return await refreshOpenAILoginProvider(providerId)
}

async function listOpenAIModelsFromApiKey(apiKey: string): Promise<string[]> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: {Authorization: `Bearer ${apiKey}`},
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return []
    const data = await res.json()
    const models: string[] = (data.data || [])
      .filter(
        (m: any) =>
          m.id &&
          !m.id.includes('realtime') &&
          !m.id.includes('audio') &&
          !m.id.includes('tts') &&
          !m.id.includes('whisper') &&
          !m.id.includes('dall-e') &&
          !m.id.includes('embedding') &&
          !m.id.includes('moderation') &&
          !m.id.includes('davinci') &&
          !m.id.includes('babbage'),
      )
      .map((m: any) => m.id as string)
      .sort()
    return models
  } catch {
    return []
  }
}

// tRPC router

export const aiConfigApi = t.router({
  // Legacy endpoints
  get: t.procedure.query(async () => {
    return await readConfig()
  }),
  getValue: t.procedure.input(z.string()).query(async ({input}) => {
    const config = await readConfig()
    return getNestedValue(config as Record<string, any>, input) ?? null
  }),
  setValue: t.procedure.input(z.object({path: z.string(), value: z.any()})).mutation(async ({input}) => {
    const config = await readConfig()
    const updated = setNestedValue(config as Record<string, any>, input.path, input.value)
    await writeConfig(updated)
    return null
  }),

  // Provider CRUD
  listProviders: t.procedure.query(async () => {
    const config = await readConfig()
    const providers = config.agentProviders || []
    return providers.map((provider) => providerForRenderer(provider, 'list'))
  }),

  getProvider: t.procedure.input(z.string()).query(async ({input}) => {
    const config = await readConfig()
    const provider = (config.agentProviders || []).find((p) => p.id === input)
    if (!provider) return null
    return providerForRenderer(provider, 'edit')
  }),

  addProvider: t.procedure.input(addProviderSchema).mutation(async ({input}) => {
    const config = await readConfig()
    const providers = config.agentProviders || []
    const openAIAuthMode = input.type === 'openai' ? input.authMode || 'apiKey' : undefined
    const provider: AgentProvider = {
      id: crypto.randomUUID(),
      label: input.label || DEFAULT_LABELS[input.type],
      type: input.type,
      model: input.model || DEFAULT_MODELS[input.type],
      apiKey: input.type === 'openai' && openAIAuthMode === 'login' ? undefined : input.apiKey,
      baseUrl: input.type === 'ollama' ? input.baseUrl || 'http://localhost:11434' : input.baseUrl,
      ...(input.type === 'openai' ? {authMode: openAIAuthMode} : {}),
    }
    providers.push(provider)
    config.agentProviders = providers
    if (!config.selectedProviderId) {
      config.selectedProviderId = provider.id
    }
    await writeConfig(config)
    return provider
  }),

  updateProvider: t.procedure.input(updateProviderSchema).mutation(async ({input}) => {
    const config = await readConfig()
    const providers = config.agentProviders || []
    const idx = providers.findIndex((p) => p.id === input.id)
    if (idx === -1) throw new Error('Provider not found')
    const existing = providers[idx]
    const updated: AgentProvider = {
      ...existing,
      ...(input.label !== undefined ? {label: input.label} : {}),
      ...(input.type !== undefined ? {type: input.type} : {}),
      ...(input.model !== undefined ? {model: input.model} : {}),
      ...(input.apiKey !== undefined ? {apiKey: input.apiKey} : {}),
      ...(input.baseUrl !== undefined ? {baseUrl: input.baseUrl} : {}),
      ...(input.type !== 'openai' ? {authMode: undefined, openaiAuth: undefined} : {}),
    }

    if (updated.type === 'openai') {
      const nextAuthMode = input.authMode || updated.authMode || 'apiKey'
      updated.authMode = nextAuthMode
      if (nextAuthMode === 'apiKey' && input.authMode === 'apiKey') {
        updated.openaiAuth = undefined
      }
      if (nextAuthMode === 'login' && input.authMode === 'login') {
        updated.apiKey = undefined
      }
    } else {
      updated.authMode = undefined
      updated.openaiAuth = undefined
    }

    providers[idx] = updated
    config.agentProviders = providers
    await writeConfig(config)
    return providerForRenderer(updated, 'edit')
  }),

  duplicateProvider: t.procedure.input(z.string()).mutation(async ({input}) => {
    const config = await readConfig()
    const providers = config.agentProviders || []
    const source = providers.find((p) => p.id === input)
    if (!source) throw new Error('Provider not found')
    const duplicate: AgentProvider = {
      ...source,
      id: crypto.randomUUID(),
      label: source.label + ' (copy)',
    }
    providers.push(duplicate)
    config.agentProviders = providers
    await writeConfig(config)
    return duplicate
  }),

  deleteProvider: t.procedure.input(z.string()).mutation(async ({input}) => {
    const config = await readConfig()
    config.agentProviders = (config.agentProviders || []).filter((p) => p.id !== input)
    if (config.selectedProviderId === input) {
      config.selectedProviderId = config.agentProviders[0]?.id
    }
    await writeConfig(config)
    return null
  }),

  setSelectedProvider: t.procedure.input(z.string()).mutation(async ({input}) => {
    const config = await readConfig()
    config.selectedProviderId = input
    await writeConfig(config)
    return null
  }),

  getSelectedProvider: t.procedure.query(async () => {
    const config = await readConfig()
    if (!config.selectedProviderId || !config.agentProviders) return null
    const provider = config.agentProviders.find((p) => p.id === config.selectedProviderId)
    return provider ? providerForRenderer(provider, 'list') : null
  }),

  getLastUsedProviderId: t.procedure.query(async () => {
    const config = await readConfig()
    return config.lastUsedProviderId || null
  }),

  startOpenaiLogin: t.procedure.input(z.object({providerId: z.string()})).mutation(async ({input}) => {
    const {provider} = await resolveOpenAIProvider(input.providerId)
    if (provider.type !== 'openai') throw new Error('Provider is not OpenAI')

    const sessionsToDelete: string[] = []
    openaiLoginSessions.forEach((existingSession) => {
      if (existingSession.providerId === input.providerId && existingSession.status === 'pending') {
        setLoginSessionError(existingSession, 'Superseded by a newer login attempt.')
        clearTimeout(existingSession.timeout)
        sessionsToDelete.push(existingSession.id)
      }
    })
    sessionsToDelete.forEach((sessionId) => openaiLoginSessions.delete(sessionId))

    const deviceCode = await requestOpenAIDeviceCode()
    const sessionId = crypto.randomUUID()
    const timeout = setTimeout(() => {
      const session = openaiLoginSessions.get(sessionId)
      if (!session || session.status !== 'pending') return
      setLoginSessionError(session, 'Login timed out. Please try again.')
      setTimeout(() => openaiLoginSessions.delete(session.id), 5 * 60 * 1000)
    }, OPENAI_LOGIN_TIMEOUT_MS)

    const session: OpenAILoginSession = {
      id: sessionId,
      providerId: input.providerId,
      userCode: deviceCode.userCode,
      deviceAuthId: deviceCode.deviceAuthId,
      verificationUrl: OPENAI_DEVICE_AUTH_BROWSER_URL,
      intervalSeconds: deviceCode.intervalSeconds,
      status: 'pending',
      timeout,
    }
    openaiLoginSessions.set(sessionId, session)

    void runOpenAILoginSession(sessionId)

    return {
      sessionId,
      authUrl: OPENAI_DEVICE_AUTH_BROWSER_URL,
      userCode: session.userCode,
    }
  }),

  getOpenaiLoginStatus: t.procedure.input(z.string()).query(async ({input}) => {
    const session = openaiLoginSessions.get(input)
    if (!session) {
      return {status: 'error' as const, message: 'Login session not found.'}
    }
    return {
      status: session.status,
      message: session.message,
      userCode: session.userCode,
      verificationUrl: session.verificationUrl,
      email: session.email,
      chatgptPlanType: session.chatgptPlanType,
      chatgptAccountId: session.chatgptAccountId,
    }
  }),

  listOpenaiModels: t.procedure.input(z.string()).query(async ({input: apiKey}) => {
    return await listOpenAIModelsFromApiKey(apiKey)
  }),

  listOpenaiModelsForProvider: t.procedure.input(z.string()).query(async ({input: providerId}) => {
    try {
      const provider = await resolveProviderForUsage(providerId)
      if (provider.type !== 'openai' || !provider.apiKey) return []
      return await listOpenAIModelsFromApiKey(provider.apiKey)
    } catch {
      return []
    }
  }),

  listAnthropicModels: t.procedure.input(z.string()).query(async ({input: apiKey}) => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) return []
      const data = await res.json()
      return (data.data || []).map((m: any) => m.id as string).sort()
    } catch {
      return []
    }
  }),

  listOllamaModels: t.procedure.input(z.string()).query(async ({input}) => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(`${input}/api/tags`, {signal: controller.signal})
      clearTimeout(timeout)
      if (!res.ok) return []
      const data = await res.json()
      return (data.models || []).map((m: any) => m.name as string)
    } catch {
      return []
    }
  }),
})

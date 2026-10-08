import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {SEED_HOST_URL} from '@shm/shared/constants'
import {getQueryClient} from '@shm/shared/models/query-client'
import {useMutation, useQuery, type MutateOptions} from '@tanstack/react-query'
import {useEffect, useRef, useSyncExternalStore} from 'react'
import z from 'zod'

/** Hosting API AbsorbResponseSchema contract, shared with the desktop hosting flow. */
export const AbsorbResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    sessionToken: z.string(),
    userId: z.string(),
    email: z.string(),
  }),
  z.object({
    status: z.literal('error'),
    message: z.string(),
  }),
  z.object({
    status: z.literal('pending'),
  }),
])
/** Hosting API AbsorbResponse contract, shared with the desktop hosting flow. */
export type AbsorbResponse = z.infer<typeof AbsorbResponseSchema>

/** Hosting API CodeStartResponseSchema contract, shared with the desktop hosting flow. */
export const CodeStartResponseSchema = z.object({
  status: z.literal('code-sent'),
  email: z.string(),
  binding: z.string(),
  expireTime: z.number(),
  resendAllowedTime: z.number(),
})
/** Hosting API CodeStartResponse contract, shared with the desktop hosting flow. */
export type CodeStartResponse = z.infer<typeof CodeStartResponseSchema>

/** Hosting API CreateSiteRequestSchema contract, shared with the desktop hosting flow. */
export const CreateSiteRequestSchema = z.object({
  subdomain: z.string(),
})
/** Hosting API CreateSiteRequest contract, shared with the desktop hosting flow. */
export type CreateSiteRequest = z.infer<typeof CreateSiteRequestSchema>

/** Hosting API CreateSiteResponseSchema contract, shared with the desktop hosting flow. */
export const CreateSiteResponseSchema = z.object({
  subdomain: z.string(),
  host: z.string(),
  registrationSecret: z.string(),
  setupUrl: z.string(),
})
/** Hosting API CreateSiteResponse contract, shared with the desktop hosting flow. */
export type CreateSiteResponse = z.infer<typeof CreateSiteResponseSchema>

/** Hosting API CreateSiteDomainRequestSchema contract, shared with the desktop hosting flow. */
export const CreateSiteDomainRequestSchema = z.object({
  hostname: z.string(),
  currentSiteUrl: z.string(),
})
/** Hosting API CreateSiteDomainRequest contract, shared with the desktop hosting flow. */
export type CreateSiteDomainRequest = z.infer<typeof CreateSiteDomainRequestSchema>

/** Hosting API CreateSiteDomainResponseSchema contract, shared with the desktop hosting flow. */
export const CreateSiteDomainResponseSchema = z.object({
  hostname: z.string(),
  domainId: z.string(),
})
/** Hosting API CreateSiteDomainResponse contract, shared with the desktop hosting flow. */
export type CreateSiteDomainResponse = z.infer<typeof CreateSiteDomainResponseSchema>

/** Hosting API HostInfoResponseSchema contract, shared with the desktop hosting flow. */
export const HostInfoResponseSchema = z.object({
  serviceErrorMessage: z.string().optional(),
  minimumAppVersion: z.string().optional(),
  hostDomain: z.string().optional(),
  pricing: z
    .object({
      free: z
        .object({
          gbStorage: z.number(),
          gbBandwidth: z.number(),
          siteCount: z.number(),
        })
        .or(z.null()),
      premium: z
        .object({
          gbStorage: z.number(),
          gbBandwidth: z.number(),
          siteCount: z.number(),
          gbStorageOverageUSDCents: z.number(),
          gbBandwidthOverageUSDCents: z.number(),
          siteCountOverageUSDCents: z.number(),
          monthlyPriceUSDCents: z.number(),
        })
        .or(z.null()),
    })
    .optional(),
})
/** Hosting API HostInfoResponse contract, shared with the desktop hosting flow. */
export type HostInfoResponse = z.infer<typeof HostInfoResponseSchema>

/** A site owned by the authenticated hosting account, with its gateway identity. */
export const HostedSiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  activeConfig: z
    .object({registeredAccountUid: z.string().optional(), availableRegistrationSecret: z.string().optional()})
    .nullable(),
  customDomains: z.array(z.string()).default([]),
  services: z.array(
    z.object({
      serviceEnd: z.string().nullable(),
      plan: z.object({dedicatedServerType: z.string().nullable().optional()}),
    }),
  ),
})
/** Hosting ownership is distinct from the space's signing identity. */
export type HostedSite = z.infer<typeof HostedSiteSchema>

const PendingSiteMoveSchema = z.object({
  id: z.string(),
  siteUid: z.string(),
  oldName: z.string(),
  newName: z.string(),
  oldUrl: z.string().url(),
  hostUrl: z.string().url(),
  email: z.string(),
})
/** Durable intent for recovering the hosting/publication halves of an address change. */
export type PendingSiteMove = z.infer<typeof PendingSiteMoveSchema>
const PendingDomainSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  siteUid: z.string(),
  currentSiteUrl: z.string().url(),
  hostingSiteUrl: z.string().url().optional(),
  status: z.enum(['waiting-dns', 'initializing', 'error']),
  email: z.string(),
  errorMessage: z.string().optional(),
})
const HostStateSchema = z.object({
  authVersion: z.number().int().nonnegative(),
  authGeneration: z.string().default(''),
  email: z.string().nullable(),
  sessionToken: z.string().nullable(),
  pendingDomains: z.array(PendingDomainSchema),
  pendingSiteMoves: z.array(PendingSiteMoveSchema),
})
type HostState = z.infer<typeof HostStateSchema>
const emptyState: HostState = {
  authVersion: 0,
  authGeneration: '',
  email: null,
  sessionToken: null,
  pendingDomains: [],
  pendingSiteMoves: [],
}
const storageKey = `seed-host-v1:${SEED_HOST_URL}`
const listeners = new Set<() => void>()
let snapshot = emptyState
let storageValue: string | null | undefined
const cancelingDomains = new Set<string>()
const domainPublications = new Map<string, Promise<void>>()

function readState(): HostState {
  if (typeof window === 'undefined') return emptyState
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (raw !== storageValue) {
      storageValue = raw
      try {
        const parsed = HostStateSchema.safeParse(raw ? JSON.parse(raw) : emptyState)
        snapshot = parsed.success ? parsed.data : emptyState
        if (!snapshot.authGeneration) snapshot = {...snapshot, authGeneration: crypto.randomUUID()}
      } catch {
        snapshot = {...emptyState, authGeneration: crypto.randomUUID()}
      }
    }
  } catch {
    // Storage can be unavailable in privacy modes. The in-memory logout still works.
  }
  return snapshot
}

function writeState(state: HostState, requirePersistence = true) {
  if (typeof window === 'undefined') throw new Error('Hosting sign-in requires a browser.')
  const raw = JSON.stringify(state)
  try {
    window.localStorage.setItem(storageKey, raw)
    storageValue = raw
  } catch {
    if (requirePersistence) throw new Error('Browser storage is unavailable. Enable storage before managing hosting.')
    // A quota failure must not leave old credentials ready to reload.
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      /* Storage itself may be disabled. */
    }
    storageValue = null
  }
  snapshot = state
  listeners.forEach((listener) => listener())
}

function clearAccountQueries() {
  const client = getQueryClient()
  for (const key of ['HOST_SITES', 'HOST_DOMAINS']) {
    void client.cancelQueries({queryKey: [key, SEED_HOST_URL]})
    client.removeQueries({queryKey: [key, SEED_HOST_URL]})
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey && event.key !== null) return
    const previous = snapshot
    readState()
    if (previous.authGeneration !== snapshot.authGeneration || previous.sessionToken !== snapshot.sessionToken)
      clearAccountQueries()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function assertSession(generation: string) {
  if (readState().authGeneration !== generation) throw new Error('Hosting session changed. Please sign in again.')
}

async function hostAPI(path: string, method: string, body?: unknown, state?: HostState, signal?: AbortSignal) {
  if (state) {
    assertSession(state.authGeneration)
    if (!state.sessionToken) throw new Error('Sign in to Seed Hosting first.')
  }
  const response = await fetch(`${SEED_HOST_URL}/api/${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
      ...(state?.sessionToken ? {Authorization: `Bearer ${state.sessionToken}`} : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (state) assertSession(state.authGeneration)
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw Object.assign(new Error(data?.message || `Hosting request failed (${response.status})`), {
      status: response.status,
    })
  }
  const data = await response.json()
  if (state) assertSession(state.authGeneration)
  return data
}

/** Clear this browser's hosting credentials immediately and attempt bearer-session revocation. */
export async function logoutHosting() {
  if (typeof window === 'undefined') return
  const state = readState()
  writeState(
    {
      ...emptyState,
      authVersion: state.authVersion + 1,
      authGeneration: crypto.randomUUID(),
      pendingSiteMoves: state.pendingSiteMoves,
      pendingDomains: state.pendingDomains,
    },
    false,
  )
  clearAccountQueries()
  if (!state.sessionToken) return
  try {
    await fetch(`${SEED_HOST_URL}/api/auth/logout`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${state.sessionToken}`},
      signal: AbortSignal.timeout(5_000),
    })
  } catch {
    // An offline service cannot prevent local logout; the remote session will expire.
  }
}

function useAuthMutation<TInput, TData>(run: (input: TInput, version: string) => Promise<TData>) {
  const mutation = useMutation<TData, Error, {input: TInput; version: string}>({
    mutationFn: ({input, version}) => run(input, version),
  })
  function optionsFor(input: TInput, options?: MutateOptions<TData, Error, TInput>) {
    return {
      onSuccess: (data: TData, _variables: unknown, context: unknown) => options?.onSuccess?.(data, input, context),
      onError: (error: Error, _variables: unknown, context: unknown) => options?.onError?.(error, input, context),
      onSettled: (data: TData | undefined, error: Error | null, _variables: unknown, context: unknown) =>
        options?.onSettled?.(data, error, input, context),
    }
  }
  return {
    ...mutation,
    mutate: (input: TInput, options?: MutateOptions<TData, Error, TInput>) =>
      mutation.mutate({input, version: readState().authGeneration}, optionsFor(input, options)),
    mutateAsync: (input: TInput, options?: MutateOptions<TData, Error, TInput>) =>
      mutation.mutateAsync({input, version: readState().authGeneration}, optionsFor(input, options)),
  }
}

/** Browser implementation of the desktop hosting contract, scoped to the configured service. */
export function useHostSession({
  onAuthenticated,
  includeSites = false,
}: {onAuthenticated?: () => void; includeSites?: boolean} = {}) {
  const loadedState = useSyncExternalStore(subscribe, readState, () => undefined)
  const hostState = loadedState || emptyState
  const callback = useRef(onAuthenticated)
  callback.current = onAuthenticated
  const previousToken = useRef(hostState.sessionToken)
  useEffect(() => {
    if (hostState.sessionToken && hostState.sessionToken !== previousToken.current) callback.current?.()
    previousToken.current = hostState.sessionToken
  }, [hostState.sessionToken])
  const invalidateSites = () => getQueryClient().invalidateQueries({queryKey: ['HOST_SITES', SEED_HOST_URL]})
  const startEmailCode = useAuthMutation(async (email: string, version) => {
    assertSession(version)
    const response = CodeStartResponseSchema.parse(await hostAPI('auth/code/start', 'POST', {email}))
    assertSession(version)
    return response
  })
  const verifyEmailCode = useAuthMutation(async (input: {email: string; binding: string; code: string}, version) => {
    assertSession(version)
    if (!/^\d{4}$/.test(input.code)) throw new Error('Enter the four-digit code from your email.')
    const response = AbsorbResponseSchema.parse(await hostAPI('auth/code/verify', 'POST', input))
    assertSession(version)
    if (response.status !== 'success') throw new Error(response.status === 'error' ? response.message : 'Login failed')
    const current = readState()
    // Commit synchronously with the generation check; an onSuccess callback is too late.
    writeState({
      ...current,
      authVersion: current.authVersion + 1,
      authGeneration: crypto.randomUUID(),
      email: response.email,
      sessionToken: response.sessionToken,
    })
    clearAccountQueries()
  })
  const loginWithVault = useMutation({
    mutationFn: async () => {
      // Browser delegation sessions contain no vault-signed email prevalidation proof.
      // Calling the gateway daemon here would authenticate its owner, not this visitor.
      throw new Error('Sign in to Seed Hosting with a four-digit email code.')
    },
  })
  const sites = useQuery({
    queryKey: ['HOST_SITES', SEED_HOST_URL, hostState.authGeneration],
    queryFn: async ({signal}) => {
      const state = readState()
      const owned = z.array(HostedSiteSchema).parse(await hostAPI('sites', 'GET', undefined, state, signal))
      return Promise.all(
        owned.map(async (site) => ({
          ...site,
          customDomains: z
            .array(z.object({hostname: z.string()}))
            .parse(await hostAPI(`sites/${encodeURIComponent(site.id)}/domains`, 'GET', undefined, state, signal))
            .map((domain) => domain.hostname),
        })),
      )
    },
    enabled: includeSites && !!hostState.sessionToken,
    keepPreviousData: false,
    staleTime: 30_000,
    useErrorBoundary: false,
    meta: {handlesErrorLocally: true},
  })
  const hostInfo = useQuery({
    queryKey: ['HOST_INFO', SEED_HOST_URL],
    queryFn: async ({signal}) => {
      try {
        const response = HostInfoResponseSchema.safeParse(await hostAPI('info', 'GET', undefined, undefined, signal))
        return response.success
          ? response.data
          : ({
              serviceErrorMessage: 'Host API incompatible with this app. Please update to the latest version.',
            } satisfies HostInfoResponse)
      } catch {
        return null
      }
    },
    useErrorBoundary: false,
  })
  const clearPendingSiteMove = async (id: string) => {
    const state = readState()
    writeState({
      ...state,
      pendingSiteMoves: state.pendingSiteMoves.filter(
        (move) => move.id !== id || move.hostUrl !== SEED_HOST_URL || move.email !== state.email,
      ),
    })
  }
  const renameSite = useMutation({
    mutationFn: async (input: {id: string; name: string; currentName: string; siteUid: string; currentUrl: string}) => {
      const state = readState()
      if (!state.email || !state.sessionToken) throw new Error('Sign in to Seed Hosting before changing the address.')
      const move: PendingSiteMove = {
        id: input.id,
        siteUid: input.siteUid,
        oldName: input.currentName,
        newName: input.name,
        oldUrl: input.currentUrl,
        hostUrl: SEED_HOST_URL,
        email: state.email,
      }
      const existing = state.pendingSiteMoves.find(
        (pending) => pending.id === move.id && pending.hostUrl === move.hostUrl,
      )
      if (
        existing &&
        (existing.newName !== move.newName || existing.siteUid !== move.siteUid || existing.email !== move.email)
      )
        throw new Error('Finish the pending address change before starting another move.')
      writeState({
        ...state,
        pendingSiteMoves: [...state.pendingSiteMoves.filter((pending) => pending !== existing), move],
      })
      try {
        return z
          .object({id: z.string(), name: z.string(), url: z.string().url()})
          .parse(
            await hostAPI(
              `sites/${encodeURIComponent(input.id)}`,
              'PATCH',
              {name: input.name, currentName: input.currentName},
              state,
            ),
          )
      } catch (error) {
        if (
          error instanceof Error &&
          'status' in error &&
          typeof error.status === 'number' &&
          error.status < 500 &&
          readState().authGeneration === state.authGeneration
        )
          await clearPendingSiteMove(input.id)
        throw error
      }
    },
    onSettled: invalidateSites,
  })
  const recoverSiteMove = useMutation({
    mutationFn: async (move: PendingSiteMove) => {
      const state = readState()
      if (move.hostUrl !== SEED_HOST_URL || move.email !== state.email)
        throw new Error('Sign in to the hosting account that started this move.')
      const site = HostedSiteSchema.parse(
        await hostAPI(`sites/${encodeURIComponent(move.id)}`, 'GET', undefined, state),
      )
      if (site.activeConfig?.registeredAccountUid !== move.siteUid)
        throw new Error('This hosted site is no longer registered to the space.')
      if (site.name === move.newName) return site.url
      if (site.name !== move.oldName)
        throw new Error('The hosting address changed again. Review it in Seed Hosting before updating publication.')
      return z
        .object({url: z.string().url()})
        .parse(
          await hostAPI(
            `sites/${encodeURIComponent(move.id)}`,
            'PATCH',
            {name: move.newName, currentName: move.oldName},
            state,
          ),
        ).url
    },
    onSettled: invalidateSites,
  })
  const transferSite = useMutation({
    mutationFn: async (input: {id: string; email: string; currentName: string}) =>
      z
        .object({success: z.literal(true), email: z.string()})
        .parse(
          await hostAPI(
            `sites/${encodeURIComponent(input.id)}/transfer`,
            'POST',
            {email: input.email, currentName: input.currentName},
            readState(),
          ),
        ),
    onSuccess: invalidateSites,
  })
  const createSite = useMutation({
    mutationFn: async (input: CreateSiteRequest) =>
      CreateSiteResponseSchema.parse(await hostAPI('sites', 'POST', input, readState())),
    onSuccess: invalidateSites,
  })
  const createDomain = useMutation({
    mutationFn: async ({
      hostname,
      currentSiteUrl,
      hostingSiteUrl,
      id,
    }: {
      hostname: string
      currentSiteUrl: string
      hostingSiteUrl: string
      id: UnpackedHypermediaId
    }) => {
      const state = readState()
      const result = CreateSiteDomainResponseSchema.parse(
        await hostAPI('domains', 'POST', {hostname, currentSiteUrl: hostingSiteUrl}, state),
      )
      assertSession(state.authGeneration)
      const current = readState()
      writeState({
        ...current,
        pendingDomains: [
          ...current.pendingDomains,
          {
            hostname: result.hostname,
            id: result.domainId,
            siteUid: id.uid,
            currentSiteUrl,
            hostingSiteUrl,
            status: 'waiting-dns',
            email: state.email!,
          },
        ],
      })
      await getQueryClient().invalidateQueries({queryKey: ['HOST_DOMAINS', SEED_HOST_URL]})
      return result
    },
  })
  const cancelPendingDomain = useMutation({
    mutationFn: async (id: string) => {
      const state = readState()
      if (!state.pendingDomains.some((domain) => domain.id === id && domain.email === state.email))
        throw new Error('This pending domain belongs to another hosting account.')
      cancelingDomains.add(id)
      try {
        await getQueryClient().cancelQueries({queryKey: ['HOST_DOMAINS', SEED_HOST_URL]})
        // A signed publication already sent cannot be undone by aborting a fetch.
        await domainPublications.get(id)?.catch(() => {})
        assertSession(state.authGeneration)
        if (!readState().pendingDomains.some((domain) => domain.id === id))
          throw new Error('This domain is already active. Manage it in Seed Hosting.')
        await hostAPI(`domains/${encodeURIComponent(id)}`, 'DELETE', undefined, state)
        assertSession(state.authGeneration)
        const current = readState()
        writeState({...current, pendingDomains: current.pendingDomains.filter((domain) => domain.id !== id)})
      } finally {
        cancelingDomains.delete(id)
        void getQueryClient().invalidateQueries({queryKey: ['HOST_DOMAINS', SEED_HOST_URL]})
      }
    },
  })
  const ownPendingDomains = hostState.pendingDomains.filter((domain) => domain.email === hostState.email)
  const domainStatus = useQuery({
    queryKey: ['HOST_DOMAINS', SEED_HOST_URL, hostState.authGeneration],
    enabled: !!hostState.sessionToken && ownPendingDomains.length > 0,
    refetchInterval: 20_000,
    useErrorBoundary: false,
    meta: {handlesErrorLocally: true},
    queryFn: async ({signal}) => {
      const state = readState()
      for (const domain of state.pendingDomains.filter((pending) => pending.email === state.email)) {
        if (cancelingDomains.has(domain.id)) continue
        const result = z
          .object({status: z.enum(['WaitingForDNS', 'Initializing', 'Error', 'Active'])})
          .parse(await hostAPI(`domains/${encodeURIComponent(domain.id)}`, 'GET', undefined, state, signal))
        if (signal?.aborted) return null
        if (result.status === 'Active') {
          const {updateMovedSitePublication} = await import('./site')
          assertSession(state.authGeneration)
          if (
            signal?.aborted ||
            cancelingDomains.has(domain.id) ||
            !readState().pendingDomains.some((pending) => pending.id === domain.id && pending.email === state.email)
          )
            continue
          const publication =
            domainPublications.get(domain.id) ||
            updateMovedSitePublication(hmId(domain.siteUid), domain.currentSiteUrl, `https://${domain.hostname}`)
          domainPublications.set(domain.id, publication)
          try {
            await publication
            assertSession(state.authGeneration)
            const current = readState()
            writeState({
              ...current,
              pendingDomains: current.pendingDomains.filter((pending) => pending.id !== domain.id),
            })
          } catch (error) {
            assertSession(state.authGeneration)
            const current = readState()
            writeState({
              ...current,
              pendingDomains: current.pendingDomains.map((pending) =>
                pending.id === domain.id
                  ? {
                      ...pending,
                      status: 'error',
                      errorMessage: `Domain is active, but publication could not be updated. ${
                        error instanceof Error ? error.message : 'Try again.'
                      }`,
                    }
                  : pending,
              ),
            })
            throw error
          } finally {
            if (domainPublications.get(domain.id) === publication) domainPublications.delete(domain.id)
          }
        } else {
          const status =
            result.status === 'WaitingForDNS'
              ? 'waiting-dns'
              : result.status === 'Initializing'
                ? 'initializing'
                : 'error'
          const current = readState()
          writeState({
            ...current,
            pendingDomains: current.pendingDomains.map((pending) =>
              pending.id === domain.id ? {...pending, status, errorMessage: undefined} : pending,
            ),
          })
        }
      }
      return null
    },
  })
  const logoutMutation = useMutation({mutationFn: logoutHosting})
  return {
    email: hostState.email,
    loggedIn: !!hostState.sessionToken,
    isSessionLoaded: loadedState !== undefined,
    pendingDomains: ownPendingDomains,
    domainStatus,
    retryPendingDomains: async () => {
      await domainStatus.refetch({throwOnError: true})
    },
    pendingSiteMoves: hostState.pendingSiteMoves.filter((move) => move.hostUrl === SEED_HOST_URL),
    startEmailCode,
    verifyEmailCode,
    loginWithVault: loginWithVault.mutate,
    loginWithVaultAsync: loginWithVault.mutateAsync,
    canLoginWithVault: false,
    reset: () => {
      void logoutHosting()
    },
    logout: () => logoutMutation.mutate(),
    hostInfo,
    sites,
    renameSite,
    recoverSiteMove,
    clearPendingSiteMove,
    transferSite,
    createSite,
    createDomain,
    cancelPendingDomain,
  }
}

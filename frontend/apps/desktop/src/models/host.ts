import type {PendingSiteMove} from '@/app-host'
import {grpcClient} from '@/grpc-client'
import {logoutHosting} from './host-session'
import {client} from '@/trpc'
import * as base64 from '@seed-hypermedia/client/base64'
import {invalidateQueries} from '@shm/shared'
import {SEED_HOST_URL} from '@shm/shared/constants'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'
import {useEffect, useRef} from 'react'
import z from 'zod'

// MANUAL SYNC WITH SEED REPO

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
export type AbsorbResponse = z.infer<typeof AbsorbResponseSchema>

export const CodeStartResponseSchema = z.object({
  status: z.literal('code-sent'),
  email: z.string(),
  binding: z.string(),
  expireTime: z.number(),
  resendAllowedTime: z.number(),
})
export type CodeStartResponse = z.infer<typeof CodeStartResponseSchema>

export const CreateSiteRequestSchema = z.object({
  subdomain: z.string(),
})
export type CreateSiteRequest = z.infer<typeof CreateSiteRequestSchema>

export const CreateSiteResponseSchema = z.object({
  subdomain: z.string(),
  host: z.string(),
  registrationSecret: z.string(),
  setupUrl: z.string(),
})
export type CreateSiteResponse = z.infer<typeof CreateSiteResponseSchema>

export const CreateSiteDomainRequestSchema = z.object({
  hostname: z.string(),
  currentSiteUrl: z.string(),
})
export type CreateSiteDomainRequest = z.infer<typeof CreateSiteDomainRequestSchema>

export const CreateSiteDomainResponseSchema = z.object({
  hostname: z.string(),
  domainId: z.string(),
})
export type CreateSiteDomainResponse = z.infer<typeof CreateSiteDomainResponseSchema>

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
export type HostInfoResponse = z.infer<typeof HostInfoResponseSchema>

/** A site owned by the authenticated hosting account, with its gateway identity. */
export const HostedSiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  activeConfig: z.object({registeredAccountUid: z.string().optional()}).nullable(),
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

// END MANUAL SYNC WITH SEED REPO

export function useHostSession({
  onAuthenticated,
  includeSites = false,
}: {
  onAuthenticated?: () => void
  includeSites?: boolean
} = {}) {
  const {data: hostState} = useQuery({
    queryKey: [queryKeys.HOST_STATE],
    queryFn: () => client.host.get.query(),
  })
  async function hostAPI(
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    body?: any,
    headers?: Record<string, string>,
  ) {
    const reqHeaders = {...headers}
    if (body) {
      reqHeaders['Content-Type'] = 'application/json'
    }
    if (hostState?.sessionToken) {
      reqHeaders['Authorization'] = `Bearer ${hostState.sessionToken}`
    }
    const res = await fetch(`${SEED_HOST_URL}/api/${path}`, {
      method,
      headers: reqHeaders,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const respJson = await res.json()
      throw Object.assign(new Error(respJson.message), {status: res.status})
    }
    const respJson = await res.json()
    return respJson
  }
  const setHostState = useMutation({
    mutationFn: (state: Parameters<typeof client.host.set.mutate>[0]) => client.host.set.mutate(state),
    onSuccess: () => {
      invalidateQueries([queryKeys.HOST_STATE])
    },
  })
  // Login with a code sent by email: start returns the binding that verify needs.
  const startEmailCode = useMutation({
    mutationFn: async (email: string) => {
      const respJson = await hostAPI('auth/code/start', 'POST', {email})
      return CodeStartResponseSchema.parse(respJson)
    },
  })
  const verifyEmailCode = useMutation({
    mutationFn: async (input: {email: string; binding: string; code: string}) => {
      const expectedAuthVersion = hostState?.authVersion ?? 0
      const respJson = await hostAPI('auth/code/verify', 'POST', input)
      const response = AbsorbResponseSchema.parse(respJson)
      if (response.status !== 'success') {
        throw new Error(response.status === 'error' ? response.message : 'Login failed')
      }
      await setHostState.mutateAsync({
        expectedAuthVersion,
        email: response.email,
        sessionToken: response.sessionToken,
        pendingSessionToken: null,
      })
      onAuthenticated?.()
    },
  })
  // Skips the email step when the remote vault has already verified the email and the host trusts it.
  const loginWithVault = useMutation({
    mutationFn: async () => {
      const expectedAuthVersion = hostState?.authVersion ?? 0
      const prevalidation = await grpcClient.daemon.getVaultEmailPrevalidation({})
      const respJson = await hostAPI('auth/vault', 'POST', {
        email: prevalidation.email,
        signer: base64.encode(prevalidation.signer),
        host: prevalidation.host,
        sig: base64.encode(prevalidation.sig),
      })
      const response = AbsorbResponseSchema.parse(respJson)
      if (response.status !== 'success') {
        throw new Error(response.status === 'error' ? response.message : 'Vault login failed')
      }
      await setHostState.mutateAsync({
        expectedAuthVersion,
        email: response.email,
        sessionToken: response.sessionToken,
        pendingSessionToken: null,
      })
    },
  })
  const sessionToken = hostState?.sessionToken
  const wasAuthenticated = useRef(!!sessionToken)
  useEffect(() => {
    if (sessionToken && !wasAuthenticated.current) {
      onAuthenticated?.()
    }
    wasAuthenticated.current = !!sessionToken
  }, [sessionToken])
  const sites = useQuery({
    queryKey: ['HOST_SITES', sessionToken],
    queryFn: async () => {
      const sites = z.array(HostedSiteSchema).parse(await hostAPI('sites', 'GET'))
      return Promise.all(
        sites.map(async (site) => ({
          ...site,
          customDomains: z
            .array(z.object({hostname: z.string()}))
            .parse(await hostAPI(`sites/${encodeURIComponent(site.id)}/domains`, 'GET'))
            .map((domain) => domain.hostname),
        })),
      )
    },
    enabled: includeSites && !!sessionToken,
    keepPreviousData: false,
    staleTime: 30_000,
    useErrorBoundary: false,
    meta: {handlesErrorLocally: true},
  })
  const clearPendingSiteMove = async (id: string) => {
    await client.host.clearPendingSiteMove.mutate({id, hostUrl: SEED_HOST_URL})
    invalidateQueries([queryKeys.HOST_STATE])
  }
  const renameSite = useMutation({
    mutationFn: async (input: {id: string; name: string; currentName: string; siteUid: string; currentUrl: string}) => {
      if (!hostState?.email) throw new Error('Sign in to Seed Hosting before changing the address.')
      await client.host.setPendingSiteMove.mutate({
        id: input.id,
        siteUid: input.siteUid,
        oldName: input.currentName,
        newName: input.name,
        oldUrl: input.currentUrl,
        hostUrl: SEED_HOST_URL,
        email: hostState.email,
      })
      invalidateQueries([queryKeys.HOST_STATE])
      try {
        return z.object({id: z.string(), name: z.string(), url: z.string().url()}).parse(
          await hostAPI(`sites/${encodeURIComponent(input.id)}`, 'PATCH', {
            name: input.name,
            currentName: input.currentName,
          }),
        )
      } catch (error) {
        if (error instanceof Error && 'status' in error && typeof error.status === 'number' && error.status < 500) {
          await clearPendingSiteMove(input.id)
        }
        throw error
      }
    },
    onSettled: () => invalidateQueries(['HOST_SITES']),
  })
  const recoverSiteMove = useMutation({
    mutationFn: async (move: PendingSiteMove) => {
      if (move.hostUrl !== SEED_HOST_URL || move.email !== hostState?.email)
        throw new Error('Sign in to the hosting account that started this move.')
      const site = HostedSiteSchema.parse(await hostAPI(`sites/${encodeURIComponent(move.id)}`, 'GET'))
      if (site.activeConfig?.registeredAccountUid !== move.siteUid)
        throw new Error('This hosted site is no longer registered to the space.')
      if (site.name === move.newName) return site.url
      if (site.name !== move.oldName)
        throw new Error('The hosting address changed again. Review it in Seed Hosting before updating publication.')
      const result = z.object({url: z.string().url()}).parse(
        await hostAPI(`sites/${encodeURIComponent(move.id)}`, 'PATCH', {
          name: move.newName,
          currentName: move.oldName,
        }),
      )
      return result.url
    },
    onSettled: () => invalidateQueries(['HOST_SITES']),
  })
  const transferSite = useMutation({
    mutationFn: async (input: {id: string; email: string; currentName: string}) => {
      return z.object({success: z.literal(true), email: z.string()}).parse(
        await hostAPI(`sites/${encodeURIComponent(input.id)}/transfer`, 'POST', {
          email: input.email,
          currentName: input.currentName,
        }),
      )
    },
    onSuccess: () => invalidateQueries(['HOST_SITES']),
  })
  const createSite = useMutation({
    mutationFn: async ({subdomain}: {subdomain: string}) => {
      const respJson = await hostAPI('sites', 'POST', {
        subdomain,
      } satisfies CreateSiteRequest)
      const result = CreateSiteResponseSchema.parse(respJson)
      return result
    },
  })
  const hostInfo = useQuery({
    queryKey: [queryKeys.HOST_INFO],
    queryFn: async () => {
      try {
        const respJson = await hostAPI('info', 'GET')
        const result = HostInfoResponseSchema.safeParse(respJson)
        if (!result.success) {
          return {
            serviceErrorMessage: 'Host API incompatible with this app. Please update to the latest version.',
          } satisfies HostInfoResponse
        }
        return result.data
      } catch (e) {
        return null
      }
    },
    useErrorBoundary: false,
  })
  const createDomain = useMutation({
    mutationFn: async ({
      hostname,
      currentSiteUrl,
      id,
    }: {
      hostname: string
      currentSiteUrl: string
      id: UnpackedHypermediaId
    }) => {
      const expectedAuthVersion = hostState?.authVersion ?? 0
      const respJson = await hostAPI(`domains`, 'POST', {
        currentSiteUrl,
        hostname,
      } satisfies CreateSiteDomainRequest)
      const result = CreateSiteDomainResponseSchema.parse(respJson)
      if (!hostState) throw new Error('No host state')
      setHostState.mutate({
        ...hostState,
        expectedAuthVersion,
        pendingDomains: [
          ...(hostState?.pendingDomains || []),
          {
            hostname: result.hostname,
            id: result.domainId,
            siteUid: id.uid,
            status: 'waiting-dns',
          },
        ],
      })
      return result
    },
  })

  const logoutMutation = useMutation({mutationFn: logoutHosting})
  function logout() {
    logoutMutation.mutate()
  }
  const cancelPendingDomain = useMutation({
    mutationFn: async (id: string) => {
      const expectedAuthVersion = hostState?.authVersion ?? 0
      if (!hostState) throw new Error('No host state')
      await hostAPI(`domains/${id}`, 'DELETE')
        .then(() => {
          setHostState.mutate({
            ...hostState,
            expectedAuthVersion,
            pendingDomains: hostState.pendingDomains?.filter((domain) => domain.id !== id),
          })
        })
        .catch((e) => {
          console.error('~~ CANCEL PENDING DOMAIN ERROR', e)
        })
    },
  })

  return {
    email: hostState?.email,
    pendingDomains: hostState?.pendingDomains,
    loggedIn: !!hostState?.sessionToken,
    isSessionLoaded: hostState !== undefined,
    startEmailCode,
    verifyEmailCode,
    loginWithVault: loginWithVault.mutate,
    reset: () => {
      setHostState.mutate({
        expectedAuthVersion: hostState?.authVersion ?? 0,
        email: null,
        sessionToken: null,
        pendingSessionToken: null,
      })
    },
    hostInfo,
    sites,
    renameSite,
    recoverSiteMove,
    clearPendingSiteMove,
    pendingSiteMoves: hostState?.pendingSiteMoves?.filter((move) => move.hostUrl === SEED_HOST_URL),
    transferSite,
    createSite,
    createDomain,
    cancelPendingDomain,
    logout,
  }
}

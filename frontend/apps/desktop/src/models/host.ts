import {trpc} from '@/trpc'
import {SEED_HOST_URL} from '@shm/shared/constants'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
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

export const SignInResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('login-email-sent'),
    token: z.string(),
    email: z.string(),
  }),
  z.object({
    status: z.literal('passkey-or-email-validation-required'),
    email: z.string(),
  }),
])
export type SignInResponse = z.infer<typeof SignInResponseSchema>

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
export type CreateSiteDomainRequest = z.infer<
  typeof CreateSiteDomainRequestSchema
>

export const CreateSiteDomainResponseSchema = z.object({
  hostname: z.string(),
  domainId: z.string(),
})
export type CreateSiteDomainResponse = z.infer<
  typeof CreateSiteDomainResponseSchema
>

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

// END MANUAL SYNC WITH SEED REPO

export function useHostSession({
  onAuthenticated,
}: {
  onAuthenticated?: () => void
} = {}) {
  const {data: hostState} = trpc.host.get.useQuery()
  async function hostAPI(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
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
    if (res.status !== 200) {
      console.error('~~ HOST API ERROR', res.status)
      const respJson = await res.json()
      console.error('~~ HOST API ERROR', respJson)
      throw new Error(respJson.message)
    }
    const respJson = await res.json()
    return respJson
  }
  const setHostState = trpc.host.set.useMutation()
  const login = useMutation({
    mutationFn: async (email: string) => {
      const respJson = await hostAPI('auth/start', 'POST', {email})
      const response = SignInResponseSchema.parse(respJson)
      if (response.status === 'login-email-sent') {
        setHostState.mutate({
          email: response.email,
          sessionToken: null,
          pendingSessionToken: response.token,
        })
      }
      return respJson
    },
  })
  const absorbedSession = useQuery({
    queryKey: ['absorb-session', hostState?.pendingSessionToken],
    queryFn: async () => {
      const respJson = await hostAPI('auth/absorb', 'POST', {
        token: hostState?.pendingSessionToken,
      })
      const response = AbsorbResponseSchema.parse(respJson)
      console.log('~~ ABSORB SESSION RESPONSE', response)
      if (response.status === 'success') {
        setHostState.mutate({
          email: response.email,
          sessionToken: response.sessionToken,
          pendingSessionToken: null,
        })
        onAuthenticated?.()
      } else if (response.status === 'pending') {
      } else if (response.status === 'error') {
        throw new Error(response.message)
      }
      return respJson
    },
    enabled: !!hostState?.pendingSessionToken,
    refetchInterval: hostState?.pendingSessionToken ? 15000 : false,
    refetchIntervalInBackground: true,
    useErrorBoundary: false,
  })
  const sessionToken = hostState?.sessionToken
  const wasAuthenticated = useRef(!!sessionToken)
  useEffect(() => {
    if (sessionToken && !wasAuthenticated.current) {
      onAuthenticated?.()
    }
    wasAuthenticated.current = !!sessionToken
  }, [sessionToken])
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
    queryKey: ['host-info'],
    queryFn: async () => {
      const respJson = await hostAPI('info', 'GET')
      const result = HostInfoResponseSchema.safeParse(respJson)
      if (!result.success) {
        return {
          serviceErrorMessage:
            'Host API incompatible with this app. Please update to the latest version.',
        } satisfies HostInfoResponse
      }
      return result.data
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
      const respJson = await hostAPI(`domains`, 'POST', {
        currentSiteUrl,
        hostname,
      } satisfies CreateSiteDomainRequest)
      const result = CreateSiteDomainResponseSchema.parse(respJson)
      if (!hostState) throw new Error('No host state')
      setHostState.mutate({
        ...hostState,
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

  function logout() {
    // todo: delete session from server
    setHostState.mutate({
      email: null,
      sessionToken: null,
      pendingSessionToken: null,
    })
  }
  const cancelPendingDomain = useMutation({
    mutationFn: async (id: string) => {
      if (!hostState) throw new Error('No host state')
      await hostAPI(`domains/${id}`, 'DELETE')
        .then(() => {
          setHostState.mutate({
            ...hostState,
            pendingDomains: hostState.pendingDomains?.filter(
              (domain) => domain.id !== id,
            ),
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
    login: login.mutate,
    isSendingEmail: login.isLoading,
    error: login.error,
    isPendingEmailValidation:
      !hostState?.sessionToken && !!hostState?.pendingSessionToken,
    reset: () => {
      setHostState.mutate({
        email: null,
        sessionToken: null,
        pendingSessionToken: null,
      })
    },
    hostInfo,
    createSite,
    createDomain,
    cancelPendingDomain,
    logout,
    absorbedSession,
  }
}

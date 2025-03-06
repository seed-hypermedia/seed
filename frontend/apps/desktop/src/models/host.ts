import {trpc} from '@/trpc'
import {SEED_HOST_URL} from '@shm/shared/constants'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useMutation, useQuery} from '@tanstack/react-query'
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
      try {
        const respJson = await res.json()
        throw new Error(respJson.message)
      } catch (e) {
        throw new Error(res.statusText)
      }
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
  useQuery({
    queryKey: ['absorb-session', hostState?.pendingSessionToken],
    queryFn: async () => {
      const respJson = await hostAPI('auth/absorb', 'POST', {
        token: hostState?.pendingSessionToken,
      })
      const response = AbsorbResponseSchema.parse(respJson)
      if (response.status === 'success') {
        setHostState.mutate({
          email: response.email,
          sessionToken: response.sessionToken,
          pendingSessionToken: null,
        })
        onAuthenticated?.()
      } else if (response.status === 'pending') {
      } else if (response.status === 'error') {
      }
      return respJson
    },
    enabled: !!hostState?.pendingSessionToken,
    refetchInterval: hostState?.pendingSessionToken ? 15000 : false,
    refetchIntervalInBackground: true,
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
    },
  })

  function cancelPendingDomain(id: string) {
    if (!hostState) throw new Error('No host state')
    hostAPI(`domains/${id}`, 'DELETE')
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
  }

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
    createSite,
    createDomain,
    cancelPendingDomain,
  }
}

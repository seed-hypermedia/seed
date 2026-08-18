import {DEFAULT_AGENT_SERVER_URL} from '@/agents-defaults'
import {useAppContext} from '@/app-context'
import {useDesktopAuthDialog} from '@/components/desktop-auth-dialog'
import {grpcClient} from '@/grpc-client'
import {useMyAccountIds} from '@/models/daemon'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {useNavigate} from '@/utils/useNavigate'
import {CommentEditor} from '@shm/editor/comment-editor'
import * as blobs from '@shm/shared/blobs'
import {isHttpUrl} from '@shm/shared/utils/navigation'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import {setAgentsPlatform, type AgentsPlatform} from '@shm/ui/agents/platform'
import {toast} from '@shm/ui/toast'
import {base58btc} from 'multiformats/bases/base58'
import React, {useMemo} from 'react'

/** Signs agent actions with the local daemon; the private key never leaves the daemon. */
function createDaemonSigner(accountUid: string): blobs.Signer {
  const principal = base58btc.decode(accountUid)
  return {
    principal,
    sign: async (data: Uint8Array) => {
      const result = await grpcClient.daemon.signData({signingKeyName: accountUid, data: new Uint8Array(data)})
      return new Uint8Array(result.signature)
    },
  }
}

/**
 * Same behavior as the desktop `useOpenUrl`, duplicated here (rather than importing `@/open-url`)
 * to keep this module's import graph small during early registration.
 */
function useDesktopOpenUrl() {
  const {externalOpen} = useAppContext()
  const spawn = useNavigate('spawn')
  const push = useNavigate('push')
  return useMemo(() => {
    return (url?: string, newWindow?: boolean) => {
      if (!url) return
      const appRoute = hypermediaUrlToRoute(url)
      if (appRoute) {
        if (newWindow) spawn(appRoute)
        else push(appRoute)
      } else if (isHttpUrl(url)) {
        externalOpen(url)
      } else {
        toast.error(`Failed to resolve route for "${url}"`)
      }
    }
  }, [])
}

/** The desktop sign-in affordance: its own auth dialog, mounted by the caller. */
function useDesktopSignInPrompt() {
  const accountIds = useMyAccountIds()
  const authDialog = useDesktopAuthDialog()
  return {
    hasAccounts: !!accountIds.data?.length,
    signIn: () => authDialog.open({}),
    dialog: authDialog.content,
  }
}

const desktopAgentsPlatform: AgentsPlatform = {
  defaultServerUrl: () => DEFAULT_AGENT_SERVER_URL,
  getSigner: async (accountUid: string) => createDaemonSigner(accountUid),
  getSetting: (key: string) => client.appSettings.getSetting.query(key),
  setSetting: async (key: string, value: unknown) => {
    await client.appSettings.setSetting.mutate({key, value})
  },
  getLocalServerUrl: async () => {
    const result = await client.localAgentsServer.query()
    return result.url ?? null
  },
  discoverEntity: async (id: string) => {
    const resp = await grpcClient.entities.discoverEntity({id})
    return {state: String(resp.state), version: resp.version}
  },
  subscribeToEntity: ({id, recursive}, {onError}) =>
    // The daemon pushes sync state on this channel; the agents UI only cares that the subscription
    // stays open, so data frames are dropped here rather than crossing the seam.
    client.sync.subscribe.subscribe({id, recursive}, {onData: () => {}, onError}),
  connectToHmServer: async (hmServerUrl: string) => {
    const config = await client.web.configOfHost.query({host: hmServerUrl})
    if (config.addrs?.length) {
      await grpcClient.networking.connect({addrs: config.addrs})
      console.info('[agents] connected local node to agent HM server', {
        hmServerUrl,
        peerId: config.peerId,
        addrs: config.addrs.length,
      })
    }
    return {peerId: config.peerId, addrs: config.addrs}
  },
  oauthRedirectCatcher: {
    start: (state: string | null) => client.providerOAuth.startCallback.mutate({state}),
    captured: () => client.providerOAuth.capturedCallback.query(),
    stop: async () => {
      await client.providerOAuth.stopCallback.mutate()
    },
  },
  useAccountUid: useSelectedAccountId,
  useNavigate,
  useOpenUrl: useDesktopOpenUrl,
  useGatewayUrl: () => useGatewayUrl().data,
  useSignInPrompt: useDesktopSignInPrompt,
  useOpenServerSettings: () => {
    const navigate = useNavigate()
    return () => navigate({key: 'settings', tab: 'agent-servers'})
  },
  CommentEditor,
  ReadOnlyMessageViewer: React.lazy(() =>
    import('@shm/editor/readonly-viewer').then((module) => ({default: module.ReadOnlyViewer})),
  ),
}

/** Registers the desktop adapter for the shared Agents UI. Must run before the first render. */
export function registerDesktopAgentsPlatform() {
  setAgentsPlatform(desktopAgentsPlatform)
}

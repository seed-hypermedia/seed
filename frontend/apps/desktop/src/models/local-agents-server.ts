import {useMyAccountIds} from '@/models/daemon'
import {APP_ENVIRONMENT_FEATURES, type AppEnvironmentFeature} from '@seed-hypermedia/apps-protocol'
import {AGENTS_LOCAL_SERVER_SETTING_KEY, LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {sendAgentAction, type AgentInfo} from '@shm/ui/agents/client'
import {
  useLocalAgentServerFeaturesSetting,
  useLocalAgentServerState,
  useLocalAgentServerUrl,
  useSetLocalAgentServerFeatures,
} from '@shm/ui/agents/models'
import {getAgentsPlatform, type AgentsLocalServerState} from '@shm/ui/agents/platform'
import {useQueries} from '@tanstack/react-query'
import {useEffect, useRef} from 'react'

/**
 * Settling what the local app environment runs after an upgrade.
 *
 * Builds before the setting always ran the bundled server with everything, so a user may have
 * agents in it. The main process runs it that way one last time while nothing is decided (see
 * `resolveLocalAgentsServerSpawn`) and this hook looks for agents under every local account. Any
 * found means agents are in use here, and the server keeps running everything. None means it goes
 * to the default: tools only. Errors leave the decision for the next launch rather than turning
 * agents off under a server that may hold some.
 */

/** One `ListAgents` answer per local account: undefined while loading, 'error' when it failed. */
export type LocalAgentsServerMigrationInput = {
  /** The stored list of what the server runs: null when nothing is decided, undefined while loading. */
  setting: AppEnvironmentFeature[] | null | undefined
  state: AgentsLocalServerState | undefined
  lists: (AgentInfo[] | 'error' | undefined)[] | undefined
}

export function resolveLocalAgentsServerMigration(input: LocalAgentsServerMigrationInput): 'keep' | 'retire' | null {
  if (input.setting !== null) return null
  // Only a server this app spawned is ours to retire; the dev one is attached, never touched.
  if (input.state?.t !== 'spawned') return null
  if (!input.lists) return null
  // No accounts to ask is indistinguishable from a failed key listing (`useMyAccountIds` answers
  // `[]` on error), so that launch decides nothing; the server runs once more next time.
  if (input.lists.length === 0) return null
  if (input.lists.some((list) => list === undefined)) return null
  if (input.lists.some((list) => Array.isArray(list) && list.length > 0)) return 'keep'
  if (input.lists.some((list) => list === 'error')) return null
  return 'retire'
}

export function useLocalAgentsServerMigration() {
  const setting = useLocalAgentServerFeaturesSetting()
  const state = useLocalAgentServerState()
  const localServerUrl = useLocalAgentServerUrl()
  const accountIds = useMyAccountIds()
  const serverUrl = localServerUrl.data
  const pending = setting.isSuccess && setting.data === null && state.data?.t === 'spawned' && !!serverUrl
  const lists = useQueries({
    queries: (pending ? accountIds.data || [] : []).map((accountUid) => ({
      // Same key as the panel's lists, so a launch that shows the panel pays for them once.
      queryKey: ['agents', 'list', serverUrl, accountUid],
      queryFn: async () => {
        const res = await sendAgentAction({serverUrl: serverUrl!, accountUid, action: {_: 'ListAgents'}})
        if (res._ !== 'ListAgentsResponse') throw new Error('Unexpected ListAgents response')
        return res.agents
      },
      retry: false,
      useErrorBoundary: false,
    })),
  })
  const setFeatures = useSetLocalAgentServerFeatures()
  const decided = useRef(false)
  const decision = resolveLocalAgentsServerMigration({
    setting: setting.isSuccess ? setting.data : undefined,
    state: state.data,
    lists:
      pending && accountIds.data
        ? lists.map((q) => (q.isSuccess ? q.data : q.isError ? 'error' : undefined))
        : undefined,
  })
  useEffect(() => {
    if (!decision || decided.current) return
    decided.current = true
    const platform = getAgentsPlatform()
    void platform.setSetting(AGENTS_LOCAL_SERVER_SETTING_KEY, 'on').then(() => {
      if (decision === 'keep') {
        // The server already runs everything: record that, with no restart under the agents.
        return platform
          .setSetting(LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY, [...APP_ENVIRONMENT_FEATURES])
          .then(() => invalidateQueries(['agents']))
      }
      setFeatures.mutate(['tools'])
    })
  }, [decision, setFeatures])
}

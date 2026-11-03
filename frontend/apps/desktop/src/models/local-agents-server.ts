import {useMyAccountIds} from '@/models/daemon'
import {AGENTS_LOCAL_SERVER_SETTING_KEY} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {sendAgentAction, type AgentInfo} from '@shm/ui/agents/client'
import {
  useLocalAgentServerSetting,
  useLocalAgentServerState,
  useLocalAgentServerUrl,
  useSetLocalAgentServerEnabled,
} from '@shm/ui/agents/models'
import {getAgentsPlatform, type AgentsLocalServerState} from '@shm/ui/agents/platform'
import {useQueries} from '@tanstack/react-query'
import {useEffect, useRef} from 'react'

/**
 * Settling the local agents server setting after an upgrade.
 *
 * Builds before the setting always ran the bundled server, so a user may have agents in it. The
 * main process spawns it one last time while the setting is unset (see `resolveLocalAgentsServerSpawn`)
 * and this hook looks for agents under every local account: any found means the local system is in
 * use and stays on; none means it is turned off and stopped. Errors leave the decision for the next
 * launch rather than retiring a server that may hold agents.
 */

/** One `ListAgents` answer per local account: undefined while loading, 'error' when it failed. */
export type LocalAgentsServerMigrationInput = {
  setting: 'on' | 'off' | null | undefined
  state: AgentsLocalServerState | undefined
  lists: (AgentInfo[] | 'error' | undefined)[] | undefined
}

export function resolveLocalAgentsServerMigration(input: LocalAgentsServerMigrationInput): 'keep' | 'retire' | null {
  if (input.setting !== null) return null
  // Only a server this app spawned is ours to retire; the dev one is attached, never touched.
  if (input.state?.t !== 'spawned') return null
  if (!input.lists) return null
  if (input.lists.some((list) => list === undefined)) return null
  if (input.lists.some((list) => Array.isArray(list) && list.length > 0)) return 'keep'
  if (input.lists.some((list) => list === 'error')) return null
  return 'retire'
}

export function useLocalAgentsServerMigration() {
  const setting = useLocalAgentServerSetting()
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
  const setEnabled = useSetLocalAgentServerEnabled()
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
    if (decision === 'keep') {
      void getAgentsPlatform()
        .setSetting(AGENTS_LOCAL_SERVER_SETTING_KEY, 'on')
        .then(() => invalidateQueries(['agents', 'settings']))
    } else {
      setEnabled.mutate(false)
    }
  }, [decision, setEnabled])
}

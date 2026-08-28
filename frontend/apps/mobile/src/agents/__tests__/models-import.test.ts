/**
 * The shared React Query models are the single heaviest thing mobile borrows from the desktop/web
 * agents stack — 78 hooks over the signed action API plus the signed WebSocket subscriptions — and
 * the one most likely to acquire a dependency that cannot run on Hermes.
 *
 * Loading the module at all is most of the assertion: it pulls in @tanstack/react-query, the shared
 * query client, the DAG-CBOR codec, and the agents protocol. The named checks below pin the hooks
 * the mobile app is being built against, so a rename upstream fails here rather than at bundle time
 * on a device.
 */

import * as models from '@shm/ui/agents/models'

const REQUIRED_HOOKS = [
  // Servers and connectivity
  'useAgentServerUrl',
  'useSetAgentServerUrl',
  'useAgentServerUrls',
  'useAgentServerHealth',
  // Agents list and detail
  'useAgentList',
  'useAgentLists',
  'useAgentDetail',
  'useCreateAgent',
  'useHasAnyAgent',
  // Providers
  'useModelProviders',
  'useProviderModels',
  'useSaveModelProvider',
  // Sessions and the log
  'useAgentSession',
  'useAllAgentSessions',
  'useChildSessions',
  'useCreateAgentSession',
  'useMessageAgentSession',
  'useStopAgentSession',
  'useRetrySession',
  'useUpdateAgentSession',
  // Runs — the pinned run card
  'useRun',
  'useSessionRuns',
  'useRunTree',
  'useCancelRun',
  'useSignalRun',
  // Live updates
  'useAgentWebSocketSubscription',
  'useAgentRunTreeSubscription',
] as const

describe('shared agents models', () => {
  it('loads under the mobile toolchain', () => {
    expect(Object.keys(models).length).toBeGreaterThan(50)
  })

  it.each(REQUIRED_HOOKS)('exports %s', (name) => {
    expect(typeof (models as Record<string, unknown>)[name]).toBe('function')
  })
})

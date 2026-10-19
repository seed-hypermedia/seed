/**
 * Seed agents UI for apps outside the Seed monorepo.
 *
 * ```tsx
 * import {SeedAgentsProvider, SeedAgentsView} from '@seed-hypermedia/agents-ui'
 * import '@seed-hypermedia/agents-ui/styles.css'
 *
 * <SeedAgentsProvider host={{serverUrl, signer}}>
 *   <SeedAgentsView />
 * </SeedAgentsProvider>
 * ```
 */
export {SeedAgentsProvider, useSeedAgentsHost, useSeedAgentsNavigate, useSeedAgentsRoute} from './provider'
export type {SeedAgentsProviderProps} from './provider'
export {SeedAgentsAssistant, SeedAgentsView} from './view'
export type {SeedAgentsAssistantProps} from './view'
export {isSeedAgentsRoute, seedAgentsRouteFromPath, seedAgentsRouteToPath, seedAgentsRouteToWebUrl} from './routes'
export type {SeedAgentTab, SeedAgentsRoute} from './routes'
export {AgentProtocolError, AgentServerError, createSeedAgentsClient} from './client'
export type {SeedAgentsAction, SeedAgentsClient, SeedAgentsResponseFor} from './client'
export type {
  SeedAgentsBlockNode,
  SeedAgentsDelegation,
  SeedAgentsEditorGetContent,
  SeedAgentsEditorHandle,
  SeedAgentsEditorProps,
  SeedAgentsHost,
  SeedAgentsNavigationMode,
  SeedAgentsSettingsStore,
  SeedAgentsSigner,
} from './host'
/** Wire types of the agents service: actions, responses, sessions, events, runs, tools. */
export type * as AgentsProtocol from '@seed-hypermedia/agents-protocol'
export {AGENTS_PROTOCOL_VERSION} from '@seed-hypermedia/agents-protocol'

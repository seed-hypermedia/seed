import {callableToolRegistry} from '../../../../../../agents/protocol/src/tool-registry'

/**
 * The five verbs (read, write, call, delegate, plan) are always on and are not configuration.
 * What an agent's `tools` array narrows is the CALLABLE tool set — the tools dispatched through
 * the call verb. These are the service-runtime callables a user can toggle per agent.
 */
export const AGENT_SEARCH_TOOL = callableToolRegistry.search.name
export const AGENT_WEB_SEARCH_TOOL = callableToolRegistry.web_search.name
export const AGENT_EXECUTE_TOOL = callableToolRegistry.execute.name
/** Pseudo-grant: signed public publishing (hm:// documents/comments, IPFS uploads). */
export const AGENT_PUBLISH_GRANT = 'publish'

/**
 * Tools granted to a newly created agent: Seed search, web search, sandboxed code execution, and
 * publishing. Reading, memory, delegation, and planning are verbs — always available. The server
 * silently drops execute from sessions when the host cannot run sandboxes.
 */
export const DEFAULT_AGENT_TOOLS = [AGENT_SEARCH_TOOL, AGENT_WEB_SEARCH_TOOL, AGENT_EXECUTE_TOOL, AGENT_PUBLISH_GRANT]

/** Legacy stored tool names that meant "this agent may publish signed public content". */
const LEGACY_PUBLISH_TOOL_NAMES = ['write', 'memory_publish_document', 'ipfs_write', 'attachment_to_ipfs']

/**
 * Maps a stored (possibly pre-verbs) tools array onto today's grants so the UI reads and writes
 * the truth the server acts on: execute_code → execute, the old write group → publish, names
 * absorbed into verbs dropped.
 */
export function normalizeStoredAgentTools(tools: string[]): string[] {
  const normalized = new Set<string>()
  for (const tool of tools) {
    if (tool === 'execute_code' || tool === AGENT_EXECUTE_TOOL) normalized.add(AGENT_EXECUTE_TOOL)
    else if (tool === AGENT_PUBLISH_GRANT || LEGACY_PUBLISH_TOOL_NAMES.includes(tool)) normalized.add(AGENT_PUBLISH_GRANT)
    else if (tool === AGENT_SEARCH_TOOL || tool === AGENT_WEB_SEARCH_TOOL) normalized.add(tool)
    // Everything else was absorbed into the always-on verbs and is inert.
  }
  return Array.from(normalized)
}

/**
 * Callables for the auto-provisioned sidebar Assistant: Seed search only. The read verb already
 * covers documents/web/activity; hm:// publishing stays gated by the (absent) signing identities.
 */
export const ASSISTANT_DEFAULT_TOOLS = [AGENT_SEARCH_TOOL]

/** Tool-backend capabilities a server advertises in its health response. */
export type AgentServerWebCapabilities = {
  search: boolean
  readBrowser: boolean
  /** Sandboxed code execution; undefined on older servers means unknown. */
  codeExec?: boolean
  /** Human-readable explanation when codeExec is false. */
  codeExecReason?: string
  /** Machine-readable cause when codeExec is false, for targeted help UI. */
  codeExecReasonCode?: string
  /**
   * Whether this server runs on the user's own machine. Setup help (enable a Windows feature,
   * join the kvm group) only makes sense locally; remote servers get a plain unsupported message.
   */
  local?: boolean
}

/**
 * Whether a callable tool can run on a server with the given web capabilities, plus an optional
 * caveat. `caps` undefined means capabilities are unknown (older server or not yet loaded) —
 * assume available so we never grey out tools we cannot confirm are unavailable. `action` marks
 * unavailability the user can fix themselves, so the UI can offer targeted setup help instead of
 * a dead checkbox.
 */
export function getToolAvailability(
  toolName: string,
  caps: AgentServerWebCapabilities | undefined,
): {available: boolean; note?: string; action?: 'enable-whp'} {
  if (toolName === AGENT_WEB_SEARCH_TOOL) {
    if (caps && !caps.search)
      return {available: false, note: 'The web search backend (SearXNG) is not configured on this server.'}
    return {available: true}
  }
  if (toolName === AGENT_EXECUTE_TOOL && caps && caps.codeExec === false) {
    if (!caps.local) {
      return {available: false, note: 'This agent server does not support code execution.'}
    }
    if (caps.codeExecReasonCode === 'whp-disabled') {
      return {
        available: false,
        note: 'Requires Windows Hypervisor Platform, which is turned off on this PC.',
        action: 'enable-whp',
      }
    }
    return {
      available: false,
      note: caps.codeExecReason ?? 'Sandboxed code execution is not available on this computer.',
    }
  }
  return {available: true}
}

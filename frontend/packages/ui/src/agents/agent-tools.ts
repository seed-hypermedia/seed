import {callableToolRegistry, type AppMountInfo, type AppToolInfo} from '@seed-hypermedia/agents-protocol'
import type {AgentToolInfo} from './client'

/**
 * The five verbs (read, write, call, delegate, plan) are always on and are not configuration.
 * What an agent's `tools` array narrows is the CALLABLE tool set — the tools dispatched through
 * the call verb. These are the service-runtime callables a user can toggle per agent.
 */
export const AGENT_SEARCH_TOOL = callableToolRegistry.search.name
export const AGENT_WEB_SEARCH_TOOL = callableToolRegistry.web_search.name
export const AGENT_EXECUTE_TOOL = callableToolRegistry.execute.name
/**
 * The integrated browser: lets the agent read and act on websites open in the owner's Seed window.
 * Opt-in per agent (not in DEFAULT_AGENT_TOOLS); the owner still consents per website at run time.
 */
export const AGENT_BROWSER_TOOL = callableToolRegistry.browser.name
/** Pseudo-grant: signed public publishing (hm:// documents/comments, IPFS uploads). */
export const AGENT_PUBLISH_GRANT = 'publish'

/** What the Tools tab's info dialog shows for one tool: the text and the contract the model gets. */
export type ToolContractView = {
  label: string
  /** The line under the label: a builtin's registry name, or the app and runtime an app tool comes from. */
  name: string
  description: string
  inputSchema?: unknown
  outputSchema?: unknown
  /** Why the contract is not there: the mount offers no tool, or the server has not projected it yet. */
  note?: string
}

/**
 * The contract of a mounted app's tool. The registry knows no app tool; the contract is the tool
 * page's, read by the server and projected into the agent's `~/tools` once the mount works, so it
 * comes from that document. Until it exists the view carries what the mount lists and why.
 */
export function appToolContract(
  app: AppMountInfo,
  tool: AppToolInfo,
  document: AgentToolInfo | undefined,
): ToolContractView {
  const version = app.version ? ` · version ${app.version.slice(0, 12)}` : ''
  return {
    label: tool.tool,
    name: `${app.name} · ${tool.runtime}${version}`,
    description: document?.description ?? tool.summary,
    ...(document ? {inputSchema: document.input, ...(document.output ? {outputSchema: document.output} : {})} : {}),
    ...(app.status.state === 'error'
      ? {
          note: `This mount offers no tools (${
            app.status.error ?? 'unknown reason'
          }), so the agent has no contract for it yet.`,
        }
      : document
        ? {}
        : {
            note: 'The server has not projected this tool for the agent yet. Refresh in the Apps dialog asks it to look now.',
          }),
  }
}

/**
 * Tools granted to a newly created agent: Seed search, web search, sandboxed code execution and
 * publishing. Reading, memory, delegation, and planning are verbs — always available. The tools
 * of mounted apps are granted per agent in the Tools tab, by their own names. The server silently
 * drops execute from sessions when it cannot run it.
 */
export const DEFAULT_AGENT_TOOLS = [AGENT_SEARCH_TOOL, AGENT_WEB_SEARCH_TOOL, AGENT_EXECUTE_TOOL, AGENT_PUBLISH_GRANT]

/** Legacy stored tool names that meant "this agent may publish signed public content". */
const LEGACY_PUBLISH_TOOL_NAMES = ['write', 'memory_publish_document', 'ipfs_write', 'attachment_to_ipfs']

/**
 * Maps a stored (possibly pre-verbs) tools array onto today's grants so the UI reads and writes
 * the truth the server acts on: execute_code → execute, the old write group → publish, names
 * absorbed into verbs dropped. `appTools` are the names of the tools of the apps mounted for the
 * account: a grant by one of those names is kept, since the server offers it under that name.
 */
export function normalizeStoredAgentTools(tools: string[], appTools: string[] = []): string[] {
  const normalized = new Set<string>()
  for (const tool of tools) {
    if (tool === 'execute_code' || tool === AGENT_EXECUTE_TOOL) normalized.add(AGENT_EXECUTE_TOOL)
    else if (tool === AGENT_PUBLISH_GRANT || LEGACY_PUBLISH_TOOL_NAMES.includes(tool))
      normalized.add(AGENT_PUBLISH_GRANT)
    else if (
      tool === AGENT_SEARCH_TOOL ||
      tool === AGENT_WEB_SEARCH_TOOL ||
      tool === AGENT_BROWSER_TOOL ||
      appTools.includes(tool)
    )
      normalized.add(tool)
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

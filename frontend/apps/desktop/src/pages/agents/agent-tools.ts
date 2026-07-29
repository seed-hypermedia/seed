import {seedToolRegistry} from '../../../../../../agents/protocol/src/tool-registry'

/** Tools that let an agent find and read Seed content. */
export const AGENT_READ_TOOL_GROUP = [
  seedToolRegistry.read.name,
  seedToolRegistry.search.name,
  seedToolRegistry.list_activity_feed.name,
]

/** Tools that let an agent search and read the public web. Requires server-side web backends. */
export const AGENT_WEB_TOOL_GROUP = [seedToolRegistry.web_search.name, seedToolRegistry.web_read.name]

/** Tool that lets an agent create, sign, and publish Seed content. */
export const AGENT_WRITE_TOOL = seedToolRegistry.write.name

/** Tools that let an agent read and write its private persistent memory filesystem. */
export const AGENT_MEMORY_TOOL_GROUP = [
  seedToolRegistry.memory_list.name,
  seedToolRegistry.memory_read.name,
  seedToolRegistry.memory_write.name,
  seedToolRegistry.memory_delete.name,
  seedToolRegistry.memory_download.name,
  seedToolRegistry.memory_upload_ipfs.name,
]

/**
 * Tools granted to a newly created agent: full read access, web search/read, persistent
 * memory, write, and sandboxed code execution, so the agent can research, remember, compute,
 * and publish as its own auto-created account without extra setup. The server silently drops
 * execute_code from sessions when the host cannot run sandboxes.
 */
export const DEFAULT_AGENT_TOOLS = [
  ...AGENT_READ_TOOL_GROUP,
  ...AGENT_WEB_TOOL_GROUP,
  ...AGENT_MEMORY_TOOL_GROUP,
  AGENT_WRITE_TOOL,
  seedToolRegistry.execute_code.name,
]

/** Tool that lets an agent run sandboxed code inside its memory workspace. */
export const AGENT_EXECUTE_CODE_TOOL = seedToolRegistry.execute_code.name

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
 * Whether a tool can run on a server with the given web capabilities, plus an optional caveat.
 * `caps` undefined means capabilities are unknown (older server or not yet loaded) — assume available
 * so we never grey out tools we cannot confirm are unavailable. `action` marks unavailability the
 * user can fix themselves, so the UI can offer targeted setup help instead of a dead checkbox.
 */
export function getToolAvailability(
  toolName: string,
  caps: AgentServerWebCapabilities | undefined,
): {available: boolean; note?: string; action?: 'enable-whp'} {
  if (toolName === seedToolRegistry.web_search.name) {
    if (caps && !caps.search)
      return {available: false, note: 'The web search backend (SearXNG) is not configured on this server.'}
    return {available: true}
  }
  if (toolName === seedToolRegistry.web_read.name && caps && !caps.readBrowser) {
    return {
      available: true,
      note: 'Browser rendering is unavailable on this server; reads use direct fetch and the wiki API.',
    }
  }
  if (toolName === seedToolRegistry.execute_code.name && caps && caps.codeExec === false) {
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

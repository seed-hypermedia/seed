/**
 * Protocol version negotiation and per-version response shaping.
 *
 * Every signed envelope names the protocol its client speaks (`envelope.protocol`; absent means 1).
 * The dispatcher refuses clients older than `MIN_CLIENT_PROTOCOL` with a `protocol_too_old` error,
 * and hands every successful response through {@link downgradeResponse}, which rewrites it into
 * the shape the client's protocol expects. The shims and the legacy shapes they produce live here
 * and nowhere else, so retiring a protocol version (raising `MIN_CLIENT_PROTOCOL`) is deleting one
 * block from this file.
 *
 * See `agents/protocol/PROTOCOL.md` for the rules and the per-version changelog.
 */
import type * as api from '@/api'
import {AGENTS_PROTOCOL_VERSION, MIN_CLIENT_PROTOCOL, declaredProtocolVersion} from '@seed-hypermedia/agents-protocol'

/** The wire error for a client this server no longer answers; the dispatcher throws it as an APIError. */
export type ProtocolProblem = {status: 426; code: 'protocol_too_old'; message: string}

/** The protocol version an envelope's client speaks. Tolerates a malformed envelope (verification rejects it next). */
export function clientProtocolOf(envelope: unknown): number {
  const declared = envelope && typeof envelope === 'object' ? (envelope as {protocol?: unknown}).protocol : undefined
  return declaredProtocolVersion(declared)
}

/**
 * The refusal for a client below `MIN_CLIENT_PROTOCOL`, or null when it is served. Newer clients
 * are always admitted: a bump of the version obliges the *client* to keep talking to older servers,
 * and an action this server does not know falls through to the dispatcher's own "unknown action".
 */
export function clientProtocolProblem(clientProtocol: number): ProtocolProblem | null {
  if (clientProtocol >= MIN_CLIENT_PROTOCOL) return null
  return {
    status: 426,
    code: 'protocol_too_old',
    message: `This app speaks agents protocol ${clientProtocol}, but this server only answers protocol ${MIN_CLIENT_PROTOCOL} and newer. Update Seed to continue.`,
  }
}

/** What the shims need from the service to rebuild an older shape. */
export type DowngradeContext = {
  /** Newest top-level sessions of an agent as the viewer may see them, for the protocol 1 `GetAgent`. */
  listAgentSessions(agentId: string): api.SessionInfo[]
}

/**
 * Protocol 1 `GetAgentResponse`: it carried the agent's sessions. Declared here rather than on the
 * shared type so that no protocol 2 client can be written against a field it is never sent.
 */
export type GetAgentResponseV1 = api.GetAgentResponse & {sessions: api.SessionInfo[]}

/**
 * Rewrites a response built for {@link AGENTS_PROTOCOL_VERSION} into the shape `clientProtocol`
 * expects. Each shim rewrites from its version to the one below and passes the result on, so a
 * client several versions behind gets every step; add new shims at the top, newest first.
 */
export function downgradeResponse(
  response: api.AgentResponse,
  clientProtocol: number,
  context: DowngradeContext,
): api.AgentResponse {
  let out = response

  // 2 → 1: GetAgent stopped carrying the agent's sessions (#1078). A protocol 1 client reads
  // `sessions` unguarded and crashes its whole window on `undefined`. It gets the newest page of
  // top-level sessions: those clients filter children themselves and their sidebar showed the
  // newest few; the agent page shows a capped list rather than nothing. `sessionCount` is free, so
  // an agent with no sessions costs no extra query.
  if (clientProtocol < 2 && out._ === 'GetAgentResponse') {
    const sessions = out.sessionCount > 0 ? context.listAgentSessions(out.agent.id) : []
    out = {...out, sessions} as GetAgentResponseV1
  }

  return out
}

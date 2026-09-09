/**
 * Protocol version negotiation and per-version response shaping.
 *
 * Every signed envelope names the protocol its client speaks (`envelope.protocol`; absent means 1).
 * The dispatcher refuses clients older than `MIN_CLIENT_PROTOCOL` with a `protocol_too_old` error,
 * and hands every successful response through {@link downgradeResponse}, which rewrites it into
 * the shape the client's protocol expects. The shims live here and nowhere else, so retiring a
 * protocol version (raising `MIN_CLIENT_PROTOCOL`) is deleting one block from this file.
 *
 * See `agents/protocol/PROTOCOL.md` for the rules and the per-version changelog.
 */
import type * as api from '@/api'
import {AGENTS_PROTOCOL_VERSION, MIN_CLIENT_PROTOCOL, declaredProtocolVersion} from '@seed-hypermedia/agents-protocol'

/** Error thrown for a client this server no longer answers. Carries the wire code for the client. */
export class ProtocolTooOldError extends Error {
  readonly status = 426
  readonly code = 'protocol_too_old' as const
  constructor(readonly clientProtocol: number) {
    super(
      `This app speaks agents protocol ${clientProtocol}, but this server only answers protocol ${MIN_CLIENT_PROTOCOL} and newer. Update Seed to continue.`,
    )
    this.name = 'ProtocolTooOldError'
  }
}

/** The protocol version an envelope's client speaks. */
export function clientProtocolOf(envelope: Pick<api.SignedActionEnvelope, 'protocol'>): number {
  return declaredProtocolVersion(envelope.protocol)
}

/**
 * Rejects clients below `MIN_CLIENT_PROTOCOL`. Newer clients are always admitted: a bump of the
 * version obliges the *client* to keep talking to servers down to its `MIN_SERVER_PROTOCOL`, and
 * an action this server does not know falls through to the dispatcher's own "unknown action".
 */
export function assertClientProtocolSupported(clientProtocol: number): void {
  if (clientProtocol < MIN_CLIENT_PROTOCOL) throw new ProtocolTooOldError(clientProtocol)
}

/** What the shims need from the service to rebuild an older shape. */
export type DowngradeContext = {
  /** Newest top-level sessions of an agent, as the protocol 1 `GetAgent` answered them. */
  listAgentSessions(agentId: string): api.SessionInfo[]
}

/**
 * Rewrites a response built for {@link AGENTS_PROTOCOL_VERSION} into the shape `clientProtocol`
 * expects. Applied in descending order so a client two versions behind gets each step.
 */
export function downgradeResponse(
  response: api.AgentResponse,
  clientProtocol: number,
  context: DowngradeContext,
): api.AgentResponse {
  if (clientProtocol >= AGENTS_PROTOCOL_VERSION) return response

  // Protocol 1 → 2: GetAgent stopped carrying the agent's sessions (#1078). A protocol 1 client
  // reads `sessions` unguarded and crashes its whole window on `undefined` — so the newest page is
  // filled in for it, which is what its sidebar and agent page showed anyway.
  if (clientProtocol < 2 && response._ === 'GetAgentResponse') {
    return {...response, sessions: context.listAgentSessions(response.agent.id)}
  }

  return response
}

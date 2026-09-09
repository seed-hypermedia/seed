/**
 * Agents protocol versioning.
 *
 * Clients and servers are built from the same repository but are not deployed together: a desktop
 * release stays in use for weeks, while the hosted agents servers redeploy on every push to main.
 * The shared TypeScript types therefore only prove that client and server agree *at one commit*.
 * Across commits, this number is the contract.
 *
 * Rules (enforced in part by `agents/scripts/protocol-surface.ts`, see `agents/protocol/PROTOCOL.md`):
 *
 * - Additive changes (a new action, a new response, a new field on a response, a new *optional*
 *   field on an action) do not bump the version.
 * - Any other change to what a client sends or a server answers is breaking and bumps
 *   {@link AGENTS_PROTOCOL_VERSION}, with an entry in `PROTOCOL.md`. The server keeps answering
 *   older clients (down to {@link MIN_CLIENT_PROTOCOL}) in the shape they expect — see the compat
 *   layer in `agents/src/protocol-compat.ts` — until the old shape is retired by raising
 *   {@link MIN_CLIENT_PROTOCOL}, at which point those clients get a clear "update the app" error
 *   instead of a response they misread.
 *
 * A client sends the version it speaks as {@link SignedActionEnvelope.protocol}; a server answers
 * with its own in the {@link AGENTS_PROTOCOL_HEADER} response header and in `/api/version`.
 * Clients and servers from before this file existed send and advertise nothing, which both sides
 * read as protocol 1.
 */

/** The protocol version this code speaks (client and server alike). */
export const AGENTS_PROTOCOL_VERSION = 2

/**
 * The oldest client protocol a server built from this code still answers. A client below it is
 * refused with a `protocol_too_old` error (HTTP 426) rather than served a shape it may crash on.
 */
export const MIN_CLIENT_PROTOCOL = 1

/**
 * The oldest server protocol a client built from this code still accepts. A server below it (a
 * self-hosted server left behind) is reported as too old rather than trusted to answer correctly.
 */
export const MIN_SERVER_PROTOCOL = 1

/** Response header carrying the server's {@link AGENTS_PROTOCOL_VERSION}. */
export const AGENTS_PROTOCOL_HEADER = 'X-Agents-Protocol'

/** The version implied by an envelope or response that carries none. */
export const IMPLICIT_PROTOCOL_VERSION = 1

/** Error codes a server answers with when the protocol versions cannot be reconciled. */
export type ProtocolErrorCode = 'protocol_too_old'

/**
 * The protocol version a client declared, or the implicit version 1 when it declared none or
 * declared nonsense (a client that sends garbage is not a client this code was built with).
 */
export function declaredProtocolVersion(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : IMPLICIT_PROTOCOL_VERSION
}

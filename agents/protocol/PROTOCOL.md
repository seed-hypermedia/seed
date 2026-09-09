# Agents protocol versioning

The client (desktop, web, mobile) and the agents server share the TypeScript types in `agents/protocol/src`, but they
are not deployed together. A desktop release stays in use for weeks; the hosted servers (`agents-stable`, `agents-dev`)
redeploy on every push. The types prove that both sides agree at one commit. Across commits, the rules below are the
contract.

The incident that made this necessary: PR #1078 removed `sessions` from `GetAgentResponse`. The change typechecked,
shipped to the server within the hour, and every desktop still on 2026.9.4 crashed at its root component on
`undefined.filter` as soon as it looked at a site that publishes agents.

## The number

`AGENTS_PROTOCOL_VERSION` in `src/version.ts` is a single integer. It is not semver: it goes up by one whenever the wire
surface changes in a way an older client could be hurt by.

- Clients send it as `SignedActionEnvelope.protocol`, signed with the rest of the envelope.
- Servers answer with theirs in the `X-Agents-Protocol` response header and in `/api/version` and `/api/health`
  (`protocol`, `minClientProtocol`).
- Envelopes and responses that carry no version are protocol 1 (everything before this file).

Two more constants bound what each side still tolerates:

- `MIN_CLIENT_PROTOCOL`: the oldest client a server still answers. Below it the server refuses with HTTP 426 and
  `{_: 'Error', code: 'protocol_too_old'}`. The client shows "This app is out of date" instead of misreading a response.
- `MIN_SERVER_PROTOCOL`: the oldest server a client still trusts. Below it the client throws
  `AgentProtocolError('server_too_old')` after the request instead of using the response.

## What counts as breaking

Judged from the point of view of a client built from `main` before your change. `bun run protocol:check` (run in CI on
every PR touching `agents/`) classifies the difference between the committed `surface.json` on the base branch and the
types in your working tree:

| Change                                                     | Client reads it (responses) | Client writes it (actions, envelope) |
| ---------------------------------------------------------- | --------------------------- | ------------------------------------ |
| New action / response type                                 | compatible                  | compatible                           |
| New field                                                  | compatible                  | compatible only if optional          |
| Field removed                                              | breaking                    | breaking                             |
| Field type changed (including a widened or narrowed union) | breaking                    | breaking                             |
| Required field became optional                             | breaking                    | compatible                           |
| Optional field became required                             | compatible                  | breaking                             |
| Named type changed in any other way                        | breaking                    | breaking                             |

The classifier is conservative on purpose. Adding a member to a union that a client reads is "breaking" because a client
with an exhaustive switch over it does not know the new member. If you judge such a change harmless, bump the version
anyway and say so in the entry below; the cost is one line, and the entry is where the next person learns what changed.

## What to do when the check fails

1. **Prefer an additive change.** Add a new field or a new action and leave the old one in place. Most breaking changes
   can be rephrased this way, and then no version bump is needed.
2. **Otherwise bump `AGENTS_PROTOCOL_VERSION`** by one and add a `## Protocol <n>` entry at the bottom of this file
   describing the change.
3. **Keep answering older clients.** Add a shim in `agents/src/protocol-compat.ts` that rewrites your new response into
   the old shape for `clientProtocol < n` (and, if an action changed, accepts the old form). The shim stays until the
   old clients are gone.
4. **Or retire them.** If the old shape genuinely cannot be served any more, raise `MIN_CLIENT_PROTOCOL` to `n` and
   delete the shims below it. Old clients then get a clean "update the app" error. Do this only when a desktop release
   carrying protocol `n` has been out long enough for auto-update to have reached people.
5. `bun run protocol:snapshot` to regenerate `surface.json`, and commit it with the change. The snapshot diff in the PR
   is the review artifact.

## Changelog

## Protocol 1

Everything before versioning existed: envelopes without `protocol`, responses without the header. Served by every server
with `MIN_CLIENT_PROTOCOL <= 1`.

## Protocol 2

2026-09-09, PR #1078 (and the compat layer that followed it).

- `GetAgentResponse` lost `sessions` and gained `sessionCount`; sessions come from the paginated
  `ListSessions {agentId, includeChildren: false}`.
- `SignedActionEnvelope` gained the optional `protocol` field; `ErrorResponse` gained the optional `code`.
- Older clients: `protocol-compat.ts` fills `GetAgentResponse.sessions` with the newest page of top-level sessions for
  protocol 1 clients. Remove the shim and the deprecated field when `MIN_CLIENT_PROTOCOL` reaches 2.

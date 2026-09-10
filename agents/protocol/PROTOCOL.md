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

One more constant bounds what a server still tolerates:

- `MIN_CLIENT_PROTOCOL`: the oldest client a server still answers. Below it the server refuses with HTTP 426 and
  `{_: 'Error', code: 'protocol_too_old'}` (over the websocket, an `error` frame with the same `code`). The client shows
  "This app is out of date" instead of misreading a response, and keeps its remembered session for after the update.

Only that direction is enforced. Hosted servers redeploy before any client can update, and the desktop bundles its own
server, so "new client, old server" only happens to a self-hosted server that fell behind; it is expected to be
upgraded. The client reads the server's version for display and diagnostics but does not refuse it.

## What counts as breaking

Judged from the point of view of a client built from `main` before your change. `bun run protocol:check` (run in CI on
every PR touching `agents/`) classifies the difference between the committed `surface.json` on the base branch and the
types in your working tree:

| Change                                                         | Client reads it (responses) | Client writes it (actions, envelope) |
| -------------------------------------------------------------- | --------------------------- | ------------------------------------ |
| New action / response type                                     | compatible                  | compatible                           |
| New field (also inside one member of a discriminated union)    | compatible                  | compatible only if optional          |
| Field removed                                                  | breaking                    | breaking                             |
| Field type changed                                             | breaking                    | breaking                             |
| Required field became optional                                 | breaking                    | compatible                           |
| Optional field became required                                 | compatible                  | breaking                             |
| Member added to a discriminated union (`_`/`type`/`kind`)      | breaking                    | compatible                           |
| Member removed from a discriminated union                      | breaking                    | breaking                             |
| Any other change to a named type (e.g. a string-literal union) | breaking                    | breaking                             |

Discriminated unions of objects are compared member by member with the field rules above; every other union is compared
as a whole. The classifier is conservative on purpose: adding a member to a union that a client reads is "breaking"
because a client with an exhaustive switch over it does not know the new member. If you judge such a change harmless,
bump the version anyway and say so in the entry below; the cost is one line, and the entry is where the next person
learns what changed.

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
- Older clients: `protocol-compat.ts` fills `GetAgentResponse.sessions` (the `GetAgentResponseV1` shape declared there)
  with the newest 50 top-level sessions, as the viewer may see them, for protocol 1 clients. Protocol 1 answered every
  session unbounded; those clients filtered children themselves, so nothing is lost below 50, but on a busier agent
  their agent page shows a capped list and count. Remove the shim and the V1 type when `MIN_CLIENT_PROTOCOL` reaches 2.

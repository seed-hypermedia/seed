# Keyline authority graph

`keyline` decides whether an audience holds a required power over a subject, given an unordered, append-only set of
delegations and revocations. It is a Go port of the authority rules and conformance suite of
[Ink & Switch's Keyline](https://github.com/inkandswitch/keyhive/tree/main/keyline), at the commit pinned in
[`UPSTREAM`](UPSTREAM).

The application authenticates facts, names nodes, and maps its actions to powers; Keyline derives authority from those
facts. [backend/blob/keyline.md](../blob/keyline.md) describes how Seed does that.

- `keyline`: graph types, the `Store` and `ReadTx` contracts, and the evaluator.
- `keylinemem`: an in-memory `Store` whose zero value is ready to use, the reference store for the port.
- `keylinetest`: the shared test suite every `Store` runs.

Seed's SQLite store is not part of the port. It lives in [backend/blob/keylinesqlite](../blob/keylinesqlite), on Seed's
schema, and runs the same suite.

API contracts live in the godoc. Runnable starting points: `ExampleAllows` in [keyline_test.go](keyline_test.go),
`ExampleClosure` and `Example_rotation` in [example_test.go](example_test.go).

## Authority rules

A delegation says that its issuer grants its audience up to a power over a subject. Principals, resources, and roles
share one node namespace. Powers are ordered `Sync < Read < Write < Admin`. Every nonempty node has Admin over itself;
an application-authenticated root grant from a resource to its owner establishes ownership. The application still
decides who may issue facts on behalf of a node, including resources without signing keys.

Membership composes, capped by the weakest power along a route; independent routes contribute their strongest result.
For example, a role with Write over a document passes Write to Bob when Bob has Admin over that role. A delegation needs
a grounded route from its subject to its issuer: a cycle with no such route creates no authority.

Issuer or audience revocations remove an entire delegation. Other revocations exclude routes through the revoker's Admin
reach in the positive graph, which ignores revocations and therefore retains former admins' reach. Independent routes
can keep a delegation live at a reduced power.

Authority depends only on the known fact set, never on arrival order or timestamps.

## Differences from upstream

The authority rules match upstream. What differs is how facts are represented and how the package plugs into Seed:

- Nodes and fact IDs are opaque strings rather than Ed25519 keys and certificate hashes, so resources need no key pair.
  The application authenticates facts; upstream's signing frames, certificates, encryption, and key management are not
  ported.
- Instead of upstream's `Relay < Read < Edit < Admin`, powers are `Sync < Read < Write < Admin`, numbered 1 to 4 in
  that order. The numbers are what SQL stores and compares, so they never change. "Sync" says what the lowest level is
  for, syncing data, and avoids confusion with libp2p relays.
- Upstream defines an async Keyline trait that each backend implements, evaluation included, and ships the in-memory
  MemoryKeyline as its reference backend; its design notes shape the trait for database and DBSP backends but ship none.
  Each upstream query is atomic inside the store and never shares a transaction with the caller. Here one evaluator runs
  over any store's indexed `ReadTx`, so a store can expose a caller-owned transaction, as Seed's SQLite store does, and
  authority checks see exactly the facts that transaction will commit.
- `MembersOf` evaluates several subjects in one pass over the facts they share, which upstream has no counterpart for.
- Upstream's grant, revocation, and role-rotation workflows are not ported yet ([TODO.md](TODO.md)). Until then,
  applications compose authenticated batches themselves.
- Upstream's reissue citations and `retain` watermarks on revocations are not ported: callers assign fresh fact IDs for
  reissues, and decide what to keep of a revoked writer's content.
- Earliest-known node mentions (`NodeRecord`) record application provenance and never affect authority. Integer blob and
  node IDs are local bookkeeping.
- Upstream has no implied facts. Here a delegation with a zero blob ID is implied (`Delegation.Implied`): the
  application derives it from its own rules, such as how nodes are named, rather than from a signed blob, so each
  replica derives it instead of receiving it. Evaluation treats it like any other delegation. Revocations always have a
  blob.
- `Digest` covers authority fields as well as fact IDs, because opaque IDs need not identify their contents. It is a
  local comparison fingerprint, not upstream's certificate-set digest. [TODO.md](TODO.md) tracks a reference digest for
  tests and whether fact IDs should be content-addressed.

## Evaluated edges

A subject's evaluated edges are the strongest power that live delegations about it convey to each audience, after
grounding and revocations: for each audience, the strongest `Conveyed` among the subject's delegations to it. Members
compose along them: a node's power over a subject is the strongest, over chains of edges leading from the subject to the
node, of the weakest edge on the chain. So a store can keep every subject's edges current and answer authority checks as
a reachability query, with storage that grows with the number of delegations rather than with subjects times their
transitive members. Raw facts remain the source of truth; edges are derived from them and can be rebuilt.

The core keeps no such index; it always evaluates from raw facts, so it stays the oracle. A store that keeps edges does
so as its own implementation detail, as Seed's SQLite store does. The conformance suite checks such a store's edges and
its own `Allows` against the core when its `ReadTx` implements the optional interfaces the suite defines.

## Partial replicas

`Closure` exports the facts a subject's authority depends on, including revoked paths and their revocations. A closure
is complete only relative to the exporting store's known facts and cannot prove that no revocation was withheld or is
still in transit, so a stale replica can allow someone already removed elsewhere. A matching `Digest` does not prove
completeness either. The application must decide when a replica is synchronized enough to trust its answers.

## Admin rotation

To remove an admin from a role, apply one atomic batch that:

1. Introduces a fresh role node, with fresh fact IDs.
2. Grants the new role the old role's supplies, and grants every surviving admin Admin over the new role. Reissue any
   other memberships to keep.
3. Revokes every old supply.

Survivors' downstream delegations keep their IDs and become grounded through the new role, and their revocations keep
covering routes through it. The removed admin's revocations confined to the old role stop covering the new one, so
survivors must reissue bans they want to keep. Old facts stay stored, and a fresh supply to the abandoned role
reconnects its old members; explicitly revoke old memberships when removal must survive that.

Rotation removes an admin only when their retained reach does not cover the new routes. Anyone who ever held Admin over
a stable subject keeps reach over it in the positive graph and can revoke the new supply, so the old role must have held
at most Write over every subject it reaches. A steward arrangement fits this: a stable steward supplies Write to an
officers' role, and replacing that one supply rotates officers across every document rooted in the steward.

## Upstream tracking

[`UPSTREAM`](UPSTREAM) pins the upstream commit, the upstream paths that may require porting, and the conformance cases
deliberately left unported. Every ported case carries an `// upstream: <module>::<case>` marker on the Go test or law
that ports it. Run [`upstream.sh`](upstream.sh) on demand to compare the pin with an upstream ref and check those
markers. The bump routine is in [AGENTS.md](AGENTS.md).

## Tests

The core package tests only store-free behavior. [keylinetest](keylinetest) holds the store contract and the scenario
ports. [keylinetest/conformance](keylinetest/conformance) ports upstream's conformance laws, generator, and two
independent oracles, with one Go function per upstream law, plus laws for Go-only API in `extensions.go`.
`conformance.Run` checks every law on planted shapes and a deterministic sweep of generated sets, and the fuzz targets
search further. `keylinemem` and Seed's SQLite store run `keylinetest.Run`, `conformance.Run`, and the fuzz targets, and
add tests for their own locking or schema. A new store gets the same coverage the same way. From the repository root:

```sh
direnv exec . go test -race ./backend/keyline/...
direnv exec . go test ./backend/keyline/keylinemem -run '^$' -fuzz '^FuzzStructuredEvaluation$' -fuzztime=60s
backend/keyline/upstream.sh
```

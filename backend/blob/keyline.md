# Seed's Keyline integration

[`authority.go`](authority.go) projects authenticated Capability blobs into a Keyline graph stored in the same SQLite
database. Projection runs in the indexing transaction, so graph, stored edges, and content index commit or roll back
together. The store is [`keylinesqlite`](keylinesqlite), Seed's own implementation of the port's store contract; its
tables are defined in `storage/schema.sql` and change through Seed's migrations, like any other table.

The authority rules are in [Keyline's README](../keyline/README.md). `blob_capability.go` stores each capability's
delegations; `index.go` and `index_access.go` check authority over Keyline's stored edges; sync selects closures through
`AuthorityBlobIDs`.

## Graph mapping

One key plays three roles, so it gets three nodes:

- `key:<principal>` is the account identity.
- `space:<principal>` is the members of its space. The space's home document is this node too, since grants are
  recursive and an empty path already means the whole space.
- `resource:<principal><path>` is a document scope, with the path as signed, for example `resource:z6Mk…/team/notes`.

Only capabilities are stored. A Ref, Change, Comment, or Profile writes nothing to Keyline.

- A WRITER capability grants Write over its resource node. Keyline grounds a delegation only through its issuer's
  standing over the subject, so the capability also stores two Admin root edges, as upstream roots a document in its
  owners: `resource → space`, issued by the resource, and `space → key`, issued by the space. A capability on the space
  root needs only the second. Ownership follows from how nodes are named, not from any capability, so root edges are
  implied delegations: they have no blob, and their IDs name their scope, `owner:<principal><path>` and
  `space-owner:<principal>`. Each capability that needs one repeats it exactly, so a scope has one root edge however
  many capabilities it has. A root edge outlives its capabilities until the next reindex, which is harmless, since it
  states nothing the naming rules don't already say.
- An AGENT capability grants Write over its signer's key. Forward (account to session key) and reverse (session key to
  account) capabilities look the same, so both directions grant Write, never Admin. Chains compose with no hop limit.
- A capability's own delegation has its CID as ID and the capability's local blob ID.

Path inheritance is not in the graph. Grants are recursive, so a check over a document asks Keyline about every scope
that covers it (`authorityScopes`): the owner's key, the space, then each ancestor resource down to the document, and
passes if any grants the power. This also covers documents that do not exist yet. Intermediate path segments get no
edges until writers can re-delegate.

Seed's signed Capability format represents grants only, so the projection never produces revocations. `Sync` and `Read`
exist in the evaluator, but mapping them to transport or private-data access needs application policy.

## Stored edges

`keylinesqlite` keeps Keyline's evaluated edges in `keyline_edges` (see the [Keyline README](../keyline/README.md)) and
updates them in the same savepoint as each applied capability. Storage grows with the number of capabilities, not with
documents times the transitive members of the keys they name. Write and agent checks are recursive reachability queries
over the edges with at least Write, built by `keylinesqlite.SQLReaches` and equal to `keyline.Allows` over each scope.
SQL filters that run per row, such as `SQLCanWriteRootByOwnerID`, embed the same expression.

The batch (`indexBatch`) collects the delegates new capabilities name. When it flushes, at the end of a Put, PutMany
batch, or reindex pass, it drops memoized write checks and retries permission-denied blobs signed by each new delegate
or by any key that acts for it. PutMany indexes a batch's capabilities first, so the rest of the batch is checked
against the updated edges.

## Rebuilds

A full reindex runs two passes over the blobs table: capabilities first, then a flush that retries their delegates'
blobs, then every other blob. A reset leaves no blob types, so the first pass recognizes capabilities by their CBOR type
bytes.

Keyline's tables are derived data like every other index, so only a full reindex rebuilds them. A migration that changes
how capabilities are projected schedules one. There is no authority-only rebuild: authority decides which other blobs
are valid, so re-evaluating it alone would leave the rest of the index stale. Every Keyline fact and node mention except
an implied delegation references the blob that defines it, with no `ON DELETE`, so deleting a capability that Keyline
cites fails instead of leaving its grants behind.

## Sync

Discovery and push select authority closures for requested resources, including ancestor grants and AGENT chains outside
the resource tree. Only original Capability blobs travel, regardless of blob-type filters. Implied delegations, such as
root edges, have no blob to select; receivers derive them from the capabilities. Receivers verify those blobs and
rebuild the same graph with their own local blob IDs.

Ordinary document updates maintain reconciliation sets incrementally. A capability batch rebuilds all materialized
scopes asynchronously after indexing commits, including exact-child scopes whose authority changed outside their
subtree, preserving access timestamps. This favors complete replication over capability-arrival cost.

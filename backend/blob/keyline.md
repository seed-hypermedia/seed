# Seed's Keyline integration

[`authority.go`](authority.go) projects authenticated Capability blobs into a Keyline graph stored in the same SQLite
database. Projection runs in the indexing transaction, so graph, membership cache, and content index commit or roll back
together.

The authority rules are in [Keyline's README](../keyline/README.md). `blob_capability.go` stores each capability's
delegation; `index.go` and `index_access.go` read the membership cache; sync selects closures through
`AuthorityBlobIDs`.

## Graph mapping

One key plays three roles, so it gets three nodes:

- `key:<principal>` is the account identity.
- `space:<principal>` is the members of its space. The space's home document is this node too, since grants are
  recursive and an empty path already means the whole space.
- `resource:<principal><path>` is a document scope, with the path as signed, for example `resource:z6Mk…/team/notes`.

Only capabilities are stored. A Ref, Change, Comment, or Profile writes nothing to Keyline. Ownership and path
inheritance follow from node names, so `authorityParent` computes them through `keyline.Evaluator.Parent` instead of
storing them: a resource's parent is its parent resource or its space, and a space's parent is its owner key. Each
parent holds Admin over its child.

- A WRITER capability grants Write over its resource node.
- An AGENT capability grants Write over its signer's key. Forward (account to session key) and reverse (session key to
  account) capabilities look the same, so both directions grant Write, never Admin. Chains compose with no hop limit.
- A delegation's ID is its capability's CID, and its blob ID is the capability's local blob ID.

Seed's signed Capability format represents grants only, so the projection never produces revocations. `Sync` and `Read`
exist in the evaluator, but mapping them to transport or private-data access needs application policy.

## Membership cache

`keyline_members` caches effective powers for every delegation subject and for each key subject's space, keyed by
interned `keyline_nodes` IDs. Write checks and agent checks are SQL lookups against it; the evaluator does not use it. A
write check accepts a member of any of the target's breadcrumb scopes, which covers documents that do not exist yet.

Indexing a capability only stores its delegation and marks its subject stale in the batch (`indexBatch`). When the batch
flushes, at the end of a Put, PutMany batch, or reindex pass, every stale subject and every cached subject it is a
member of are evaluated together with `MembersOf`, so a shared graph is evaluated once per batch instead of once per
capability. The flush then retries permission-denied blobs signed by each new delegate or by any key that writes as it.
PutMany indexes a batch's capabilities first, so the rest of the batch is checked against the refreshed cache.

## Rebuilds

A full reindex runs two passes over the blobs table: capabilities first, then a flush that fills the cache once, then
every other blob. A reset leaves no blob types, so the first pass recognizes capabilities by their CBOR type bytes.

Startup rebuilds the projection from indexed Capability blobs when `authorityVersion` changes, then retries every
permission-denied blob, without touching signed bytes or document, search, and embedding data. Deleting an indexed block
rebuilds authority from surviving capabilities and invalidates cached sync scopes; reinserting the same bytes may get a
new local blob ID.

## Sync

Discovery and push select authority closures for requested resources, including ancestor grants and AGENT chains outside
the resource tree. Only original Capability blobs travel, regardless of blob-type filters. Receivers verify those blobs
and rebuild the same graph with their own local blob IDs.

Ordinary document updates maintain reconciliation sets incrementally. A capability batch rebuilds all materialized
scopes asynchronously after indexing commits, including exact-child scopes whose authority changed outside their
subtree, preserving access timestamps. This favors complete replication over capability-arrival cost.

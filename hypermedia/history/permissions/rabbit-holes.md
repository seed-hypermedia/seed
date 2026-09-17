---
name: Permissions Rabbit Holes
summary: The six tar pits in any permissions system over replicated content-addressed data, ranked by depth, with the practical way past each.
displayAuthor: Eric Vicenti
---
Each of these looks like a feature request and is actually a research area. This doc ranks the rabbit holes in the [permissions proposal](./v1-proposal.md) by how deep they go, and names the practical escape from each. The theme throughout: the escape is never "solve it". It is always "choose honest semantics that don't require solving it." <!-- id:RQ_FcXWg -->

# 1. Revocation (bottomless) <!-- id:qQX93e7a -->

The deepest hole, and the one the original proposal waved away with "a later signed statement invalidates a cap." <!-- id:wG49gjbf -->
  - **The physics:** once bytes have replicated, they cannot be unshared. Revocation can only mean "honest servers stop serving to new requests." <!-- id:DGns_4gF -->
  - **The ordering trap:** "later statement wins" requires knowing what _later_ means. Signed wall-clock timestamps are claims, and nothing proves them. A compromised device key can sign a grant _backdated_ before its own revocation, and no verifier can tell. Matrix spent years on exactly this class of bug. <!-- id:iK0j4IyJ -->
  - **The offline trap:** replicas that haven't synced the revocation keep granting access. There is no fix, only a bound: require caps to be re-validated against a fresh revocation head every N hours. That quietly brings a liveness requirement back into an offline-first system. <!-- id:vSSCvhaA -->

**Escape:** revoke by _epoch_, never by time. Each space keeps a monotonically versioned auth head (itself a signed blob chain). Grants name the epoch they were issued under, and bumping the epoch invalidates everything not re-issued. The common case is cheap: "remove this one person" means bump the epoch and re-issue for everyone else automatically. The ordering comes from DAG position and ignores clock claims. Accept it openly: revocation limits future access on honest servers, and nothing more. <!-- id:iPrBJF9T -->

# 2. Time and ordering (deep, connected to #1) <!-- id:DDTvnFFJ -->

The envelope proposal puts a timestamp in every publish signature and gives it meaning (supersession, revocation ordering). But nothing in the system can verify a timestamp, and this hole is not hypothetical. Today the alive-vs-deleted decision (`max` of Ref timestamps) and the document-visibility register (last-writer-wins on Ref `ts`) already rest on unvalidated, client-supplied timestamps. A far-future timestamp wins those registers permanently. See [Integrity](../../protocol/integrity.md). <!-- id:LtCxvHRS -->
  - Backdating allows permissions to come back from the dead. Forward-dating allows grants that "activate" after an audit. <!-- id:UyFg2WxJ -->
  - Any two devices' clocks disagree. Offline edits arrive with stale timestamps and must not be rejected for it. <!-- id:WHXI1oky -->

**Escape:** timestamps stay _advisory_ (display, tie-breaking). Anything with security meaning orders by causal position: deps in the change DAG, epoch in the auth chain. If a signed statement's validity depends on wall-clock time, redesign it until it doesn't. The one defensible use is cap _expiry_, where the enforcing server checks its own clock and ignores the blob's. <!-- id:MOpO7QpT -->

# 3. Transitive access through links (deep, but bounded) <!-- id:t7apUvHP -->

"You can read a blob if you can read a blob that links to it" is either the system's most elegant rule or its biggest hole. One word decides which: _whose_ links. <!-- id:i7MKuM_e -->
  - Propagating along **arbitrary IPLD links** is game over. Anyone can mint a blob linking to any CID they've heard of and launder access to other people's private data. <!-- id:bEHyp7Xs -->
  - Propagating along **owner-signed structure** (a [Change](../../change.md)'s deps, the file blobs a Change embeds, a [Ref](../../ref.md)'s heads) is safe. The owner already had authority over everything they bundled, so the grant only spreads authority the grantor held. A CID _mention_ is a name, and it grants nothing. <!-- id:0HKajrc- -->
  - The subtle middle case: document embeds and queries reference _other people's_ documents. Access must not propagate across an ownership boundary. An embed renders for you only if you can read the target through your own grants. <!-- id:Ypzc-OUI -->

**Escape:** propagation is today's `blob_visibility_rules` table, verbatim, evaluated only over links whose source blob is signed by an authority of the granting space. The rule table already encodes exactly this (Change→dep, Ref→head, anything→DagPB/Raw). This hole has an escape because the fence is one sentence long. <!-- id:X9tRVrIl -->

# 4. History and redaction (medium, sneaky) <!-- id:SVpMLZKt -->

A grant on a _document_ naturally covers its change DAG, because that is how propagation works. But the change DAG contains every draft, every deleted paragraph, and every prior version. Sharing a doc with an outsider shares its entire editing history, which nobody expects from "share." <!-- id:_ciqDJ4n -->

**Escape:** two grant scopes, explicit in the cap: `version` (this frozen DAG snapshot) and `document` (follows updates). For `document` grants on previously private docs, default to _forward-only_: cover versions from the grant's epoch onward. History access is an explicit opt-in flag. This also gives redaction honest semantics. Publish a new version, and forward-only grants simply don't cover the old ones. Nobody pretends the old versions are erased. <!-- id:uG3yiILK -->

# 5. Groups and membership (medium, recursive) <!-- id:wAl1c87n -->

"Grant read to space X" requires resolving X's membership at serve time. Membership changes are themselves permission events (see #1). Nested groups make evaluation recursive. A member list is itself private data, so grant evaluation must not leak the roster through differences in error messages or timing. <!-- id:714nW-h9 -->

**Escape:** flatten at issuance where possible. Space grants auto-materialize per-member grants at the current epoch and refresh them on each epoch bump. Cap nesting depth at 1 for now. Do not build general nested groups until someone actually needs them. <!-- id:U26Bz9Lz -->

# 6. The query-surface perimeter (shallow but very wide) <!-- id:nKf1qsMq -->

The blockstore check is maybe 10% of enforcement. Private content is also reachable through search and embeddings, citations and backlinks, activity feeds, directory listings, comment lists, the dagjson endpoint, discovery, sync, and every future endpoint anyone adds. Each one is an oracle: even a 404-vs-403 difference or a citation count leaks existence. The current code already pays this tax the cheap way, with a `publicOnly` boolean threaded through every query, because binary visibility makes every filter a one-liner. Per-caller caps make every filter a cap evaluation. <!-- id:vrI1VTMS -->

**Escape:** never evaluate caps in per-surface query logic. Materialize grant evaluation into an access table, conceptually `(blob, principal)`, the generalization of today's `(blob, space)` in `blob_visibility`. Maintain it at indexing time, so every query surface filters by a join, the same way `publicOnly` does today. One evaluator, many filters. And make the two failure modes indistinguishable on purpose: unauthorized and nonexistent must return identical responses everywhere. <!-- id:r8Lkz4Ax -->

# The pattern <!-- id:CBLRa37x -->

Holes 1, 2, and 5 are the same hole, _authorization state changing over time in a replicated system_, and they share one escape: an epoch-versioned auth chain per space, ordered by DAG position. Holes 3, 4, and 6 are scope questions with cheap fences. Nothing here needs new cryptography or new research. All of it needs refusing features whose honest version cannot be built: wall-clock semantics, arbitrary-link propagation, nested groups, and retroactive erasure. The [synthesis](./grants.md) is built around these escapes. <!-- id:0ZS_4HVQ -->

# See also

- [How Privacy Works Today](./current-state.md)
- [Tearing the Proposal Apart](./critique.md)
- [Prior Art for Content Permissions](./prior-art.md)
- [Everything Is a Grant](./grants.md)
- [Permissions](../../protocol/permissions.md)
- [Privacy](../../protocol/privacy.md)

---
name: Permissions Rabbit Holes
summary: The six tar pits in any permissions system over replicated content-addressed data — ranked by depth, with the pragmatic way past each.
displayAuthor: Eric Vicenti
---
Every one of these looks like a feature request and is actually a research area. This doc ranks the rabbit holes in the [permissions proposal](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/v1-proposal) by how deep they go, and names the pragmatic escape from each. The theme throughout: the escape is never "solve it" — it's "choose honest semantics that don't require solving it." <!-- id:RQ_FcXWg -->

# 1. Revocation (bottomless) <!-- id:qQX93e7a -->
The deepest hole, and the one the original proposal hand-waved with "a later signed statement invalidates a cap." <!-- id:wG49gjbf -->
  - **The physics:** once bytes have replicated, they cannot be unshared. Revocation can only mean "honest servers stop serving to new requests." <!-- id:DGns_4gF -->
  - **The ordering trap:** "later statement wins" requires knowing what _later_ means. Signed wall-clock timestamps are claims, not facts — a compromised device key can sign a grant _backdated_ before its own revocation, and no verifier can tell. Matrix spent years on exactly this class of bug. <!-- id:iK0j4IyJ -->
  - **The offline trap:** replicas that haven't synced the revocation keep granting access. There is no fix, only a bound (require caps to be re-validated against a fresh revocation head every N hours — which quietly reintroduces a liveness requirement into an offline-first system). <!-- id:vSSCvhaA -->

**Escape:** revocation by _epoch_, not by time. Each space keeps a monotonically-versioned auth head (itself a signed blob chain). Grants name the epoch they were issued under; bumping the epoch invalidates everything not re-issued. Cheap for the common case ("remove this one person" = bump epoch, auto-re-issue everyone else), and the ordering is DAG position, not clock claims. Accept openly: revocation limits future access on honest servers, nothing more. <!-- id:iPrBJF9T -->

# 2. Time and ordering (deep, connected to #1) <!-- id:DDTvnFFJ -->
The envelope proposal puts a timestamp in every publish signature and gives it semantic weight (supersession, revocation ordering). But nothing in the system can verify a timestamp — and this hole is not hypothetical: today the alive-vs-deleted decision (`max` of Ref timestamps) and the document-visibility register (last-writer-wins on Ref `ts`) already ride on unvalidated, client-supplied timestamps. A far-future timestamp wins those registers permanently. <!-- id:LtCxvHRS -->
  - Backdating enables permission resurrection; forward-dating enables grants that "activate" after an audit. <!-- id:UyFg2WxJ -->
  - Any two devices' clocks disagree; offline edits arrive with stale timestamps and must not be rejected for it. <!-- id:WHXI1oky -->

**Escape:** timestamps stay _advisory_ (display, tie-breaking); anything with security meaning orders by causal position — deps in the change DAG, epoch in the auth chain. If a signed statement's validity depends on wall-clock time, redesign it until it doesn't. The one defensible use: cap _expiry_, where the enforcing server checks its own clock, not the blob's. <!-- id:MOpO7QpT -->

# 3. Transitive access through links (deep, but bounded) <!-- id:t7apUvHP -->
"You can read a blob if you can read a blob that links to it" is either the system's most elegant rule or its biggest hole, depending on one word: _whose_ links. <!-- id:i7MKuM_e -->
  - Propagating along **arbitrary IPLD links** is game over: anyone can mint a blob linking to any CID they've heard of and launder access to other people's private data. <!-- id:bEHyp7Xs -->
  - Propagating along **owner-signed structure** (a Change's deps, the file blobs a Change embeds, a Ref's heads) is safe: the owner already had authority over everything they bundled, so the grant only spreads authority the grantor possessed. A CID _mention_ is a name, not a grant. <!-- id:0HKajrc- -->
  - The subtle middle case: document embeds and queries reference _other people's_ documents. Access must not propagate across an ownership boundary — an embed renders for you only if you can read the target through your own grants. <!-- id:Ypzc-OUI -->

**Escape:** propagation = today's `blob_visibility_rules` table, verbatim, evaluated only over links whose source blob is signed by an authority of the granting space. The rule table already encodes exactly this (Change→dep, Ref→head, anything→DagPB/Raw). This hole is escapable because the fence is one sentence long. <!-- id:X9tRVrIl -->

# 4. History and redaction (medium, sneaky) <!-- id:SVpMLZKt -->
A grant on a _document_ naturally covers its change DAG — that's how propagation works. But the change DAG contains every draft, every deleted paragraph, every prior version. Sharing a doc with an outsider shares its entire editing history, which is not what anyone expects from "share." <!-- id:_ciqDJ4n -->

**Escape:** two grant scopes, explicit in the cap: `version` (this frozen DAG snapshot) and `document` (follows updates). For `document` grants on previously-private docs, default to _forward-only_: cover versions from the grant's epoch onward. History access is an explicit opt-in flag. This also gives redaction honest semantics: publish a new version, and old versions simply aren't covered by forward-only grants — no pretense of erasure. <!-- id:uG3yiILK -->

# 5. Groups and membership (medium, recursive) <!-- id:wAl1c87n -->
"Grant read to space X" requires resolving X's membership at serve time. Membership changes are themselves permission events (see #1); nested groups make evaluation recursive; a member list is itself private data (grant evaluation must not leak the roster through error-message differences or timing). <!-- id:714nW-h9 -->

**Escape:** flatten at issuance where possible (space grants auto-materialize per-member grants at the current epoch, refreshed on epoch bump), and cap nesting depth at 1 for now. Do not build general nested groups until someone actually needs them. <!-- id:U26Bz9Lz -->

# 6. The query-surface perimeter (shallow but very wide) <!-- id:nKf1qsMq -->
The blockstore check is maybe 10% of enforcement. Private content is also reachable through: search and embeddings, citations/backlinks, activity feeds, directory listings, comment lists, the dagjson endpoint, discovery, sync — and every future endpoint anyone adds. Each is an oracle: even a 404-vs-403 difference or a citation count leaks existence. The current code already pays this tax the cheap way — a `publicOnly` boolean threaded through every query — because binary visibility makes every filter a one-liner. Per-caller caps make every filter a cap evaluation. <!-- id:vrI1VTMS -->

**Escape:** never evaluate caps in per-surface query logic. Materialize grant evaluation into an access table — conceptually `(blob, principal)`, the generalization of today's `(blob, space)` in `blob_visibility` — maintained at indexing time, so every query surface filters by a join, same as `publicOnly` does today. One evaluator, many filters. And make the two failure modes indistinguishable on purpose: unauthorized and nonexistent must return identical responses everywhere. <!-- id:r8Lkz4Ax -->

# The pattern <!-- id:CBLRa37x -->
Holes 1, 2, and 5 are all the same hole — _authorization state changing over time in a replicated system_ — and share one escape: an epoch-versioned auth chain per space, ordered by DAG position. Holes 3, 4, and 6 are all scope questions with cheap fences. Nothing here requires new cryptography or new research; all of it requires refusing features (wall-clock semantics, arbitrary-link propagation, nested groups, retroactive erasure) whose honest version is unbuildable. The [synthesis](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/grants) is built around these escapes. <!-- id:0ZS_4HVQ -->
---
name: How Privacy Works Today
summary: A precise map of the existing visibility, capability, and auth machinery in Seed - including the load-bearing surprises any redesign must account for.
displayAuthor: Eric Vicenti
---
Before redesigning anything, here is what actually exists — from a close read of the backend. The headline: **Seed already has most of a permissions system**, spread across five mechanisms that grew separately. The [critique](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/critique) and [synthesis](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/grants) build directly on this map. <!-- id:jjbxMiNL -->

# The signed statements that already exist <!-- id:PyD-RjBd -->

Every permanent blob embeds the same base: `{type, signer, ts, sig}`, signed as canonical DAG-CBOR (`backend/blob/blob.go`). On top of that: <!-- id:BjTUTNMC -->
  - **Ref** (`blob_ref.go`) — a signed claim binding a space + path to head Change CIDs, with `genesisBlob`, `generation`, `redirect`, and — crucially — a **`visibility` field**. Deletion is a Ref with empty heads; redirect is a Ref with a redirect target. _A Ref is already a signed publish envelope: CID + timestamp + visibility + signature, plus tombstone and redirect semantics._ <!-- id:f1eK4d-M -->
  - **Change** (`blob_change.go`) — deps, depth, ops. **No visibility field**; changes are private-by-default and become public only when a public Ref reaches them through link propagation. <!-- id:eQnUQ8WQ -->
  - **Capability** (`blob_capability.go`) — issuer (signer), `delegate`, `path`, `role`, optional `audience`. Roles are exactly `WRITER` and `AGENT` (an `EDITOR` is a commented-out TODO). **No expiry field, no revocation** (`RevokeCapability` is a commented-out TODO), and chains resolve at depth 2 max: owner→delegate, or owner→agent→delegate. <!-- id:QWxYQ3c2 -->
  - **Comment** (`blob_comment.go`) — carries its **own** visibility field, snapshotted from the target document at creation time. <!-- id:TNqahwnK -->
  - Profile, Contact, Capability blobs are hardcoded always-public at indexing. <!-- id:GtwMp2Nd -->

# Visibility: one table, four rules, monotone forever <!-- id:gWeJLa2Y -->

`blob_visibility (blob_id, space)` is the whole access model. `space = 0` means public; `space = N` means visible to space N. Rows are seeded from the Ref's (or Comment's) signed visibility field and propagated down the DAG by a four-row rule table: Change→dep, Ref→head, anything→DagPB, anything→Raw (`schema.sql`, `index_visibility.go`). <!-- id:0I0etsf0 -->

Three properties worth staring at: <!-- id:XKyl6sXq -->
  1. **It's a grant table that doesn't know it.** `(blob, space=0)` is "everyone may read"; `(blob, space=N)` is "space N's people may read." The system already thinks in audiences — it just has only two. <!-- id:aKdh6SLx -->
  2. **It's monotone.** Rows are only ever added (`INSERT OR IGNORE`). Once a blob has a public row it is public _forever_; flipping a document private only changes the `document_generations.visibility` register, which gates listings — the old blobs remain served to anyone with the CID. **There is no unpublish at the blob layer.** <!-- id:Ru6Yrd82 -->
  3. **The seeds are only Refs and Comments.** Everything else inherits. So the Ref really is the sole authority on publicness — the proposal's instinct that "the publish must carry the visibility claim" is not a new requirement; it's the current design. <!-- id:2ihnYvJI -->

# Reading private content: write access in a trenchcoat <!-- id:fqdhz8gn -->

There is no read permission anywhere. Every private-read gate reuses the _write_-capability check: <!-- id:QA0ahMMd -->
  - HTTP blockstore reads: authenticated caller passes if they own the space or hold a **root-scoped** WRITER/AGENT capability (`dbBlobCanCallerAccess` → `SQLCanWriteRootByOwnerID`). A WRITER scoped to the very path being read is **denied** — path-scoped caps don't count (documented pitfall, issue #618). <!-- id:oyiZtpJ2 -->
  - API listings: `dg.visibility IS NOT 'Private' OR <caller can write root>`. <!-- id:Wqc64oLo -->
  - P2P/bitswap: `CanPeerAccessCID` accepts space owners and site servers — but via a _different_ rule that accepts `WRITER` only (no AGENT) and doesn't require root scope. Two subsystems, same question, different answers. <!-- id:o8R-gaSX -->

Authentication itself is solid and layered: browsers hold a non-extractable WebCrypto session key, receive a delegation Capability from the Vault, sign a short-lived assertion (an ephemeral, never-published Capability with the daemon's peer ID as audience, ±5 min window), and exchange it for an encrypted 30-day bearer token in an httpOnly cookie. P2P peers do the same dance with ±1 min windows. The agents service already has a full `SignedActionEnvelope` pattern — signed CBOR action carrying the delegating capability's CID inside the signature. _The transport layer for a grants system already exists three times over._ <!-- id:wc9g_kmF -->

# Sync: private blobs do replicate <!-- id:sNc5iM39 -->

Private blobs sync to authenticated peers of the space and to the space's designated site server; RBSR reconciliation filters fingerprints so unauthorized peers can't even detect private items; pushes temporarily allowlist specific CIDs for the receiving site server. But collaborator devices never discover each other directly — the site server is the hub. And one sharp edge: bitswap's filter **fails open** when a blob has no visibility rows at all, while the HTTP blockstore **fails closed** on the same condition. <!-- id:MuhL0mX3 -->

# The cracks (each one is a design input) <!-- id:Gm-sJko4 -->

1. **`CreateRef` hardcodes `VisibilityPublic`** — the server API path can't create private refs at all; only client-signed refs carry privacy. Open VULN-5. <!-- id:Ex6HMnuE -->
2. **Nothing enforces "visibility only at first publish."** The client signs the Ref; a modified client can flip any doc's visibility on any publish. The server merely indexes what arrives. <!-- id:n93GCMLT -->
3. **Timestamps are attacker-controlled and load-bearing.** The alive-vs-deleted decision is `max(ref timestamps)`, and visibility is a last-writer-wins register keyed on Ref `ts` — with no index-time validation whatsoever. A far-future timestamp wins forever. The [rabbit-holes doc](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/rabbit-holes) treats this as hypothetical risk; here it is already live. <!-- id:cuNu8hwt -->
4. **Privacy is opt-in per deployment.** Every gate is inert unless the daemon runs `-public-only`; on a default desktop daemon, any local caller reads all private documents (open issue #664). The agents service HTTP API has no auth at all — locality is the control. <!-- id:j79yA5bk -->
5. **Private docs are structurally one path segment** — no private subtrees. <!-- id:QSw6OqeV -->
6. **Comment visibility never reconciles** with the target document's later visibility changes — frozen at creation, in the signed blob. <!-- id:xot-55wS -->
7. **Raw IPFS uploads are anonymous.** `POST /ipfs/file-upload` accepts unsigned bytes; nothing claims them until a document links them. <!-- id:TCxHS9jX -->
8. **The `.dagjson` endpoint** correctly enforces public-only and honors bearer auth — but returns a distinguishable error message for "exists but private" vs "not found": a small existence oracle. <!-- id:8-XJ-nF8 -->

# What this map means <!-- id:mRlW1owF -->

The proposal's three pillars land differently against reality: the _envelope_ already exists (Ref); the _read capability_ genuinely does not (read is derived from write, root-only, with no expiry or revocation); and _link propagation_ already exists for visibility (the four-rule table) but has never been generalized to audiences. Meanwhile the real deficits — monotone visibility, unvalidated timestamps, inconsistent gates, opt-in enforcement — are things no new blob type fixes by itself. That framing drives the [critique](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/critique). <!-- id:7qhHclIH -->

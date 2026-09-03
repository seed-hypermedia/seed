---
name: Everything Is a Grant
summary: The rebuilt design - one signed statement kind that unifies public publishing, private spaces, document sharing, share links, and comments.
displayAuthor: Eric Vicenti
---
This is the reconstruction after the [shredding](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/critique). It is built on one observation the original proposal missed: <!-- id:aZ8cP7IF -->

**The system already has a permissions model. It just doesn't know it.** <!-- id:QWVCleUL -->

Today a blob is public when `blob_visibility` holds `(blob, space=0)`, and space-visible when it holds `(blob, space=N)`. Read that table as what it actually is: a materialized set of _grants_. `space=0` is a grant to the audience "everyone." `space=N` is a grant to the audience "members of N." The public/private distinction, the propagation rules, the public-only gateway check — all of it is grant machinery with exactly two hard-coded audiences. The redesign is not a new system. It is making the audience column first-class. <!-- id:sfAj17ZA -->

Almost every ingredient already exists in the code ([current state](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/current-state)): the signed statement kind (Capability, missing only a `READER` role next to `WRITER`/`AGENT`), the epoch counter (Ref's `generation` field, today unvalidated), the propagation engine (`blob_visibility_rules`), the materialized access table (`blob_visibility`), and three working signed-auth transports (bearer tokens, ephemeral peer capabilities, the agents service's signed action envelopes). The design below is mostly a promotion ceremony. <!-- id:-b1T0ydj -->

# One statement kind <!-- id:zWYhdE-B -->

A **Grant** is a signed IPLD blob: <!-- id:dvhLgAhj -->
  - **subject** — what is covered: a document (follows updates), a specific version (frozen DAG), or a path prefix (a subtree of a space). <!-- id:XcZVbcgw -->
  - **audience** — who may read: `everyone` | `space members` | a specific account key | a bearer secret hash. <!-- id:nlbxI58p -->
  - **epoch** — the space's auth-chain version this grant was issued under (see Ordering). <!-- id:htsxuWCf -->
  - **scope flags** — `history: true|false` (default false: forward-only from this epoch — see the redaction rabbit hole). <!-- id:3ByMkuir -->
  - **issuer + signature** — an account with authority over the subject, or a delegate holding a grant-issuing capability, chained exactly like today's WRITER capability delegation. <!-- id:MCb1KtkN -->

Everything the system does today and everything the proposal wanted is an instance: <!-- id:VZo2EgjK -->

<!-- id:46iIEK77 -->
| Today's concept <!-- col:SHWt6jbp --> | In the unified model <!-- col:RKQvtySP --> <!-- id:f1bKO-Ij --> |
| --- | --- |
| Publishing a public document | Grant(subject: doc, audience: everyone) — carried by the Ref's `visibility` field, as now <!-- id:1CTZnW_A --> |
| A private space document | Grant(subject: doc, audience: space-members) — replacing the read-requires-root-write-capability rule <!-- id:LZc9vlb1 --> |
| Sharing a doc with an outsider | Grant(subject: doc, audience: their-key) — **the new feature**, inexpressible today <!-- id:1DX7dw-p --> |
| "Anyone with the link" | Grant(subject: doc, audience: bearer-hash) — **the new feature** <!-- id:vbh7r83H --> |
| Unpublishing | ending the everyone-grant at an epoch — replacing today's monotone forever-public rows with epoch-scoped ones (forward-only semantics, honestly limited) <!-- id:jU7nZo5E --> |
| Raw file upload | an ownership claim: Grant(subject: cid, audience: issuer-only) — uploads stop being anonymous <!-- id:vP-DtKCm --> |
| WRITER/AGENT capabilities | unchanged — writing remains the existing Capability machinery; a grant is its read-side sibling, with the expiry and revocation fields Capability never got <!-- id:laAdoyA0 --> |

No envelope blob, no separate capability-for-reads type, no parallel policy channel. One kind, one verifier, one index. <!-- id:lofwmd09 -->

# Propagation: grants cover the owner's bundle <!-- id:7Hx3G1V_ -->

A grant on a document covers the blobs reachable from it through **owner-signed structure** — change deps, ref heads, embedded file blobs — evaluated by the existing `blob_visibility_rules` table, unchanged. It never follows a bare CID mention, never crosses an ownership boundary (an embed of someone else's doc renders only if the _viewer_ holds their own path to it), and it is evaluated at indexing time, not query time. <!-- id:GR2kaskZ -->

That last point is the whole performance story. `blob_visibility (blob, space)` generalizes to an access table `(blob, audience)`; every query surface — search, citations, feeds, listings, comments, sync, the blockstore itself — filters by joining that table against the caller's resolved audiences, exactly the shape of today's `publicOnly` filters. One evaluator at indexing time, dumb joins everywhere else. Public content takes the same fast path it takes today, with the same CDN-cacheable headers; the entire cost of the system lands on private reads only, preserving the asymmetry [prior art](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/prior-art) says to protect. <!-- id:hYjZQUdN -->

# Ordering: the auth chain <!-- id:OvF0lBDY -->

Each space maintains an **auth chain**: a linear, hash-linked sequence of signed auth events (grants, revocations, membership changes, delegations). The head of the chain defines the current **epoch**. Ref already carries a `generation` counter — today client-supplied and unvalidated; this design promotes it into the epoch and makes the indexer enforce it. <!-- id:DxWB-psu -->
  - Ordering is by chain position. Timestamps appear in blobs but carry zero security semantics — the resolution of the [time rabbit hole](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/rabbit-holes), and the fix for two live bugs: the alive-vs-deleted decision and the visibility register are both last-writer-wins on unvalidated Ref timestamps today. <!-- id:xASyQM-B -->
  - Revoking one grant = appending a revocation. Removing a member = bumping the epoch; standing grants to remaining members are re-materialized automatically; the removed member's access ends at the bump. <!-- id:kgO38h7U -->
  - A replica serving private content must hold the chain up to the epoch it enforces; how stale it may be is an explicit serving policy, not an accident. <!-- id:JZDTNKnz -->
  - What revocation means is stated plainly, in the spec and in UI copy: honest servers stop serving; bytes already replicated are retained by whoever has them. <!-- id:oENsR6OK -->

# The trust model, in the open <!-- id:HeojnnH_ -->

This is **trusted-server enforcement**. A grant constrains which principals your home server and its authorized replicas will serve — it is not cryptographic secrecy. Three design consequences keep it honest: <!-- id:Sj_Yzksd -->
  1. **Sync respects grants.** Private blobs replicate only to principals with an audience covering them (your other devices, space members' servers, gateways the space designates). The filtered-sync machinery exists — authenticated peers, filtered RBSR fingerprints, push allowlists — but it currently answers the access question with a different rule than HTTP does, and bitswap fails _open_ on blobs with no visibility rows while the blockstore fails _closed_. Unification means: one grant evaluator, both layers query it, both fail closed. <!-- id:4aYLOqXa -->
  2. **Uniform denial.** Unauthorized and nonexistent are byte-identical responses on every surface, closing the existence oracle (the `.dagjson` endpoint's "blob is not public" error message is today's counterexample). <!-- id:whZ5zGB4 -->
  3. **Enforcement is not opt-in.** Today every privacy gate is inert unless the operator sets `-public-only`, and a default desktop daemon serves all private content to any local caller. Grant evaluation becomes the only read path; the flag disappears. <!-- id:2CgiYgBW -->
  4. **The encryption slot.** A Grant may carry an optional wrapped content key. Nothing uses it in v1; its presence in the schema means Tahoe-style cryptographic privacy for high-sensitivity spaces is an additive layer later, not a redesign. <!-- id:3Nzw5mpa -->

# Comments, unified <!-- id:O3Hvg_uX -->

Comments were the proposal's loose thread, and the grant model ties it cleanly. Today a comment _snapshots_ the target document's visibility into its own signed blob at creation — and nothing ever reconciles it, so a doc flipping public→private leaves its old comments publicly listed, and private→public strands the discussion. The comment blob even resolves the target's visibility with a fail-open default to public. <!-- id:Fuq2Z27M -->

The fix: a comment is its own tiny document with its own author — the doc owner _cannot_ grant read on someone else's comment, and the commenter _shouldn't_ need per-reader grants. So **a comment's audience is declared at creation as a reference, not a value**: `target's-audience`, meaning "whoever can read the target, evaluated at read time." Comment visibility then tracks document visibility automatically: doc goes public, discussion goes public; outsider gets a doc grant, they see the discussion; a comment on a version-scoped share stays inside that share. A commenter who wants a narrower audience (a private note to the author) declares a narrower one — same statement kind, no special case. <!-- id:lRdw8X6a -->

# What v1 actually ships <!-- id:xaZt_ReE -->

Scope discipline from the [critique](hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb/permissions-system/critique): this is one feature — sharing — not a permissions platform. <!-- id:9AoIO-ye -->
  1. Grant blob kind + verification, with audience: `everyone` / `space` / `account-key` / `bearer` — subsuming the `READER` role that the Capability enum never got. <!-- id:cLMtmT9m -->
  2. Access table generalizing `blob_visibility`; `publicOnly` filters become audience joins; both HTTP and sync query the same evaluator and fail closed. <!-- id:RbGCZYgS -->
  3. Auth chain per space with epochs (promoted from Ref's `generation`); revocation, member removal, and unpublish defined against it; timestamps demoted to advisory everywhere. <!-- id:RJuj9V2h -->
  4. Share-a-doc and share-link flows in the clients, riding the existing bearer-token and signed-assertion auth transports. <!-- id:TdUpZZP2 -->
  5. Ownership claims required on raw uploads; index-time validation of visibility transitions (closing VULN-5's class for good). <!-- id:w9jzA3W7 -->

Explicitly deferred: nested groups, encryption layer, path-prefix grants beyond spaces, cross-space federation of audiences. <!-- id:rj_tbw7V -->

The test of the design is that the table above has no third column: nothing in the current system, and nothing in the sharing feature, needed a second concept. Public was never a different thing from private — just a grant with the widest possible audience. <!-- id:mZlZoorT -->

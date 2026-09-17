---
name: Everything Is a Grant
summary: The rebuilt design, in which one signed statement kind unifies public publishing, private spaces, document sharing, share links, and comments.
displayAuthor: Eric Vicenti
---
This is the reconstruction after the [shredding](./critique.md). It is built on one observation the original proposal missed: <!-- id:aZ8cP7IF -->

**The system already has a permissions model. It just doesn't know it.** <!-- id:QWVCleUL -->

Today a [blob](../../protocol/blobs.md) is public when `blob_visibility` holds `(blob, space=0)`, and space-visible when it holds `(blob, space=N)`. Read that table as what it actually is: a materialized set of _grants_. `space=0` is a grant to the audience "everyone". `space=N` is a grant to the audience "members of N". The public/private distinction, the propagation rules, and the public-only gateway check are all grant machinery with exactly two hard-coded audiences. The redesign builds no new system. It makes the audience column a real part of the model. <!-- id:sfAj17ZA -->

Almost every ingredient already exists in the code ([current state](./current-state.md)). The signed statement kind is [Capability](../../capability.md), missing only a `READER` role next to `WRITER`/`AGENT`. The epoch counter is the `generation` field of the [Ref](../../ref.md), unvalidated today. The propagation engine is `blob_visibility_rules`, and the materialized access table is `blob_visibility`. Three signed-auth transports already work: bearer tokens, ephemeral peer capabilities, and the agents service's signed action envelopes. The design below mostly promotes what is already there. <!-- id:-b1T0ydj -->

# One statement kind <!-- id:zWYhdE-B -->

A **Grant** is a signed IPLD blob: <!-- id:dvhLgAhj -->
  - **subject**: what is covered. A document (follows updates), a specific version (frozen DAG), or a path prefix (a subtree of a space). <!-- id:XcZVbcgw -->
  - **audience**: who may read. `everyone` | `space members` | a specific account key | a bearer secret hash. <!-- id:nlbxI58p -->
  - **epoch**: the space's auth-chain version this grant was issued under (see Ordering). <!-- id:htsxuWCf -->
  - **scope flags**: `history: true|false`. The default is false, forward-only from this epoch (see the redaction rabbit hole). <!-- id:3ByMkuir -->
  - **issuer + signature**: an account with authority over the subject, or a delegate holding a grant-issuing capability, chained exactly like today's WRITER capability delegation. <!-- id:MCb1KtkN -->

Everything the system does today and everything the proposal wanted is an instance: <!-- id:VZo2EgjK -->

<!-- id:46iIEK77 -->
| Today's concept <!-- col:SHWt6jbp --> | In the unified model <!-- col:RKQvtySP --> <!-- id:f1bKO-Ij --> |
| --- | --- |
| Publishing a public document | Grant(subject: doc, audience: everyone), carried by the Ref's `visibility` field, as now <!-- id:1CTZnW_A --> |
| A private space document | Grant(subject: doc, audience: space-members), replacing the read-requires-root-write-capability rule <!-- id:LZc9vlb1 --> |
| Sharing a doc with an outsider | Grant(subject: doc, audience: their-key). **The new feature**, inexpressible today <!-- id:1DX7dw-p --> |
| "Anyone with the link" | Grant(subject: doc, audience: bearer-hash). **The new feature** <!-- id:vbh7r83H --> |
| Unpublishing | Ending the everyone-grant at an epoch. Epoch-scoped rows replace today's monotone forever-public rows (forward-only semantics, honestly limited) <!-- id:jU7nZo5E --> |
| Raw file upload | An ownership claim: Grant(subject: cid, audience: issuer-only). Uploads stop being anonymous <!-- id:vP-DtKCm --> |
| WRITER/AGENT capabilities | Unchanged. Writing stays with the existing Capability machinery. A grant is its read-side sibling, with the expiry and revocation fields Capability never got <!-- id:laAdoyA0 --> |

No envelope blob, no separate capability-for-reads type, no parallel policy channel. One kind, one verifier, one index. <!-- id:lofwmd09 -->

# Propagation: grants cover the owner's bundle <!-- id:7Hx3G1V_ -->

A grant on a document covers the blobs reachable from it through **owner-signed structure**: change deps, ref heads, embedded file blobs. The existing `blob_visibility_rules` table evaluates this, unchanged. A grant never follows a bare CID mention. It never crosses an ownership boundary: an embed of someone else's doc renders only if the _viewer_ holds their own path to it. And it is evaluated at indexing time, never at query time. <!-- id:GR2kaskZ -->

That last point is the whole performance story. `blob_visibility (blob, space)` generalizes to an access table `(blob, audience)`. Every query surface (search, citations, feeds, listings, comments, sync, the blockstore itself) filters by joining that table against the caller's resolved audiences, exactly the shape of today's `publicOnly` filters. One evaluator runs at indexing time, and everything else is a dumb join. Public content takes the same fast path it takes today, with the same CDN-cacheable headers. The whole cost of the system lands on private reads only, which preserves the asymmetry that [prior art](./prior-art.md) says to protect. <!-- id:hYjZQUdN -->

# Ordering: the auth chain <!-- id:OvF0lBDY -->

Each space maintains an **auth chain**: a linear, hash-linked sequence of signed auth events (grants, revocations, membership changes, delegations). The head of the chain defines the current **epoch**. Ref already carries a `generation` counter, which is client-supplied and unvalidated today. This design promotes it into the epoch and makes the indexer enforce it. <!-- id:DxWB-psu -->
  - Ordering is by chain position. Timestamps appear in blobs but carry zero security meaning. This resolves the [time rabbit hole](./rabbit-holes.md) and fixes two live bugs: today the alive-vs-deleted decision and the visibility register are both last-writer-wins on unvalidated Ref timestamps. <!-- id:xASyQM-B -->
  - Revoking one grant means appending a revocation. Removing a member means bumping the epoch. Standing grants to the remaining members are re-materialized automatically, and the removed member's access ends at the bump. <!-- id:kgO38h7U -->
  - A replica serving private content must hold the chain up to the epoch it enforces. How stale it may be is an explicit serving policy, decided on purpose. <!-- id:JZDTNKnz -->
  - What revocation means is stated plainly, in the spec and in UI copy: honest servers stop serving, and whoever already has replicated bytes keeps them. <!-- id:oENsR6OK -->

# The trust model, in the open <!-- id:HeojnnH_ -->

This is **trusted-server enforcement**. A grant constrains which principals your home server and its authorized replicas will serve. It does not give cryptographic secrecy. These design consequences keep it honest: <!-- id:Sj_Yzksd -->
  1. **Sync respects grants.** Private blobs replicate only to principals with an audience that covers them: your other devices, space members' servers, and gateways the space designates. The filtered-sync machinery exists (authenticated peers, filtered RBSR fingerprints, push allowlists). But today it answers the access question with a different rule than HTTP does, and Bitswap fails _open_ on blobs with no visibility rows while the blockstore fails _closed_. Unification means one grant evaluator that both layers query, and both fail closed. See [Network](../../protocol/network.md). <!-- id:4aYLOqXa -->
  2. **Uniform denial.** Unauthorized and nonexistent are byte-identical responses on every surface, which closes the existence oracle. The `.dagjson` endpoint's "blob is not public" error message is today's counterexample. <!-- id:whZ5zGB4 -->
  3. **Enforcement is not opt-in.** Today every privacy gate is inert unless the operator sets `-public-only`, and a default desktop daemon serves all private content to any local caller. Grant evaluation becomes the only read path, and the flag disappears. <!-- id:2CgiYgBW -->
  4. **The encryption slot.** A Grant may carry an optional wrapped content key. Nothing uses it in v1. Because the schema has it, Tahoe-style cryptographic privacy for high-sensitivity spaces can come later as an added layer, without a redesign. <!-- id:3Nzw5mpa -->

# Comments, unified <!-- id:O3Hvg_uX -->

[Comments](../../protocol/comments.md) were the proposal's loose thread, and the grant model ties it off cleanly. Today a comment _copies_ the target document's visibility into its own signed blob at creation, and nothing ever reconciles it. A doc that flips from public to private leaves its old comments publicly listed, and a flip from private to public strands the discussion. The comment blob even resolves the target's visibility with a fail-open default to public. <!-- id:Fuq2Z27M -->

The fix starts from the fact that a comment is its own tiny document with its own author. The doc owner _cannot_ grant read on someone else's comment, and the commenter _shouldn't_ need per-reader grants. So **a comment declares its audience at creation as a reference to another audience**: `target's-audience`, meaning "whoever can read the target, evaluated at read time." Comment visibility then tracks document visibility automatically. When the doc goes public, the discussion goes public. When an outsider gets a doc grant, they see the discussion. A comment on a version-scoped share stays inside that share. A commenter who wants a narrower audience, such as a private note to the author, declares a narrower one, with the same statement kind and no special case. <!-- id:lRdw8X6a -->

# What v1 actually ships <!-- id:xaZt_ReE -->

Scope discipline from the [critique](./critique.md): this is one feature, sharing. It is not a permissions platform. <!-- id:9AoIO-ye -->
  1. Grant blob kind and verification, with audience `everyone` / `space` / `account-key` / `bearer`. This subsumes the `READER` role that the Capability enum never got. <!-- id:cLMtmT9m -->
  2. An access table generalizing `blob_visibility`. `publicOnly` filters become audience joins, and both HTTP and sync query the same evaluator and fail closed. <!-- id:RbGCZYgS -->
  3. An auth chain per space with epochs (promoted from Ref's `generation`). Revocation, member removal, and unpublish are defined against it, and timestamps are demoted to advisory everywhere. <!-- id:RJuj9V2h -->
  4. Share-a-doc and share-link flows in the clients, riding the existing bearer-token and signed-assertion auth transports. <!-- id:TdUpZZP2 -->
  5. Ownership claims required on raw uploads, and index-time validation of visibility transitions (closing VULN-5's class for good). <!-- id:w9jzA3W7 -->

Explicitly deferred: nested groups, the encryption layer, path-prefix grants beyond spaces, and cross-space federation of audiences. <!-- id:rj_tbw7V -->

The test of the design is that the table above has no third column. Nothing in the current system, and nothing in the sharing feature, needed a second concept. Public and private were always the same kind of thing: public is a grant with the widest possible audience. <!-- id:mZlZoorT -->

# See also

- [How Privacy Works Today](./current-state.md)
- [Tearing the Proposal Apart](./critique.md)
- [Permissions Rabbit Holes](./rabbit-holes.md)
- [Prior Art for Content Permissions](./prior-art.md)
- [Permissions](../../protocol/permissions.md), the model as it ships.
- [Where this is going](../../protocol/roadmap.md)

---
name: Tearing the Proposal Apart
summary: An adversarial review of the permissions proposal against the real codebase, sorting what is redundant, naive, misdiagnosed, and actually valuable.
displayAuthor: Eric Vicenti
---
This is the adversarial pass over the [original proposal](./v1-proposal.md). Each pillar is attacked as hard as possible against what the code [actually does today](./current-state.md), followed by a verdict on what survives. The [synthesis](./grants.md) rebuilds from the survivors. <!-- id:vx0drDLv -->

# Attack 1: The publish envelope already exists as the Ref <!-- id:COskipl2 -->

The proposal's first pillar reads: "the publish API must have a signature envelope where the CID of the new data gets signed by some account, with a timestamp and whether the content is public". That describes, field for field, a blob that has been in the system since the beginning, the [Ref](../../ref.md): <!-- id:OK4Jxj9m -->

<!-- id:5EIovwOC -->
| Proposed envelope field <!-- col:NFI9wW-j --> | Existing Ref field <!-- col:Qf33EPpa --> <!-- id:McUw5VMq --> |
| --- | --- |
| CID of the new data | `heads` (+ `genesisBlob`) <!-- id:22St8Ihk --> |
| signing account | `signer` + signature over canonical CBOR <!-- id:YZivPG8K --> |
| timestamp | `ts` <!-- id:uJC-nNO4 --> |
| is the content public | `visibility` <!-- id:ZFWPKCXo --> |
| (none) | plus `path`, `generation`, `redirect`, tombstone semantics for free <!-- id:rWGO0isF --> |

The Ref already plays exactly the envelope's role. [Changes](../../change.md) have no [visibility](../../protocol/privacy.md) of their own. They are born private and become public only when a public Ref reaches them through propagation. The Ref _is_ the sole publicness authority today. Proposing it as new shows that the actual design is under-documented. That is a real finding, but it is not a design contribution. A second envelope wrapping the same facts would create two sources of truth for visibility and two conflict-resolution registers to reconcile. <!-- id:efuNWghf -->

What is actually missing is narrower and more interesting: <!-- id:Qsg4jKBu -->
  1. **Raw uploads are unclaimed.** `POST /ipfs/file-upload` accepts anonymous, unsigned bytes. No signed statement covers them until a document links them. This is an _ownership_ gap, and the envelope has nothing to do with it: quotas, garbage collection, and abuse handling have nothing to attach to. <!-- id:8pXjeyWZ -->
  2. **The server doesn't defend the claims.** `CreateRef` hardcodes public visibility (open VULN-5). Nothing enforces "visibility set only at first publish". A modified client can flip any doc public on any publish. The envelope exists. The _validation rules_ around it are missing. <!-- id:TpglewB4 -->
  3. **Publicness is irreversible.** `blob_visibility` rows are only ever added. Once public, a blob is served forever, whatever later Refs say. The proposal's timestamp-ordered supersession gestures at fixing this, but see Attack 2. <!-- id:gscY0VQT -->

**Verdict: the pillar dissolves into three real work items**: claim raw uploads, validate visibility transitions at index time, and make un-publishing mean something at the blob layer. None of them is a new blob type. <!-- id:TNW1rmYs -->

# Attack 2: The timestamp is already a live vulnerability class <!-- id:dGQjTvhm -->

Signing a timestamp is free. _Believing_ one is not. No verifier can tell an honest timestamp from a backdated or future-dated one, so any semantics hung on `ts` hang on attacker-controlled input. <!-- id:Lya4jelD -->

In Seed this is not hypothetical. Security depends on it _right now_. A document is deleted iff `max(tombstone ref ts) > max(alive ref ts)`, and visibility is a last-writer-wins register keyed on Ref timestamp, with **zero** index-time validation. A writer can publish a Ref with a far-future timestamp and win the visibility register permanently. A compromised key can backdate around any future revocation scheme built on "later statement wins." The proposal would pour more security weight onto exactly this foundation. <!-- id:SOurtr_Z -->

The system already owns a trustworthy ordering primitive: causal position in the signed DAG. You cannot claim to precede a blob you reference. Ref even has an unvalidated `generation` counter waiting to be promoted into a real epoch. <!-- id:qBe_0hdS -->

**Verdict: invert the pillar.** Timestamps become advisory (display, tie-breaks). Everything with security meaning orders by DAG position or epoch: visibility transitions, revocation, supersession. Expiry, if used, checks the _enforcing server's_ clock. Details in [rabbit holes](./rabbit-holes.md). <!-- id:kSg7r61K -->

# Attack 3: "Read capabilities" without an enforcement story is a policy file <!-- id:1BkYfZBq -->

Here the proposal points at a real hole: there is **no read permission in the system**. Every private-read gate reuses the _write_ check (`canReadPrivate` literally calls `IsValidWriter`). It only honors **root-scoped** grants. [Capabilities](../../capability.md) have no expiry and no revocation. And the whole apparatus is inert unless the operator runs `-public-only`. On a default desktop [daemon](../../apps/daemon.md), every local caller reads everything (open issue #664). <!-- id:zrutu6pv -->

But the proposal doesn't say _against whom the caps defend_. Two different products hide in that gap: <!-- id:p0IhcN0q -->
  - **Trusted-server enforcement:** your home server and chosen gateways enforce grants at serve time. This defends against strangers. It does not defend against a malicious server operator or any peer that already synced the bytes. <!-- id:9RabgM6y -->
  - **Cryptographic enforcement (Tahoe-style):** content is encrypted and the cap carries the key. This defends against dishonest servers too, at the cost of server-side search, dedup, cheap re-sharing, and sane revocation ([prior art](./prior-art.md)). <!-- id:XjER7EkV -->

The proposal silently assumes the first while promising the second ("a versatile and simple privacy system"). Users get hurt in that gap: the UI says _private_ while the guarantee is only _polite_. The sync layer makes it worse. Private blobs already replicate to space peers and site servers, so every replica silently joins the trusted computing base. <!-- id:7Hz1na2h -->

**Verdict: survives once it is made honest.** A `READER` role is a natural, small extension of the existing Capability blob (the enum is literally `WRITER`/`AGENT` with an `EDITOR` TODO). But it must ship with an explicit trust-model statement in spec and UI, expiry and revocation semantics, path-scoped grants that actually work, sync limited to covered audiences, and a schema slot for a wrapped key so encryption can arrive later without a redesign. <!-- id:oYCCiVcc -->

# Attack 4: Transitive read is the best idea here, in the most dangerous phrasing <!-- id:PW1zE1zm -->

As phrased, "You can read a private blob if you're allowed to read a blob that links to it" is a machine for laundering access. Anyone who learns a CID can mint a blob linking to it and grant themselves passage. The idea worth saving underneath: a grant on a document covers the blobs _its owner bundled into it_, such as deps, heads and embedded files, because the grantor had authority over those. One word, _whose_ links, separates the vulnerability from the feature. <!-- id:t8HjeD0X -->

The safe version isn't even new. It is precisely how the four-row `blob_visibility_rules` table (Change→dep, Ref→head, _→DagPB, _→Raw) already propagates publicness and space visibility down owner-signed structure. The proposal reinvented the system's own indexing rule and removed the safety fence. <!-- id:d_NrbyEq -->

**Verdict: survives, renamed.** The rule becomes "grants cover the owner's bundle", in place of "linked blobs are readable". It is the existing rule table, generalized from two hard-coded audiences to arbitrary ones. The remaining sharp edges (history scope, embeds crossing ownership boundaries) are in [rabbit holes](./rabbit-holes.md). <!-- id:A4jAc2tW -->

# Attack 5: Does this provide much benefit? The honest accounting <!-- id:-elZZ7MN -->

Attack the premise. The system already has public and private documents, space-scoped visibility, member access through capabilities, filtered sync, and three working signed-auth transports. What can a user do after this project that they can't do today? <!-- id:oL2wvGiW -->
  1. **Share a private doc with a specific outside person.** Today this is literally inexpressible: the only way to grant read is to grant _root write on the entire space_. This is the headline feature, the Google Docs moment, and most of the user-visible value. <!-- id:qQhIdrCZ -->
  2. **Share links** ("anyone with this link"). These come nearly free from bearer-audience grants once (1) exists. <!-- id:_DHBM10L -->
  3. **Honest revocation and unpublish.** Today revocation doesn't exist and unpublish is impossible at the blob layer. Epoch machinery gives both a defined, if limited, meaning. <!-- id:ZapByp1Z -->
  4. **Coherent enforcement.** One rule replaces today's two contradictory capability checks, opposite fail-open and fail-closed defaults, and privacy that each deployment opts into. This is a debt payment the redesign forces, with no new feature for users. <!-- id:oMV5_vgb -->
  5. **Consistent multi-server policy.** Any authorized replica reaches identical access decisions from signed statements alone. This matters exactly as much as multi-server private hosting matters: little today, a lot for the architecture. <!-- id:54jUZS2h -->

The cost is the [query-surface perimeter](./rabbit-holes.md). Today's `publicOnly` boolean becomes per-caller audience evaluation across search, citations, feeds, listings, [comments](../../protocol/comments.md) and [sync](../../protocol/network.md): every surface, forever, including ones not written yet. The saving grace: if grants materialize into the access table at indexing time (the `blob_visibility` generalization), every surface keeps filtering by a dumb join, which is the shape the code already has. <!-- id:RFs2H0n9 -->

**Verdict: the benefit is real, but it is one feature plus one debt payment. It is not a platform.** If sharing with outsiders isn't worth building, none of this is. <!-- id:OnGHG1kH -->

# What survived the shredding <!-- id:zUIOpDDL -->

<!-- id:gyA9yut6 -->
- **Ownership claims for raw uploads**, **index-time validation of visibility transitions**, and **unpublish with defined semantics** (from Attack 1). <!-- id:xCYQTyZ5 -->
- **DAG or epoch ordering, with timestamps demoted to advisory**, which also fixes two live bugs (Attack 2). <!-- id:uQ2aHLma -->
- **A `READER` capability** with expiry, revocation, path scope, an explicit trusted-server model, and an encryption slot (Attack 3). <!-- id:c4XbcV3F -->
- **Grants cover the owner's bundle**: the existing propagation rules, generalized to audiences (Attack 4). <!-- id:geL4AzVf -->
- **Scope discipline: build the share feature**, and let multi-server consistency fall out of the architecture (Attack 5). <!-- id:TECbGiwP -->

The deepest thing the shredding exposed: the original proposal treated _public_ and _private_ as different systems that needed a bridge. The codebase quietly disagrees. `blob_visibility` already models publicness as "visible to space 0", which is a grant to everyone. The [synthesis](./grants.md) rebuilds everything on that one move. <!-- id:rStMwgRX -->

# See also

- [How Privacy Works Today](./current-state.md)
- [Permissions Rabbit Holes](./rabbit-holes.md)
- [Everything Is a Grant](./grants.md)
- [V1 Proposal (Archived)](./v1-proposal.md)
- [Permissions](../../protocol/permissions.md), the model as it ships.
- [Privacy](../../protocol/privacy.md)

---
name: Tearing the Proposal Apart
summary: An adversarial review of the permissions proposal against the real codebase - what's redundant, what's naive, what's misdiagnosed, and what's actually valuable.
displayAuthor: Eric Vicenti
---
This is the adversarial pass over the [original proposal](./permissions-system-v1-proposal.md): each pillar attacked as hard as possible against what the code [actually does today](./permissions-system-current-state.md), then a verdict on what survives. The [synthesis](./permissions-system-grants.md) rebuilds from the survivors. <!-- id:vx0drDLv -->

# Attack 1: The publish envelope already exists — it's called a Ref <!-- id:COskipl2 -->

The proposal's first pillar — "the publish API must have a signature envelope where the CID of the new data gets signed by some account, with a timestamp and whether the content is public" — describes, field for field, a blob that has been in the system since the beginning: <!-- id:OK4Jxj9m -->

<!-- id:5EIovwOC -->
| Proposed envelope field <!-- col:NFI9wW-j --> | Existing Ref field <!-- col:Qf33EPpa --> <!-- id:McUw5VMq --> |
| --- | --- |
| CID of the new data | `heads` (+ `genesisBlob`) <!-- id:22St8Ihk --> |
| signing account | `signer` + signature over canonical CBOR <!-- id:YZivPG8K --> |
| timestamp | `ts` <!-- id:uJC-nNO4 --> |
| is the content public | `visibility` <!-- id:ZFWPKCXo --> |
| — | plus `path`, `generation`, `redirect`, tombstone semantics for free <!-- id:rWGO0isF --> |

And the Ref isn't just _similar_ to the envelope — it already plays exactly the envelope's role: Changes have no visibility of their own; they're born private and become public only when a public Ref reaches them through propagation. The Ref _is_ the sole publicness authority today. Proposing it as new means the actual design is under-documented, which is a real finding — but not a design contribution. A second envelope wrapping the same facts would create two sources of truth for visibility and two conflict-resolution registers to reconcile. <!-- id:efuNWghf -->

What's _genuinely_ missing is narrower and more interesting: <!-- id:Qsg4jKBu -->
  1. **Raw uploads are unclaimed.** `POST /ipfs/file-upload` accepts anonymous, unsigned bytes; no signed statement covers them until a document links them. Not an envelope gap — an _ownership_ gap: quotas, garbage collection, and abuse handling have nothing to attach to. <!-- id:8pXjeyWZ -->
  2. **The server doesn't defend the claims.** `CreateRef` hardcodes public visibility (open VULN-5); nothing enforces "visibility set only at first publish"; a modified client can flip any doc public on any publish. The envelope exists; the _validation rules_ around it are missing. <!-- id:TpglewB4 -->
  3. **Publicness is irreversible.** `blob_visibility` rows are only ever added. Once public, a blob is served forever regardless of later Refs. The proposal's timestamp-ordered supersession gestures at fixing this, but see Attack 2. <!-- id:gscY0VQT -->

**Verdict: the pillar dissolves into three real work items** — claim raw uploads, validate visibility transitions at index time, make un-publishing mean something at the blob layer. None of them is a new blob type. <!-- id:TNW1rmYs -->

# Attack 2: The timestamp isn't just weak — it's already a live vulnerability class <!-- id:dGQjTvhm -->

Signing a timestamp is free. _Believing_ one is not. No verifier can distinguish an honest timestamp from a backdated or future-dated one, so any semantics hung on `ts` are hung on attacker-controlled input. <!-- id:Lya4jelD -->

This isn't hypothetical in Seed — it's load-bearing _right now_: a document is deleted iff `max(tombstone ref ts) > max(alive ref ts)`, and visibility is a last-writer-wins register keyed on Ref timestamp, with **zero** index-time validation. A writer can publish a Ref with a far-future timestamp and win the visibility register permanently; a compromised key can backdate around any future revocation scheme built on "later statement wins." The proposal would pour more security weight onto exactly this foundation. <!-- id:SOurtr_Z -->

The system already owns a trustworthy ordering primitive: causal position in the signed DAG. You cannot claim to precede a blob you reference. Ref even has an unvalidated `generation` counter waiting to be promoted into a real epoch. <!-- id:qBe_0hdS -->

**Verdict: invert the pillar.** Timestamps become advisory (display, tie-breaks); everything with security meaning — visibility transitions, revocation, supersession — orders by DAG position/epoch. Expiry, if used, checks the _enforcing server's_ clock. Details in [rabbit holes](./permissions-system-rabbit-holes.md). <!-- id:kSg7r61K -->

# Attack 3: "Read capabilities" without an enforcement story is a policy file <!-- id:1BkYfZBq -->

Here the proposal points at a real hole — there is **no read permission in the system**. Every private-read gate reuses the _write_ check (`canReadPrivate` literally calls `IsValidWriter`), it only honors **root-scoped** grants, capabilities have no expiry and no revocation, and the whole apparatus is inert unless the operator runs `-public-only` — on a default desktop daemon every local caller reads everything (open issue #664). <!-- id:zrutu6pv -->

But the proposal doesn't say _against whom the caps defend_. Two different products hide in that ambiguity: <!-- id:p0IhcN0q -->
  - **Trusted-server enforcement:** your home server and chosen gateways enforce grants at serve time. Defends against strangers. Does not defend against a malicious server operator or any peer that already synced the bytes. <!-- id:9RabgM6y -->
  - **Cryptographic enforcement (Tahoe-style):** content encrypted, cap carries the key. Defends against dishonest servers too — at the cost of server-side search, dedup, cheap re-sharing, and sane revocation ([prior art](./permissions-system-prior-art.md)). <!-- id:XjER7EkV -->

The proposal silently assumes the first while marketing the second ("a versatile and simple privacy system"). That gap is where users get hurt: UI that says _private_ while the guarantee is _polite_. And the sync layer sharpens it — private blobs already replicate to space peers and site servers, so every replica silently joins the trusted computing base. <!-- id:7Hz1na2h -->

**Verdict: survives with its honesty restored.** A `READER` role is a natural, small extension of the existing Capability blob (the enum is literally `WRITER`/`AGENT` with an `EDITOR` TODO). But it must ship with: an explicit trust-model statement in spec and UI, expiry and revocation semantics, path-scoped grants that actually work, sync constrained to covered audiences, and a schema slot for a wrapped key so encryption can arrive later without a redesign. <!-- id:oYCCiVcc -->

# Attack 4: Transitive read is the best idea here — wearing the most dangerous phrasing <!-- id:PW1zE1zm -->

"You can read a private blob if you're allowed to read a blob that links to it" — as phrased, an access-laundering machine: anyone who learns a CID can mint a blob linking to it and grant themselves passage. The salvageable idea underneath: a grant on a document covers the blobs _its owner bundled into it_ — deps, heads, embedded files — because the grantor had authority over those. One word — _whose_ links — separates the vulnerability from the feature. <!-- id:t8HjeD0X -->

And the safe version isn't even new: it is precisely how the four-row `blob_visibility_rules` table (Change→dep, Ref→head, _→DagPB, _→Raw) already propagates publicness and space visibility down owner-signed structure. The proposal reinvented the system's own indexing rule, this time with the safety fence removed. <!-- id:d_NrbyEq -->

**Verdict: survives, renamed.** Not "linked blobs are readable" but "grants cover the owner's bundle" — the existing rule table, generalized from two hard-coded audiences to arbitrary ones. The remaining sharp edges (history scope, embeds crossing ownership boundaries) are in [rabbit holes](./permissions-system-rabbit-holes.md). <!-- id:A4jAc2tW -->

# Attack 5: Does this provide much benefit? The honest accounting <!-- id:-elZZ7MN -->

Attack the premise: the system already has public/private documents, space-scoped visibility, member access via capabilities, filtered sync, and three working signed-auth transports. What can a user do after this project that they can't today? <!-- id:oL2wvGiW -->
  1. **Share a private doc with a specific outside person.** Today literally inexpressible — the only way to grant read is to grant _root write on the entire space_. This is the headline feature, the Google-Docs moment, and most of the user-visible value. <!-- id:qQhIdrCZ -->
  2. **Share links** ("anyone with this link"). Falls out of bearer-audience grants nearly free once (1) exists. <!-- id:_DHBM10L -->
  3. **Honest revocation and unpublish.** Today revocation doesn't exist and unpublish is impossible at the blob layer. Epoch machinery gives both defined (if limited) meaning. <!-- id:ZapByp1Z -->
  4. **Coherent enforcement.** One rule instead of today's two contradictory capability checks, opposite fail-open/fail-closed defaults, and opt-in-per-deployment privacy. Not a feature — a debt payment the redesign forces. <!-- id:oMV5_vgb -->
  5. **Consistent multi-server policy** — any authorized replica reaches identical access decisions from signed statements alone. Matters exactly as much as multi-server private hosting matters: currently little, architecturally a lot. <!-- id:54jUZS2h -->

The cost: the [query-surface perimeter](./permissions-system-rabbit-holes.md). Today's `publicOnly` boolean becomes per-caller audience evaluation across search, citations, feeds, listings, comments, sync — every surface, forever, including ones not written yet. The saving grace: if grants materialize into the access table at indexing time (the `blob_visibility` generalization), every surface keeps filtering by a dumb join, which is the shape the code already has. <!-- id:RFs2H0n9 -->

**Verdict: the benefit is real but it is one feature plus one debt payment, not a platform.** If sharing-with-outsiders isn't worth building, none of this is. <!-- id:OnGHG1kH -->

# What survived the shredding <!-- id:zUIOpDDL -->

<!-- id:gyA9yut6 -->
- **Ownership claims for raw uploads**; **index-time validation of visibility transitions**; **unpublish with defined semantics** (Attack 1's rubble). <!-- id:xCYQTyZ5 -->
- **DAG/epoch ordering; timestamps demoted to advisory** — also fixing two live bugs (Attack 2). <!-- id:uQ2aHLma -->
- **A `READER` capability** with expiry, revocation, path scope, an explicit trusted-server model, and an encryption slot (Attack 3). <!-- id:c4XbcV3F -->
- **Grants cover the owner's bundle** — the existing propagation rules, generalized to audiences (Attack 4). <!-- id:geL4AzVf -->
- **Scope discipline: build the share feature**, let multi-server consistency fall out of the architecture (Attack 5). <!-- id:TECbGiwP -->

The deepest thing the shredding exposed: the original proposal treated _public_ and _private_ as different systems needing a bridge, when the codebase quietly disagrees — `blob_visibility` already models publicness as "visible to space 0," i.e. a grant to everyone. The [synthesis](./permissions-system-grants.md) rebuilds everything on that one move. <!-- id:rStMwgRX -->

---
name: Permissions System
summary: A serious attempt at a permissions redesign, covering the original idea, its adversarial review against the real codebase, and the rebuilt design where everything is a grant.
displayAuthor: Eric Vicenti
---
This is a design investigation into a permissions and privacy system for Hypermedia content on IPFS. It began as a proposal with three pillars: signed publish envelopes, read capabilities, and link-transitive access. That proposal was then torn apart against the actual codebase and prior art, and rebuilt into something smaller and stronger. <!-- id:mwdSU03M -->

# The verdict <!-- id:uPvgEtXA -->

**The original proposal was one-third redundant, one-third dangerous, and one-third right.** The "signed publish envelope" already exists. The [Ref](../ref.md) blob carries CID, signer, timestamp, and [visibility](../protocol/privacy.md), and it is already the sole authority on publicness. What is missing is validation around it, and another envelope would not add that. Timestamp-ordered semantics would be built on attacker-controlled input that is _already_ the system's live weak point: deletion and visibility are both last-writer-wins on unvalidated timestamps. But read [capabilities](../protocol/permissions.md) fill a real hole. Today the only way to let someone read a private doc is to grant them root write on the whole [space](../protocol/documents.md). And link-transitive access, once restricted to _owner-signed_ structure, is exactly the propagation rule the indexer already runs. <!-- id:EZ9ettDl -->

The rebuild rests on one observation: **the system already has a permissions model that doesn't know it.** The `blob_visibility` table's `space = 0` rows are grants to the audience "everyone". Its `space = N` rows are grants to "members of N". Public and private are the same kind of thing: public is a grant with the widest audience. Making the audience column a real part of the model unifies public publishing, private spaces, document sharing, share links, and [comments](../protocol/comments.md) under a single signed statement kind, and almost every ingredient is already in the code. <!-- id:05Ug_JK4 -->

# Reading order <!-- id:MaQz0lAs -->

1. **[How Privacy Works Today](./permissions/current-state.md)** maps what exists: the signed blob kinds, the visibility table and its four propagation rules, read-as-write access checks, filtered sync, and the eight cracks (irreversible publicness, hardcoded-public `CreateRef`, opt-in enforcement, and more). Start here. Everything else argues against this baseline. <!-- id:3YG-2Jdv -->
2. **[Tearing the Proposal Apart](./permissions/critique.md)** makes five attacks on the original pillars, each ending in a verdict. It includes a frank count of the benefit: one feature (sharing with outsiders) plus one debt payment (coherent enforcement). That is not a platform. <!-- id:quSoTmEL -->
3. **[Permissions Rabbit Holes](./permissions/rabbit-holes.md)** ranks the six tar pits (revocation, time, transitive access, history, groups, the query-surface perimeter) by depth, each with its practical escape. The theme: never "solve it", always "choose honest semantics that don't require solving it." <!-- id:NHeUVEWl -->
4. **[Prior Art for Content Permissions](./permissions/prior-art.md)** covers what UCAN, Tahoe-LAFS, macaroons/Biscuit, Scuttlebutt, Matrix, and object-capability systems each learned the hard way, and the one asymmetry none of them had that we get to exploit. <!-- id:CnCMfRFA -->
5. **[Everything Is a Grant](./permissions/grants.md)** is the rebuilt design: one Grant statement kind with explicit audiences, propagation over owner-signed structure, an epoch-based auth chain in place of timestamp ordering, comments unified by audience reference, an explicit trusted-server model with an encryption slot, and a deliberately small v1. <!-- id:wB1RUGmk -->
6. **[The V1 Proposal (Archived)](./permissions/v1-proposal.md)** is the original document, kept as the subject of the critique. <!-- id:PCkQJpwI -->

# The three decisions that matter <!-- id:5Tw-zVZS -->

If you read nothing else, read these. Every other part of the design rests on them, and the docs above argue each one: <!-- id:QXbl6G3r -->
  - **Ordering by DAG position, never by timestamp.** Grants, revocations, visibility changes, and deletions order by epoch in a signed auth chain, which promotes the existing `generation` field of the [Ref](../ref.md). Timestamps become advisory. This one choice resolves the revocation, time, and membership rabbit holes, and it fixes two live bugs. <!-- id:tf2bQdEW -->
  - **Grants cover the owner's bundle.** Access propagates only through owner-signed structure (the existing rule table), never through bare CID mentions. A one-sentence fence separates the system's most elegant rule from a machine for laundering access. <!-- id:7Pqxzyo2 -->
  - **Trusted-server enforcement, stated honestly.** Grants constrain what honest servers serve. They do not give cryptographic secrecy, and the UI must say so. The Grant schema carries an unused wrapped-key slot, so encryption can arrive later as a layer without a redesign. <!-- id:KG4RF43g -->

# See also

- [Permissions](../protocol/permissions.md), the model as it ships.
- [Privacy](../protocol/privacy.md), private documents and visibility today.
- [Capability](../capability.md), the signed grant blob.
- [Where this is going](../protocol/roadmap.md), where these questions carry forward.
- [History](../history.md), the other dated design records.

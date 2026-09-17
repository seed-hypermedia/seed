---
name: V1 Proposal (Archived)
summary: The original permissions proposal, kept as the subject of the critique and superseded by the grants synthesis.
displayAuthor: Eric Vicenti
---
\> Archived: this is the original proposal, kept so the [critique](./critique.md) has a stable subject. Its argument is unchanged, and only punctuation and phrasing were edited for style. The current design is [Everything Is a Grant](./grants.md). <!-- id:jcsxNu8e -->

This is a design proposal for a new permissions system for Hypermedia content stored on IPFS. The goal is a **versatile and simple privacy layer** on top of a content-addressed [blob](../../protocol/blobs.md) store. Every blob is identified by its CID, and the permissions system decides who may read each blob from a given server. <!-- id:-RfdW_xt -->

# Motivation <!-- id:MAhjVeZv -->

Today the [daemon](../../apps/daemon.md) has a binary [visibility](../../protocol/privacy.md) model: a blob either has a `blob_visibility` row with `space = 0` (public) or it does not (private). Visibility is propagated from structural blobs (Refs, Changes) down to the raw file blobs they link to, and a gateway running in public-only mode refuses to serve anything that isn't marked public. This works, but it has limits: <!-- id:oJMyDbXP -->
  - Publishing does not carry an explicit, verifiable statement of _intent_. The server infers publicness from indexing rules, with no signed claim from the author. <!-- id:Gvb8S5zE -->
  - There is no way to grant _read_ access to private content. [Capabilities](../../protocol/permissions.md) today (WRITER, AGENT) decide who may write into a space. Nothing decides who may read from it. <!-- id:ILtsNmi3 -->
  - Access decisions are server-local policy, and they cannot travel with the data. A peer that replicates blobs cannot verify what the author intended. <!-- id:pVzLvivj -->

# Design Overview <!-- id:XsrDfF0b -->

The system has three pillars: <!-- id:i1a0KqMj -->
  1. **Signed publish envelopes**: every publish is a signed statement about a CID, its timestamp, and its intended visibility. <!-- id:8sMKZre9 -->
  2. **Read capabilities**: delegable grants that allow an account (or key) to read specific content. <!-- id:p5gl6M9v -->
  3. **Link-based access propagation**: access to a blob extends to the blobs it links to, following the same DAG structure that visibility propagation uses today. <!-- id:iNsnTcLB -->

## 1. The Publish Envelope <!-- id:c0Kk-Klt -->

The publish API must require a **signature envelope** wrapping every submitted blob or blob batch. The envelope is itself a small IPLD blob: <!-- id:WviC-CtE -->
  - **cid**: the CID of the new data being published (for a batch, the root CID). <!-- id:32aghok2 -->
  - **signer**: the account (or a device key delegated by the account) making the claim. <!-- id:DZQMRpKJ -->
  - **timestamp**: when the publish happened. Gives ordering and enables later revocation/supersession semantics. <!-- id:MMYG9Rg6 -->
  - **visibility**: an explicit claim: `public` or `private` (optionally scoped to a space). <!-- id:jeaE_oJW -->
  - **signature**: over all of the above. <!-- id:TqP7rXcI -->

Properties this buys us: <!-- id:mROePplr -->
  - The server no longer _infers_ publicness. It verifies a signed claim. A public-only gateway serves a blob if and only if it can produce a valid envelope marking it public (directly or via propagation, below). <!-- id:K0IRr4fD -->
  - Envelopes are portable. Any replica can verify them offline. Publicness travels with the data, and no longer lives in one server's SQLite tables. <!-- id:3srUQe_Z -->
  - The timestamp makes claims orderable: a later envelope from the same signer can change visibility (for example, unpublish), and replicas can converge on the latest claim. <!-- id:ktKYk5nk -->

Open question: is the envelope a new blob kind, or an extension of the existing [Ref](../../ref.md) blob? Refs already sign a head CID and are the natural place for a visibility claim. A separate envelope kind would also cover non-document blobs (raw files pushed via the IPFS endpoints) that have no Ref. <!-- id:O6er6C6J -->

## 2. Read Capabilities <!-- id:mkcG4ccZ -->

Today capabilities delegate _write_ roles (WRITER, AGENT) on a space. We extend the same machinery with **read capabilities**: <!-- id:kKWxtytn -->
  - A read cap is a signed blob: _grantor_ (an account with authority over the content), _grantee_ (an account or public key), _subject_ (a CID, a document ID, or a space/path prefix), and optional constraints (expiry, no-redelegation). <!-- id:h2wasVqI -->
  - Presenting a valid read cap chain to a server authorizes serving the private blob(s) the cap covers. The existing authenticated-caller path in the blockstore (which already allows a caller with access to bypass public-only denial) becomes the enforcement point. <!-- id:HhCbx2jQ -->
  - Caps are delegable by default: a grantee can re-delegate a narrower cap, forming a chain back to the content owner. This is the same chain resolution the CLI already does for WRITER/AGENT caps when publishing into a shared space. <!-- id:Fn02mYmB -->
  - Revocation follows the envelope timestamp model: a later signed statement by the grantor invalidates a cap. Servers enforce revocation at serve time. This is a policy layer with no cryptographic deletion: anyone who already fetched the bytes has them. <!-- id:zHcrLMKF -->

## 3. Access Propagation Through Links <!-- id:mQI_A-N_ -->

The rule: **if you are allowed to read a blob, you are allowed to read the blobs it links to**, following the DAG downward through the same kinds of rules that drive visibility propagation today (`Change → dep`, `Ref → head`, `anything → DagPB/Raw`). <!-- id:zDZEV0W0 -->

Rationale: a document is a DAG of many blobs: the Ref, the [Changes](../../change.md), and the file and image blobs its content embeds. A read cap on "the document" must be usable without enumerating every constituent CID, and must keep working as the document changes. Granting on the root and propagating down mirrors how publicness already flows. <!-- id:htoAaTzA -->

This is the part marked "I think??", and it deserves scrutiny: <!-- id:lwzOfSEU -->
  - **Direction matters.** Propagation must be strictly downward (from the granted root into its dependencies), never upward or sideways. Being able to read a Change must not reveal _other_ documents that happen to link to the same shared file blob. <!-- id:jlgBVy7V -->
  - **Shared blobs are fine.** A raw file linked from both a public doc and a private doc is readable via the public path. That reveals nothing about the private doc's existence. Content-addressing already implies this: possession of a CID plus an authorized path to it is the access criterion. <!-- id:6wQGwn9R -->
  - **Rule-scoped.** Propagation should follow the declared `blob_visibility_rules`-style patterns and ignore arbitrary IPLD links, so a maliciously crafted blob can't smuggle a link to someone else's private content and "launder" access to it. Propagation is evaluated against the _owner's_ DAG: a cap on document D grants the blobs reachable from D's own version history, as signed by D's authors. It does not grant blobs that are merely referenced by CID from anywhere. <!-- id:u6UGc8jW -->
  - **Snapshot or living grant.** A cap on a document ID follows new versions as they are published (read access to the document). A cap on a specific version CID grants only that frozen DAG. Both are useful; the subject field distinguishes them. <!-- id:Ub442R0m -->

# How the Pieces Fit <!-- id:cu0plqo6 -->

- **Publish**: client builds blobs, signs an envelope (CID + timestamp + visibility), submits both. The server verifies the signature before accepting, and indexes visibility from the _claim_ instead of inferring it. <!-- id:WgtJgso_ -->
- **Public read**: unchanged fast path: gateway serves blobs whose envelope (or propagated envelope) says public, with public cache headers. <!-- id:DfLw6UVt -->
- **Private read**: caller authenticates (existing signed-request mechanism), presents or references a read cap chain. The server validates chain + revocations, then serves with private cache headers. <!-- id:B6rsBtQi -->
- **Replication**: peers exchange envelopes and caps alongside blobs. Every replica can enforce the same policy without trusting the origin server's database. <!-- id:ddrokBts -->

# Principles <!-- id:BGehWwKc -->

- **Simple core:** one envelope kind, one cap kind, one downward propagation rule. Everything else is composition. <!-- id:FAQbO2lA -->
- **Verifiable as well as enforced:** every access decision traces to signed statements, so any peer can make the same decision. <!-- id:7qGsj6Vf -->
- **Honest about limits:** this controls what servers _serve_. It cannot control what past readers _retain_. Privacy of never-shared content is absolute (blobs unreferenced by any envelope are served to no one). Revocation is best-effort by design. <!-- id:ZcpNECAg -->

# Open Questions <!-- id:OYKQQb4G -->

- Envelope as extended Ref, or a new blob kind (covers raw IPFS uploads with no Ref). <!-- id:fWSxe8yT -->
- Cap subject granularity: CID, document ID, or path prefix. Support all three, or start with document ID only? <!-- id:YKVkPwKY -->
- How does the upload flow change? Today `POST /ipfs/file-upload` stores blobs that are private-by-default with no signed statement at all. Should uploads require an envelope up front, or remain unclaimed until a document references them? <!-- id:htoEdUkc -->
- Group or space-level read caps: grant to "all members of space X" instead of individual keys. Likely needed for team sites, but requires membership to be resolvable at serve time. <!-- id:rKQNv-_K -->
- Anonymous share links: a read cap granted to a bearer secret instead of a key, for "anyone with the link" sharing. <!-- id:h-PTCMUt -->

# See also

- [Tearing the Proposal Apart](./critique.md)
- [Everything Is a Grant](./grants.md)
- [How Privacy Works Today](./current-state.md)
- [Permissions System](../permissions.md)

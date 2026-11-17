---
name: Permissions
summary: Who may write into a space is decided by signed capability blobs that the space owner issues, checked by every node when it indexes a Ref, and this page gives the exact rule, the two roles, the one-hop delegation limit, and what trust exists beyond grants.
---
A space belongs to one [key](./identity.md), and by default only that key can publish into it. To let someone else write, the owner signs a small statement, a capability, that names the other key, a role, and optionally a path. Every node that sees a [document](./documents.md) update checks it against the capabilities it knows about. So every node enforces the rule, and no single server decides. <!-- id:DnxwjiQ_ -->

This page gives the details: what a capability contains, what the two roles allow, how path scope and delegation chains work, and what happens to an update that arrives without authority. <!-- id:ApsTvllH -->

# How it works <!-- id:gDef31y0 -->

## Capabilities are certificates <!-- id:yyUbSZDM -->

In object capabilities, authority is possession of a reference. This system spans processes and machines, so it uses signed certificates instead. They belong to the family of [UCAN](https://ucan.xyz/), [SPKI/SDSI](https://datatracker.ietf.org/doc/html/rfc2693) and ZCAP-LD, but are simpler and scoped to Hypermedia's needs. Each certificate says: this identity may do X on resource Y. The "do X" part is a coarse role. There is no list of fine-grained permissions. <!-- id:MLCGcKMx -->

Three words keep the terms straight: <!-- id:VUaeKp5I -->
  - a **permission** is the ability to do something; <!-- id:oqay6cEg -->
  - a **[capability](../capability.md)** is the signed thing that grants permissions; <!-- id:NWPj_99q -->
  - a **[role](../role.md)** is what kind of capability it is, and therefore which permissions it grants. <!-- id:O3kKDKM2 -->

A capability is a signed [blob](./blobs.md) like every other Hypermedia record. The `signer` is both the issuer and the [space](./spaces.md) being shared. There is no separate `issuer` field on the wire. <!-- id:po5pX8Bo -->

A capability names a `delegate`, a `role`, an optional `path` and an optional `label`. The [capability](../capability.md) type page is the reference for the fields.

Shown as DAG-JSON, a grant from Alice to Bob for everything under `/team`: <!-- id:SRkTwbrd -->

```json <!-- id:HGLeSjtd -->
{
  "type": "Capability",
  "signer": {"/": {"bytes": "7QEh…alice"}},
  "delegate": {"/": {"bytes": "7QEh…bob"}},
  "role": "WRITER",
  "path": "/team",
  "label": "Team writers",
  "ts": 1757977200000,
  "sig": {"/": {"bytes": "…"}}
}
```

There is no expiry field and no revocation record. Once published, a capability is valid forever on every node that has it. The `label` is public and immutable, so do not put private notes in it. <!-- id:H_WO1T-H -->

Because nothing revokes a grant, grant narrowly: WRITER on a path, to a key you control. Treat a lost delegate key as permanent.

## Who may issue <!-- id:faqCcqWM -->

Only the space owner's key can sign a capability for that space. The daemon refuses to build one otherwise, and the `CreateCapability` RPC returns permission denied. So a writer cannot issue a WRITER grant in someone else's space. The one exception is the AGENT chain described below: any delegate can pass its authority one more hop by making another key its AGENT. <!-- id:U3BdbO1o -->

## The two roles <!-- id:rM5UCVUd -->

**WRITER** may publish [Refs](../ref.md), the blobs that set a document's current [version](./documents.md), at the capability's path and at every path beneath it. That includes creating documents, forking, moving, deleting and redirecting under the scope. A WRITER scoped to the space root also counts as a collaborator for reading private content over HTTP. A WRITER scoped to a sub-path does not. Private [peer sync](./network.md) works the other way round: a WRITER at any path receives the whole space's private blobs. [Privacy](./privacy.md) discusses both asymmetries. <!-- id:EUqg3D6C -->

**AGENT** is full delegation of the issuer's key. It must have an empty path, and the indexer rejects an AGENT capability with a path. An AGENT may do everything the issuer can do in the issuer's own space. It may sign the issuer's [profile](../profile.md) and publish an alias profile pointing at the issuer. It inherits the issuer's direct grants in other spaces for one hop. This role links devices and browser sessions to an account, so the name is unrelated to AI agents. [Seed Agents](../agent.md) also use this role when an account lets an agent act for it. <!-- id:jHa_qoWo -->

Only `WRITER` and `AGENT` exist in the network. There is no editor role and no read-only role, so the roles cannot express read grants, share links or invitations. Owner, Admin, Follower, Member and Subscriber are not capability roles. <!-- id:8ZcoKlsh -->

## Path scope <!-- id:Td0aihIG -->

Scope is by path segment, always recursive. A capability at `/team` covers `/team`, `/team/notes` and `/team/notes/2026`. It does not cover `/teammates`, because matching splits on `/`. The `no_recursive` request flag and the `is_exact` response field exist in the API but do nothing. The daemon rejects `no_recursive` and always reports `is_exact` as false. <!-- id:YTKYFw57 -->

## The authorization rule <!-- id:JxRtSA4- -->

A node decides authorization when it indexes a Ref. The indexer asks "may the key that signed this Ref write at [`hm://<space>/<path>`](./urls.md)?". It answers with two lookups over the capabilities it has stored. <!-- id:1EHgGLy2 -->
  1. If the signer is the space owner, yes. <!-- id:fK73npYt -->
  2. Compute the breadcrumbs of the target: `hm://A/x/y` gives `[hm://A, hm://A/x, hm://A/x/y]`. <!-- id:Z1htJJtY -->
  3. **Direct grant.** Is there a capability signed by the owner, delegating to the signer, with role WRITER or AGENT, whose resource is one of the breadcrumbs? If so, yes. <!-- id:4vXZT6MC -->
  4. **One-hop agent.** Is there an AGENT capability delegating to the signer whose issuer is either the owner, or a key that itself holds a direct WRITER or AGENT grant from the owner on one of the breadcrumbs? If so, yes. <!-- id:UaamB9AE -->
  5. Otherwise, no. <!-- id:BdCoPBm9 -->

Those two lookups are the queries the daemon runs, with the positional parameters renamed for reading. The direct grant: <!-- id:Q8HD0tE_ -->

```sql <!-- id:NjBnINnE -->
SELECT 1 FROM structural_blobs direct
WHERE direct.type = 'Capability'
  AND direct.author = :owner
  AND direct.extra_attrs->>'del' = :writer
  AND direct.extra_attrs->>'role' IN ('WRITER', 'AGENT')
  AND direct.resource IN (SELECT r.id FROM resources r
                          JOIN json_each(:breadcrumbs) each ON each.value = r.iri)
```

The one-hop agent rule: <!-- id:iLOhm0kG -->

```sql <!-- id:8wNxvPsk -->
SELECT 1 FROM structural_blobs agent
WHERE agent.type = 'Capability'
  AND agent.extra_attrs->>'del' = :writer
  AND agent.extra_attrs->>'role' = 'AGENT'
  AND (agent.author = :owner
       OR EXISTS (SELECT 1 FROM structural_blobs parent_writer
                  WHERE parent_writer.type = 'Capability'
                    AND parent_writer.author = :owner
                    AND parent_writer.extra_attrs->>'del' = agent.author
                    AND parent_writer.extra_attrs->>'role' IN ('WRITER', 'AGENT')
                    AND parent_writer.resource IN (SELECT r.id FROM resources r
                          JOIN json_each(:breadcrumbs) each ON each.value = r.iri)))
```

The second query has no recursion. The chain is at most one AGENT hop on top of one direct grant, and an owner-issued AGENT capability counts as that direct grant. So an AGENT of the owner's AGENT, such as a session key issued by a linked device, is authorized. A third hop is silently unauthorized. <!-- id:H_wWv99N -->

The rule never looks at timestamps. A capability issued after a Ref authorizes it retroactively, and one issued years ago is as good as one issued today. <!-- id:Vex5xa4w -->

## Worked example: Alice, Bob and Bob's laptop <!-- id:AXCcgV8n -->

Alice owns `hm://alice`. She publishes one capability, and Bob publishes one of his own: <!-- id:emP3O3Wg -->
  - `Cap1`: signer alice, delegate bob, path `/team`, role WRITER <!-- id:wRvEgMda -->
  - `Cap2`: signer bob, delegate bobLaptop, path empty, role AGENT <!-- id:5zSC0qkE -->

Now: <!-- id:ALgjD0pf -->
  - A Ref signed by **bob** for `hm://alice/team/notes`: breadcrumbs are `[hm://alice, hm://alice/team, hm://alice/team/notes]`. The direct lookup finds `Cap1` at `hm://alice/team`. Indexed. <!-- id:kBAWEyB2 -->
  - A Ref signed by **bobLaptop** for the same path: the direct lookup misses. The agent lookup finds `Cap2` (delegate bobLaptop, issuer bob), and bob holds `Cap1` from alice on a breadcrumb. Indexed. <!-- id:0c8x2z6s -->
  - A Ref signed by **bob** for `hm://alice/blog`: no breadcrumb matches `/team`. Not indexed. It is stashed (next section). If Alice later grants Bob a root WRITER capability, the stashed Ref is retried and lands. <!-- id:TEkfm2QN -->
  - If bobLaptop delegated a further AGENT key, bobLaptopScript, its Refs under `hm://alice/team` would fail. Alice never issued anything to bobLaptop, so the inner lookup has nothing to find. <!-- id:oTIACEiB -->
  - Bob asks Alice's server-mode site for a private document under `/team` with a bearer token. Denied, because private reads need a root-scoped grant; see [Privacy](./privacy.md). <!-- id:eKLtHnTS -->

## The stash <!-- id:R9HlkcZA -->

A Ref that fails the rule is kept. The bytes stay in the blob store. The interpretation is rolled back and recorded in a stash with the reason "permission denied" and the signer that was denied. When a capability naming that signer as delegate is indexed later, every stashed blob for that signer runs through the indexer again. This makes out-of-order delivery work: the Ref and the capability that names its signer may arrive in either order over the network, with the same result. The retry is keyed on the Ref's own signer only. When the missing piece is the grant one hop up an AGENT chain, such as `Cap1` arriving after bobLaptop's Ref in the example above, that capability names bob, so bobLaptop's stashed Ref is not retried until something else re-indexes it. <!-- id:54Myv9kJ -->

Two more facts follow. Nothing checks authorization on Changes. A [Change](../change.md) signed by anyone is stored, and becomes part of a document only when an authorized Ref points at it. Nothing checks [comments](./comments.md) either. Any key may attach a public comment to any document, and the `capability` field on comments is deprecated. Comment moderation is left to clients. <!-- id:dRcP68Ae -->

## Where the check runs <!-- id:fr2j0riR -->

The Ref indexer is the gate. The daemon's own write RPCs (`CreateRef`, `UpdateProfile`, the contact RPCs) run the same rule up front so you get a clear error. `PrepareChange` runs no check, because it only returns unsigned bytes for you to sign. Blobs that arrive already signed, over the network or through `POST /ipfs/<cid>`, are stored on their hash alone and judged at index time. So a node does not need to trust the node it received a Ref from. It re-verifies the capability chain itself, offline, from signed blobs ([Integrity](./integrity.md)). The `capability` field that the SDK can put on a Ref is informational. The indexer records it as a link and never uses it to decide. <!-- id:_3pdi3GK -->

## What grants nothing

A [contact](./contacts.md), a follow and a site membership grant no permission. The daemon never consults them when deciding what a key may write or read. [Contacts](./contacts.md) explains what they are for.

## Web of trust <!-- id:xEklKlhz -->

What exists: <!-- id:81qBa4vR -->
  1. **Capabilities**: owner-signed, non-expiring, non-revocable grants of WRITER or AGENT with recursive path scope and a one-hop AGENT chain. <!-- id:xz0DsMVr -->
  2. **Profile aliases**: a key may declare "I am really account X", accepted only if X issued it an AGENT capability. See [Identity](./identity.md). <!-- id:3JULU_K6 -->
  3. **[Contacts](./contacts.md)**: public naming and follow flags with no permission effect and no signer validation. <!-- id:80OBnH9u -->
  4. **Peer and site trust for delivery**: the server named in a space's `siteUrl`, and peers that authenticate as a WRITER, may receive that space's private blobs. <!-- id:m6ufd9Zf -->
  5. **Bearer identity over HTTP** for reading private content on server-mode nodes. <!-- id:KoG640ys -->

What does not exist: trust scores, transitive trust through contacts, friend-of-friend reads, reputation, endorsements, contact-based moderation or spam filtering, key rotation or recovery, revocation, expiry, an EDITOR or read-only role. The phrase "web of trust" does not appear in the daemon or the SDK. The code has a capability system of owner-issued grants, plus an unrelated public address book. No code path lets one user's trust in another change what a third party may read or write. <!-- id:jhiOpTff -->

# Working with permissions <!-- id:qSEiiUNi -->

Create a capability with `seed-cli capability create --delegate <uid> --role WRITER --path /team` in the [CLI](../build/cli.md), with `createCapability` in the [SDK](../build/sdk.md), from a document's Collaborators view in the [Seed app](../software/desktop.md), or with the agent [write](../agent/write.md) action `capability.grant`. <!-- id:jBYfdmtC -->

- `seed-cli account capabilities hm://<uid>/<path>` lists the grants that cover a path, inherited ones included.
- The signing key must be the space owner for `capability create`. With `--account`, the CLI looks up a WRITER or AGENT grant for the signing key and records its CID on the Ref. See [Seed CLI](../build/cli.md). <!-- id:snTGH0HR -->
- On the [Seed API](../build/web-api.md), `GET /api/ListCapabilities?targetId=<packed id>` returns every grant whose scope covers the target. The listing matches paths by string prefix, so a grant at `/team` also shows up for `/teammates`, where it authorizes nothing.
- A [Seed Agent](../agent.md) writes with its own key. A person who wants an agent to publish into their space grants it a capability, usually WRITER on a path. See [Write](../agent/write.md).
- An external agent using the seed-cli skill should hold its own key and get a scoped WRITER capability. It should not use the human's key. Then every change carries the agent's attribution, and a human's later edits show as separate changes. See [Building agents](../build/agents.md). <!-- id:SW9FRfb2 -->

# See also <!-- id:UsfnKGWX -->

- [Contacts](./contacts.md), [Spaces and paths](./spaces.md)
- [Capability](../capability.md), [Role](../role.md), [Contact](../contact.md), [Contact subscription](../contact/subscribe.md), [Profile](../profile.md), [Ref](../ref.md) <!-- id:3UVwnuSb -->
- [Identity](./identity.md), [Privacy](./privacy.md), [Integrity](./integrity.md), [Documents](./documents.md) <!-- id:pQ57rddD -->
- [Sign in with Seed](../build/sign-in.md), [Building agents](../build/agents.md) <!-- id:riQzNm9U -->
- [Glossary](../glossary.md) <!-- id:-jTZqAOp -->

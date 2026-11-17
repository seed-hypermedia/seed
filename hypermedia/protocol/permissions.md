---
name: Permissions
summary: A space owner lets another key write by signing a capability, and this page gives the exact rule every node checks, the two roles, the limit of one extra hop, and what else counts as trust.
---
A [space](./spaces.md) belongs to one [key](./identity.md). At first, only that key can publish into it. To let someone else write, the owner signs a small note called a **capability**. It names the other key, a role, and sometimes a path. For example, Alice signs "Bob may write under `/team`".

Every node that sees a [document](./documents.md) update checks it against the capabilities it knows. So every node applies the rule, and no single server decides. <!-- id:DnxwjiQ_ -->

This page gives the details: what a capability contains, what the two roles allow, how paths and chains of grants work, and what happens to an update that arrives with no right to write. <!-- id:ApsTvllH -->

# How it works <!-- id:gDef31y0 -->

## A capability is a signed note <!-- id:yyUbSZDM -->

A capability is a signed note that says: this key may do this, here. Anyone can check the signature, so no server has to be asked. Readers who know [UCAN](https://ucan.xyz/), [SPKI/SDSI](https://datatracker.ietf.org/doc/html/rfc2693) or ZCAP-LD will know the idea. These are simpler. The "may do this" part is a broad role. There is no list of small, separate permissions. <!-- id:MLCGcKMx -->

Three words are easy to mix up: <!-- id:VUaeKp5I -->
  - a **permission** is the right to do something; <!-- id:oqay6cEg -->
  - a **[capability](../capability.md)** is the signed thing that grants permissions; <!-- id:NWPj_99q -->
  - a **[role](../role.md)** is what kind of capability it is, and therefore which permissions it grants. <!-- id:O3kKDKM2 -->

A capability is a signed [blob](./blobs.md), like every other Hypermedia record. The `signer` is the key that issues the grant, and also the space being shared. The blob has no separate `issuer` field. <!-- id:po5pX8Bo -->

A capability names a `delegate` (the key that receives the grant), a `role`, an optional `path` and an optional `label`. The [capability](../capability.md) type page lists the fields.

Here is a grant from Alice to Bob for everything under `/team`, shown as [DAG-JSON](../schema/dag-json.md): <!-- id:SRkTwbrd -->

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

A capability has no end date, and nothing can take it back. Once published, it is valid forever on every node that has it. The `label` is public and cannot change, so do not put private notes in it. <!-- id:H_WO1T-H -->

Nothing takes a grant back, so grant narrowly: WRITER on a path, to a key you control. Treat a lost delegate key as lost forever.

## Who may issue <!-- id:faqCcqWM -->

Only the space owner's key can sign a capability for that space. For any other key, the [daemon](../software/daemon.md) refuses to build one, and the `CreateCapability` RPC returns permission denied. So a writer cannot issue a WRITER grant in someone else's space. There is one exception, the AGENT chain described below: any delegate can pass its rights on by one more hop, by making another key its AGENT. <!-- id:U3BdbO1o -->

## The two roles <!-- id:rM5UCVUd -->

**WRITER** may publish [Refs](../ref.md), the blobs that set a document's current [version](./documents.md), at the capability's path and at every path beneath it. That includes creating, forking, moving, deleting and redirecting documents under that path. A WRITER on the root of the space may also read private content over HTTP. A WRITER on a sub-path may not. Private [peer sync](./network.md) works the other way round: a WRITER at any path receives the private blobs of the whole space. [Privacy](./privacy.md) explains both differences. <!-- id:EUqg3D6C -->

**AGENT** lets another key act fully for the issuer's key. It must have an empty path, and the indexer rejects an AGENT capability with a path. An AGENT may do everything the issuer can do in the issuer's own space. It may sign the issuer's [profile](../profile.md), and publish an alias profile that points at the issuer. It also gets the issuer's direct grants in other spaces, for one hop. This role links devices and browser sessions to an account. The name does not come from AI agents. [Seed Agents](../agent.md) also use this role when an account lets an agent act for it. <!-- id:jHa_qoWo -->

Only `WRITER` and `AGENT` exist in the network. There is no editor role and no read-only role. So the roles cannot express a grant to read, a share link or an invitation. Owner, Admin, Follower, Member and Subscriber are not capability roles. <!-- id:8ZcoKlsh -->

## Path scope <!-- id:Td0aihIG -->

A capability covers its path and everything under it. The match is by whole path segment. A capability at `/team` covers `/team`, `/team/notes` and `/team/notes/2026`. It does not cover `/teammates`, because the match splits the path on `/`. The API has a `no_recursive` request flag and an `is_exact` response field, but they do nothing. The daemon rejects `no_recursive` and always reports `is_exact` as false. <!-- id:YTKYFw57 -->

## The authorization rule <!-- id:JxRtSA4- -->

A node decides when it indexes a Ref. The indexer asks: "may the key that signed this Ref write at [`hm://<space>/<path>`](./urls.md)?". It answers with two lookups over the capabilities it has stored. <!-- id:1EHgGLy2 -->
  1. If the signer is the space owner, yes. <!-- id:fK73npYt -->
  2. List the breadcrumbs of the target, which are the target and every path above it: `hm://A/x/y` gives `[hm://A, hm://A/x, hm://A/x/y]`. <!-- id:Z1htJJtY -->
  3. **Direct grant.** Is there a capability signed by the owner, delegating to the signer, with role WRITER or AGENT, whose resource is one of the breadcrumbs? If so, yes. <!-- id:4vXZT6MC -->
  4. **One-hop agent.** Is there an AGENT capability delegating to the signer whose issuer is either the owner, or a key that itself holds a direct WRITER or AGENT grant from the owner on one of the breadcrumbs? If so, yes. <!-- id:UaamB9AE -->
  5. Otherwise, no. <!-- id:BdCoPBm9 -->

These two lookups are the queries the daemon runs. Only the parameter names are changed here, to make them easier to read. The direct grant: <!-- id:Q8HD0tE_ -->

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

The second query does not repeat itself. The chain is at most one AGENT hop on top of one direct grant. An AGENT capability from the owner counts as that direct grant. So an AGENT of the owner's AGENT may write, such as a session key issued by a linked device. A third hop may not, and the node gives no error. <!-- id:H_wWv99N -->

The rule never looks at timestamps. A capability issued after a Ref still makes that Ref valid. An old capability is as good as a new one. <!-- id:Vex5xa4w -->

## Worked example: Alice, Bob and Bob's laptop <!-- id:AXCcgV8n -->

Alice owns `hm://alice`. She publishes one capability, and Bob publishes one of his own: <!-- id:emP3O3Wg -->
  - `Cap1`: signer alice, delegate bob, path `/team`, role WRITER <!-- id:wRvEgMda -->
  - `Cap2`: signer bob, delegate bobLaptop, path empty, role AGENT <!-- id:5zSC0qkE -->

Now: <!-- id:ALgjD0pf -->
  - A Ref signed by **bob** for `hm://alice/team/notes`: breadcrumbs are `[hm://alice, hm://alice/team, hm://alice/team/notes]`. The direct lookup finds `Cap1` at `hm://alice/team`. Indexed. <!-- id:kBAWEyB2 -->
  - A Ref signed by **bobLaptop** for the same path: the direct lookup misses. The agent lookup finds `Cap2` (delegate bobLaptop, issuer bob), and bob holds `Cap1` from alice on a breadcrumb. Indexed. <!-- id:0c8x2z6s -->
  - A Ref signed by **bob** for `hm://alice/blog`: no breadcrumb matches `/team`. Not indexed. It is stashed (next section). If Alice later grants Bob a root WRITER capability, the stashed Ref is retried and lands. <!-- id:TEkfm2QN -->
  - If bobLaptop delegated a further AGENT key, bobLaptopScript, its Refs under `hm://alice/team` would fail. Alice never issued anything to bobLaptop, so the inner lookup has nothing to find. <!-- id:oTIACEiB -->
  - Bob asks Alice's [site](./sites.md), which runs in server mode, for a private document under `/team` with a bearer token. Denied, because a private read needs a grant on the root of the space. See [Privacy](./privacy.md). <!-- id:eKLtHnTS -->

## The stash <!-- id:R9HlkcZA -->

The node keeps a Ref that fails the rule. The bytes stay in the blob store. The node does not index the Ref. It records it in a **stash**, with the reason "permission denied" and the signer that was denied. Later, when the node indexes a capability that names that signer as delegate, it runs every stashed blob of that signer through the indexer again. So the Ref and the capability that names its signer can arrive in either order, with the same result.

The retry looks only at the Ref's own signer. Sometimes the missing piece is the grant one hop up an AGENT chain. In the example above, that is `Cap1` arriving after bobLaptop's Ref. That capability names bob, so the node does not retry bobLaptop's stashed Ref until something else indexes it again. <!-- id:54Myv9kJ -->

Two more facts follow. Nothing checks who may write a Change. The node stores a [Change](../change.md) signed by anyone, and the Change becomes part of a document only when an authorized Ref points at it. Nothing checks [comments](./comments.md) either. Any key may attach a public comment to any document, and the `capability` field on comments is deprecated. Comment moderation is left to clients. <!-- id:dRcP68Ae -->

## Where the check runs <!-- id:fr2j0riR -->

The Ref indexer is where the rule is applied. The daemon's own write RPCs (`CreateRef`, `UpdateProfile`, the contact RPCs) run the same rule first, so you get a clear error. `PrepareChange` runs no check, because it only returns unsigned bytes for you to sign. A blob can also arrive already signed, over the network or through `POST /ipfs/<cid>`. The node stores it by its hash alone and judges it when it indexes it. So a node does not need to trust the node that sent it a Ref. It checks the chain of capabilities itself, offline, from signed blobs ([Integrity](./integrity.md)). The `capability` field that the SDK can put on a Ref is only information. The indexer records it as a link and never uses it to decide. <!-- id:_3pdi3GK -->

## What grants nothing

A [contact](./contacts.md), a follow and a site membership give no permission. The daemon never looks at them when it decides what a key may write or read. [Contacts](./contacts.md) explains what they are for.

## Web of trust <!-- id:xEklKlhz -->

What exists: <!-- id:81qBa4vR -->
  1. **Capabilities**: grants of WRITER or AGENT, signed by the owner. They never end and cannot be taken back. They cover a path and everything under it, with an AGENT chain of one hop. <!-- id:xz0DsMVr -->
  2. **Profile aliases**: a key may declare "I am really account X", accepted only if X issued it an AGENT capability. See [Identity](./identity.md). <!-- id:3JULU_K6 -->
  3. **[Contacts](./contacts.md)**: public names and follow flags. They give no permission, and nothing checks who signs them. <!-- id:80OBnH9u -->
  4. **Peer and site trust for delivery**: the server named in a space's `siteUrl`, and peers that authenticate as a WRITER, may receive that space's private blobs. <!-- id:m6ufd9Zf -->
  5. **Bearer identity over HTTP** for reading private content on server-mode nodes. <!-- id:KoG640ys -->

What does not exist: trust scores, trust passed on through contacts, friend-of-friend reads, reputation, endorsements, moderation or spam filtering based on contacts, key rotation or recovery, revocation, expiry, an EDITOR role or a read-only role. The phrase "web of trust" does not appear in the daemon or the SDK. The code has a system of grants issued by owners, plus a separate public address book. No code path lets one user's trust in another change what a third party may read or write. <!-- id:jhiOpTff -->

# Working with permissions <!-- id:qSEiiUNi -->

Create a capability with `seed-cli capability create --delegate <uid> --role WRITER --path /team` in the [CLI](../build/cli.md), with `createCapability` in the [SDK](../build/sdk.md), from a document's Collaborators view in the [Seed app](../software/desktop.md), or with the agent [write](../agent/write.md) action `capability.grant`. <!-- id:jBYfdmtC -->

- `seed-cli account capabilities hm://<uid>/<path>` lists the grants that cover a path, including grants on the paths above it.
- The signing key must be the space owner for `capability create`. With `--account`, the CLI looks up a WRITER or AGENT grant for the signing key and records its [CID](../cid.md) on the Ref. See [Seed CLI](../build/cli.md). <!-- id:snTGH0HR -->
- On the [Seed API](../build/web-api.md), `GET /api/ListCapabilities?targetId=<packed id>` returns every grant that covers the target. The listing matches paths by string prefix. So a grant at `/team` also shows up for `/teammates`, where it allows nothing.
- A [Seed Agent](../agent.md) writes with its own key. A person who wants an agent to publish into their space grants it a capability, usually WRITER on a path. See [Write](../agent/write.md).
- An external agent using the seed-cli skill should hold its own key and get a scoped WRITER capability. It should not use the human's key. Then every change shows the agent as its author, and a human's later edits show as separate changes. See [Using Seed from your own agent](../build/agents.md). <!-- id:SW9FRfb2 -->

# See also <!-- id:UsfnKGWX -->

- [Contacts](./contacts.md), [Spaces and paths](./spaces.md)
- [Capability](../capability.md), [Role](../role.md), [Contact](../contact.md), [Contact subscription](../contact/subscribe.md), [Profile](../profile.md), [Ref](../ref.md) <!-- id:3UVwnuSb -->
- [Identity](./identity.md), [Privacy](./privacy.md), [Integrity](./integrity.md), [Documents](./documents.md) <!-- id:pQ57rddD -->
- [Sign in with Seed](../build/sign-in.md), [Using Seed from your own agent](../build/agents.md) <!-- id:riQzNm9U -->
- [Glossary](../glossary.md) <!-- id:-jTZqAOp -->

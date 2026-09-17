---
name: Permissions
summary: Who may write into a space is decided by signed capability blobs that the space owner issues, checked by every node when it indexes a Ref; this page gives the exact rule, the two roles, the one-hop delegation limit, and what "web of trust" means today versus what is only planned.
---
A space belongs to one key, and by default only that key can publish into it. To let someone else write, the owner signs a small statement, a capability, that names the other key, a role, and optionally a path. Every node that sees a document update checks it against the capabilities it knows about, so the rule is enforced everywhere at once rather than by one server.

This page is the precise version of that story: what a capability contains, what the two roles allow, how path scope and delegation chains work, what happens to an update that arrives without authority, and how contacts and membership relate to all of it. It closes with a candid section on what is and is not built.

# How it works

## Capabilities are certificates

Alex's description from the team notes is the best short one: strictly speaking these are not object capabilities, where authority is possession of a reference; the system spans processes and machines, so it uses signed certificates instead, in the family of [UCAN](https://ucan.xyz/), [SPKI/SDSI](https://datatracker.ietf.org/doc/html/rfc2693) and ZCAP-LD, but simpler and scoped to Hypermedia's needs. Each certificate says: this identity may do X on resource Y. The "do X" part is a coarse role, not a list of fine-grained permissions.

Eric's vocabulary triad keeps the words straight:

- a **permission** is the ability to do something;
- a **[capability](../capability.md)** is the signed thing that grants permissions;
- a **[role](../role.md)** is what kind of capability it is, and therefore which permissions it grants.

A capability is a signed [blob](../blob.md) like every other Hypermedia record. The `signer` is both the issuer and the space being shared; there is no separate `issuer` field on the wire.

| Field | Required | Meaning |
| --- | --- | --- |
| `type` | yes | `"Capability"` |
| `signer` | yes | the issuer, which is always the space owner |
| `sig`, `ts` | yes | signature and issue time; the time is recorded but never compared with anything |
| `delegate` | yes | the [principal](../principal.md) receiving the grant |
| `role` | yes | `WRITER` or `AGENT` |
| `path` | no | the scope; empty means the whole space |
| `label` | no | a public, immutable note of at most 512 bytes |
| `audience` | no | used only by ephemeral authentication capabilities, never on stored grants |

Shown as DAG-JSON, a grant from Alice to Bob for everything under `/team`:

```json
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

There is no expiry field and no revocation record. A capability, once published, is valid forever on every node that has it. Because the `label` is public and immutable, do not put private notes in it.

## Who may issue

Only the space owner's key can sign a capability for that space. The daemon refuses to build one otherwise, and the `CreateCapability` RPC returns permission denied. A writer therefore cannot invite another writer: there is no re-delegation of WRITER grants, and the proto's talk of nested delegations is a TODO. The one exception is the AGENT chain described below, which is a different mechanism.

## The two roles

**WRITER** may publish [Refs](../ref.md), the blobs that set a document's current version, at the capability's path and at every path beneath it. That includes creating documents, forking, moving, deleting and redirecting under the scope. A WRITER scoped to the space root additionally counts as a collaborator for reading private content and for private sync; a WRITER scoped to a sub-path does not, which is a known asymmetry discussed under [Privacy](./privacy.md).

**AGENT** is full delegation of the issuer's key. It must have an empty path; the indexer rejects an AGENT capability with a path outright. An AGENT may do everything the issuer can do in the issuer's own space, may sign the issuer's [profile](../profile.md), may publish an alias profile pointing at the issuer, and inherits the issuer's direct grants in other spaces for one hop. This is the role used for linking devices and browser sessions to an account, which is why the team keeps saying the name has nothing to do with AI agents. It is also the role Seed Agents use when an account lets an agent act for it.

An `EDITOR` role is reserved in the proto as a comment and does not exist in data. Team documents that list Owner, Admin, Follower, Member or Subscriber as roles describe designs, not capabilities. Only `WRITER` and `AGENT` exist in the network.

## Path scope

Scope is by path segment, always recursive. A capability at `/team` covers `/team`, `/team/notes` and `/team/notes/2026`, but not `/teammates`, because matching splits on `/`. The `no_recursive` request flag and the `is_exact` response field exist in the API but are unimplemented: the daemon rejects `no_recursive` and always reports `is_exact` as false. HM26 direction has since dropped the idea of non-recursive grants altogether; see the end of this page.

## The authorization rule

Authorization is decided when a node indexes a Ref, not when a client asks to write. The question the indexer answers is "may the key that signed this Ref write at `hm://<space>/<path>`?", and it answers it with two lookups over the capabilities it has stored.

1. If the signer is the space owner, yes.
2. Compute the breadcrumbs of the target: `hm://A/x/y` gives `[hm://A, hm://A/x, hm://A/x/y]`.
3. **Direct grant.** Is there a capability signed by the owner, delegating to the signer, with role WRITER or AGENT, whose resource is one of the breadcrumbs? If so, yes.
4. **One-hop agent.** Is there an AGENT capability delegating to the signer whose issuer is either the owner, or a key that itself holds a direct WRITER or AGENT grant from the owner on one of the breadcrumbs? If so, yes.
5. Otherwise, no.

Those two lookups are, verbatim, the queries the daemon runs. The direct grant:

```sql
SELECT 1 FROM structural_blobs direct
WHERE direct.type = 'Capability'
  AND direct.author = :owner
  AND direct.extra_attrs->>'del' = :writer
  AND direct.extra_attrs->>'role' IN ('WRITER', 'AGENT')
  AND direct.resource IN (SELECT r.id FROM resources r
                          JOIN json_each(:breadcrumbs) each ON each.value = r.iri)
```

The one-hop agent rule:

```sql
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

There is no recursion in the second query. The chain is at most one AGENT hop on top of one direct grant. A session key of a session key is silently unauthorized.

Note what the rule never looks at: timestamps. A capability issued after a Ref retroactively authorizes it, and one issued years ago is as good as one issued today.

## Worked example: Alice, Bob and Bob's laptop

Alice owns `hm://alice`. She publishes one capability, and Bob publishes one of his own:

- `Cap1`: signer alice, delegate bob, path `/team`, role WRITER
- `Cap2`: signer bob, delegate bobLaptop, path empty, role AGENT

Now:

- A Ref signed by **bob** for `hm://alice/team/notes`: breadcrumbs are `[hm://alice, hm://alice/team, hm://alice/team/notes]`; the direct lookup finds `Cap1` at `hm://alice/team`. Indexed.
- A Ref signed by **bobLaptop** for the same path: the direct lookup misses; the agent lookup finds `Cap2` (delegate bobLaptop, issuer bob), and bob holds `Cap1` from alice on a breadcrumb. Indexed.
- A Ref signed by **bob** for `hm://alice/blog`: no breadcrumb matches `/team`. Not indexed; it is stashed (next section). If Alice later grants Bob a root WRITER capability, the stashed Ref is retried and lands.
- If bobLaptop delegated a further AGENT key, bobLaptopScript, its Refs under `hm://alice/team` would fail: Alice never issued anything to bobLaptop, so the inner lookup has nothing to find.
- Bob asks Alice's public-only site for a private document under `/team` with a bearer token: denied, because private reads require a root-scoped grant; see [Privacy](./privacy.md).

## What happens to an unauthorized Ref: the stash

A Ref that fails the rule is not thrown away. The bytes stay in the blob store, and the interpretation is rolled back and recorded in a stash with the reason "permission denied" and the signer that was denied. Whenever a capability naming that signer as delegate is indexed later, every stashed blob for that signer is re-run through the indexer. This is how out-of-order delivery works: the Ref and the capability may arrive in either order over the network and the result is the same.

Two consequences worth knowing. Changes are never authorization-checked; a [Change](../change.md) signed by anyone is stored and becomes part of a document only when an authorized Ref points at it. And [comments](../comment.md) are not checked at all: any key may attach a public comment to any document, and the `capability` field on comments is deprecated. Comment moderation is a client concern today.

## Where the check runs, and where it does not

The Ref indexer is the gate. The daemon's own write RPCs (`CreateRef`, `UpdateProfile`, the contact RPCs) run the same rule up front so you get a clear error, and `PrepareChange` runs no check because it only returns unsigned bytes for you to sign. Blobs that arrive already signed, over the network or through `POST /ipfs/<cid>`, are stored on the strength of their hash alone and judged at index time. A node therefore does not need to trust the node it received a Ref from; it re-verifies the capability chain itself, offline, from signed blobs. The `capability` field that the SDK can put on a Ref is informational: the indexer records it as a link and never uses it to decide.

## Contacts, following and membership

A [contact](../contact.md) is a public address-book entry: "account A calls subject S by this name", plus two flags. It is not a permission. The daemon never consults a contact when deciding what a key may write or read.

The flags in `subscribe` are how the Seed apps model relationships: `site: true` means "I joined this site" and `profile: true` means "I follow this person". A contact with neither flag is treated as a legacy follow. Joining a site is publishing such a contact; leaving is removing the flag or the contact. The People and Members views of a site are derived from who has published a joining contact, and a writer who joins appears as a member with their role. Membership, in Eric's phrase, is not a permission. The daemon does not validate who signs a contact on whose behalf, and it never turns a contact into a sync subscription; the apps do that. See [Contact](../contact.md) and [Contact subscription](../contact/subscribe.md).

## "Web of trust": what exists and what does not

What is concrete in code today:

1. **Capabilities**: owner-signed, non-expiring, non-revocable grants of WRITER or AGENT with recursive path scope and a one-hop AGENT chain.
2. **Profile aliases**: a key may declare "I am really account X", accepted only if X issued it an AGENT capability. See [Identity](./identity.md).
3. **Contacts**: public naming and follow flags with no permission effect and no signer validation.
4. **Peer and site trust for delivery**: the server named in a space's `siteUrl`, and peers that authenticate as a WRITER, may receive that space's private blobs.
5. **Bearer identity over HTTP** for reading private content on public-only nodes.

What is not in code: trust scores, transitive trust through contacts, friend-of-friend reads, reputation, endorsements, contact-based moderation or spam filtering, key rotation or recovery, revocation, expiry, an EDITOR or read-only role. The phrase "web of trust" does not appear in the daemon or the SDK. The blunt summary from the code audit stands: what exists is a capability system, owner-issued grants, plus an unrelated public address book. There is no path in the code where one user's trust in another changes what a third party may read or write.

# Working with permissions

## In the Seed app

A document's Collaborators view lists who can write it, with inherited grants from parent paths, and the owner invites members there: pick accounts, pick a role, and the app signs one capability per account, scoped to the document's path, and pushes them to the site so they take effect as fast as a comment does. Joining and following are the Join and Follow buttons, which publish contacts.

## CLI

```sh
seed-cli capability create --delegate z6MkBob… --role WRITER --path /team --label "Team writers"
seed-cli capability create --delegate z6MkLaptop… --role AGENT
seed-cli account capabilities hm://z6MkAlice…/team        # grants that cover this path, inherited included
seed-cli document create --account z6MkAlice… --path /team/notes -f notes.md   # write into a space that delegated to you
seed-cli contact create --subject z6MkBob… --name "Bob"
seed-cli contact list z6MkAlice… --account                  # Alice's contacts; --subject for who names Alice
```

The signing key must be the space owner for `capability create`. With `--account`, the CLI looks up a WRITER or AGENT grant for the signing key and records its CID on the Ref. See [Seed CLI](../build/cli.md).

## SDK

`createCapability({delegateUid, role, path?, label?}, signer)` returns a publish input; `client.publish` sends it. `resolveCapability(client, targetAccount, signerAccount, path?)` finds the grant that lets a signer write into another space. `createContact`, `updateContact` and `deleteContact` cover the address book. Reads go through `client.request('ListCapabilities', {targetId})`. See [SDK](../build/sdk.md).

## Web API

`GET /api/ListCapabilities?targetId=<packed id>` returns every grant whose scope covers the target, inherited ones included. `GET /api/ListDocumentCollaborators?targetId=…` combines grants and joining contacts into the view the app shows. `GET /api/AccountContacts?__value=<uid>` and `GET /api/SubjectContacts?__value=<uid>` list contacts by owner and by subject. Grants are published like any blob with `POST /api/PublishBlobs`. On the daemon, the gRPC `AccessControl` service has `ListCapabilities`, `ListCapabilitiesForDelegate`, `CreateCapability` and `GetCapability`; pagination and `ignore_inherited` are declared but not implemented. See [Web API](../build/web-api.md).

## Agents

A Seed Agent writes with its own key, so a human who wants an agent to publish into their space grants it a capability, usually WRITER on a path, and the agent's `write` to `hm://<space>/<path>` then succeeds. An agent that owns a space can grant others with the `write` verb: action `capability.grant` (alias `capability.create`) with `delegate`, `role`, and optional `path` and `label`, always tried with `dryRun` first. The agent server verifies delegation the same way the daemon does, by checking a capability blob signed by the account for the signer, and it offers no revocation because the protocol has none. Contacts are `contact.create` and `contact.delete`. See [Write](../agent/write.md) and [Signed API](../agent/signed-api.md).

An external agent using the seed-cli skill should hold its own key and be granted a scoped WRITER capability rather than the human's key, so that every change carries the agent's attribution and a human's improvements on top of it are visible as separate changes. See [Building agents](../build/agents.md).

# Where this is going

Design direction as of September 2026; none of it is code:

- **Revocation.** The `RevokeCapability` RPC is a TODO in the proto and a shaped project in the team's plans. Until it exists, the mitigation is to grant narrowly (WRITER on a path, to a key you control) and to treat a lost delegate key as permanent.
- **EDITOR and read roles.** Reserved in the proto; the sharing-permissions product work (August 2026) asks for read grants, share links and invitations, which the current roles cannot express.
- **HM26.** The node and resource redesign drops path-scoped grants in favour of invitations at the space level, discontinues the non-recursive flag, treats capabilities as a special category of resource, and wants a group concept so one grant can name several keys. Existing sub-document grants would not migrate. See [Roadmap](./roadmap.md).
- **Trust beyond grants.** Team essays describe contextual, community-rooted trust rather than a global PGP-style web; nothing of it is specified yet.

The dated investigation behind much of this, including an adversarial review of a "grants" design, lives under [History: Permissions](../history/permissions.md), and [How privacy works today](../history/permissions/current-state.md) is the August 2026 snapshot it was written against.

# See also

- [Capability](../capability.md), [Role](../role.md), [Contact](../contact.md), [Contact subscription](../contact/subscribe.md), [Profile](../profile.md), [Ref](../ref.md)
- [Identity](./identity.md), [Privacy](./privacy.md), [Integrity](./integrity.md), [Documents](./documents.md)
- [Sign in with Seed](../build/sign-in.md), [Building agents](../build/agents.md)
- [History: Permissions](../history/permissions.md)
- [Glossary](../glossary.md)

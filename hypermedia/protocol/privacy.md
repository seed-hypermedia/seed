---
name: Privacy
summary: Hypermedia has a per-blob visibility model that keeps private documents and comments off public nodes and away from unauthorized peers, and this page says exactly what holds today, including that the daemon has private document creation switched off.
---
Most Hypermedia content is public by design: signed, content-addressed, and free to copy. For content that should stay private, the protocol has a visibility model. A [document](./documents.md) or [comment](./comments.md) can be marked private. Nodes then hand its [blobs](./blobs.md) only to peers and readers who can prove they belong to the [space](./identity.md). This page describes what the daemon does today. The feature is still changing, and part of it is switched off. <!-- id:JW-UMOhs -->

# How it works <!-- id:HEitzGwI -->

## Two visibility values <!-- id:5MBdl3xt -->

[Visibility](../visibility.md) is a string with two values: the empty string, meaning public, and `Private`. It lives on [Ref](../ref.md) and [comment](../comment.md) blobs, the two kinds that place content somewhere. [Changes](../change.md) carry no visibility of their own, and neither do [files](./files.md). <!-- id:PKEL938x -->

## Per blob, per space <!-- id:8z1idPs0 -->

The daemon keeps a table of which spaces each blob is visible in. A public blob has a single "everyone" row. A private blob has one row per space that may see it. A blob with no explicit visibility inherits it from whatever links to it. A Change inherits from the Change or Ref that depends on it. A file blob inherits from anything that links to it. Propagation does not depend on order, and one public record wins: if any public Ref reaches a Change, that Change is public for everyone. <!-- id:WDS8_NWk -->

<!-- id:BMJ0IJ8B -->
| Blob <!-- col:sXtenxBO --> | Visibility <!-- col:AM-xyQOk --> <!-- id:SSO2_ONf --> |
| --- | --- |
| Change | none of its own; it has no visibility record and is not public until a public Ref or Change chain reaches it, and a private Ref that reaches it gives it that Ref's space <!-- id:HnhJ5VLw --> |
| Ref | explicit; a private Ref is visible in its own space and must use a single-segment path such as `/feedback-123` <!-- id:cHJX3lm1 --> |
| Comment | explicit; a private comment is visible to the commenter's space and the target's space; the daemon's `CreateComment` inherits the target document's visibility <!-- id:610WwsNn --> |
| Capability, Contact, Profile | always public <!-- id:lRWlJCNm --> |
| DagPB and raw file blobs | inherited from whatever links to them <!-- id:VUqrUser --> |

Because visibility sits on the Ref, the same Changes can be private work in progress and later become public through a new public Ref. <!-- id:1IFBixEk -->

## Private document creation is disabled <!-- id:0nwqhatV -->

The daemon's `PrepareChange` RPC refuses a private change unless the document is already private. It returns a failed-precondition error that says private document creation is disabled. The Seed desktop and web apps removed their Private option in the same September 2026 change. Root documents can never be private, and private paths must be a single segment. Existing private documents keep working. The gate sits only in that RPC. The indexer has no such gate, so a client that builds and signs its own Changes and a private Ref can still publish a new private document, and every node will index it. Team notes call this Phase 1 of private documents (shipped early 2026, then gated). Phase 2 adds inheritance and invitations and is still in design; see [Roadmap](./roadmap.md). <!-- id:Z61_7G3f -->

A second known gap: the daemon's own `CreateRef` RPC publishes version and tombstone Refs as public, whatever the document's visibility. Clients that publish private documents sign their Refs themselves. The security audit log records this as an open finding. <!-- id:EpU3LQMr -->

## Who may read private content over HTTP <!-- id:WVM-iNfP -->

On a desktop [daemon](../apps/daemon.md), the local API hides nothing. Every local caller sees every blob. Visibility is enforced only when the daemon runs with the `-public-only` flag, as hosted [sites](./sites.md) and gateways do. <!-- id:ofQB_uNE -->

On a public-only node, a request must carry a bearer token minted by the daemon (see [Identity](./identity.md)), and private content is served when the token's principal: <!-- id:cckJb-G0 -->
  - is the space owner, or <!-- id:GntVQvhc -->
  - holds a [WRITER or AGENT](./permissions.md) [capability](../capability.md) scoped to the **root** of the space, or <!-- id:rwwGSEZV -->
  - is an AGENT of a key that holds such a root grant. <!-- id:GVNNcPsq -->

A WRITER scoped to a sub-path can write there but is denied private reads there. This asymmetry comes from how the read predicate is written, and it is a tracked issue. In public-only mode, even the owner's own daemon denies its own private document to an unauthenticated HTTP request. The [Seed web app](../apps/web.md) forwards the visitor's cookie as that bearer token on every daemon call. <!-- id:XdSIhVyZ -->

## How peers are gated <!-- id:COGK2cRq -->

Peer-to-peer delivery is the only place with real access control. It has two layers. <!-- id:mgaHufcC -->
  - **Peer authentication.** A [peer](./network.md) proves it holds an account by signing an ephemeral capability naming the account and the server's peer, fresh within one minute. The server remembers that proof in memory for the connection. <!-- id:tDVMmEf5 -->
  - **Authorization.** A private blob is served to a peer only if one of these holds: the peer is allowlisted for an in-flight push; it is authenticated as the space owner; it is the server the space names in its home document's `siteUrl` (resolved by fetching that site's `/hm/api/config` and comparing the peer ID); or it is authenticated as an account holding a **WRITER** capability for the space, at any path. <!-- id:VG44C2tX -->

Set reconciliation is filtered the same way. The server computes which spaces the peer may see and folds range fingerprints over the filtered view, so an unauthorized peer never learns that hidden blobs exist. Plain blob listing never lists private blobs. A daemon that holds a WRITER grant for a space authenticates automatically before syncing with that space's site. <!-- id:JDJJ5Hwi -->

Two facts matter here. First, AGENT keys count for HTTP reads but not for peer sync. An AGENT alone gets nothing private over the network, while a WRITER on a single page gives that peer the whole space's private blobs. Second, the `siteUrl` server is trusted because the home document says so. A space owner who points `siteUrl` at a hostile host grants that host the space's private blobs. This is by design, and it is why the team says a private document "requires a server for now". [Integrity](./integrity.md) lists this among the trusted parts. <!-- id:zESXNcTP -->

## No encryption <!-- id:_s1H1M1S -->

Private means access control on delivery. Nothing is encrypted. Any node that legitimately holds the blobs holds them in the clear, and a node's owner can read its own store. Visibility also cannot be revoked. What has been delivered to a peer stays there. <!-- id:iYCX4sLd -->

# Working with private content <!-- id:RZqSX_dT -->

## In the Seed app <!-- id:swPXYixb -->

The desktop and web apps no longer offer a Private option when creating a document. When they did, private drafts got random single-segment paths. Private documents are visible in the app only to the owner and to root-level writers. The web app filters them out for anonymous visitors and shows them to signed-in collaborators through the bearer cookie. Because of the daemon gate above, the apps cannot create new private documents today. <!-- id:9UuI5x8c -->

## CLI <!-- id:HxBFN1zX -->

The [Seed CLI](../build/cli.md) has no flag for private visibility on `document create`. It publishes public Refs. It can read a private document from a site only with a bearer cookie, and it does not manage one. Treat the CLI as a public-content tool today. <!-- id:98Vy9mbW -->

## SDK <!-- id:KOage_0S -->

In the [SDK](../build/sdk.md), `createVersionRef` and the other Ref builders accept a `visibility` option, and `createComment` does too, so a client can publish private Refs and comments itself. `PrepareDocumentChange` accepts `visibility`. Reading private content from a site needs the `Authorization: Bearer` header from `POST /hm/api/auth`. See [SDK](../build/sdk.md). <!-- id:6AP7MyE- -->

## Web API <!-- id:76CYIuX6 -->

The [Seed API](../build/web-api.md) on a site returns private resources only to requests carrying the auth cookie or an explicit bearer header whose principal passes the root-grant rule above. Otherwise they are absent from listings, and `Resource` reports them as not found. `GET /hm/api/file` and image routes forward the same cookie to the daemon. See [Web API](../build/web-api.md). <!-- id:KpChfFoG -->

## Agents <!-- id:QTt0AM6M -->

[Seed Agents](../agent.md) publish documents as public. The runtime's document writes do not pass a visibility through to the Ref, even though an agent draft can record a `visibility` field. A comment written by an agent inherits the visibility of the document or comment it replies to, as the daemon's own comment RPC does. The agent server reads through the site's public API. So an agent that holds a root WRITER grant for a space can read that space's private documents only if its requests carry a bearer token for its key. The runtime does not send one today. External agents using the CLI are in the same position. <!-- id:nO9rFdOk -->

# Where this is going <!-- id:KkHkvjI3 -->

As of September 2026 the direction is Phase 2 of private documents: read and write grants on private documents, inheritance for children of private documents, anyone-with-the-link access, and invitations to people who have no account yet. The HM26 node redesign gives private documents optional names instead of random paths. The team has also stated that without encryption, reading and syncing are the same permission. That shapes how sync permissions will be expressed. See [Roadmap](./roadmap.md) and [Permissions](./permissions.md). <!-- id:LB8RpOVO -->

# See also <!-- id:ZEH1bUk9 -->

- [Visibility](../visibility.md), [Ref](../ref.md), [Comment](../comment.md), [Capability](../capability.md) <!-- id:Nu4wuyOP -->
- [Identity](./identity.md), [Permissions](./permissions.md), [Integrity](./integrity.md), [Network](./network.md), [Sites](./sites.md) <!-- id:2qg6gojo -->
- [Glossary](../glossary.md) <!-- id:CVgi0Ulg -->

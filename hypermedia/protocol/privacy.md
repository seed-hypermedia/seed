---
name: Privacy
summary: Hypermedia's per-blob visibility model restricts delivery and serving of private documents and comments, and this page describes the read rules and the limits on creating private documents.
---
Most Hypermedia content is public by design: signed, content-addressed, and free to copy. For content that should stay private, the protocol has a visibility model. A [document](./documents.md) or [comment](./comments.md) can be marked private. Nodes then hand its [blobs](./blobs.md) only to peers and readers who can prove they belong to the [space](./spaces.md). This page describes what the daemon does. Private documents cannot be created in the Seed apps. <!-- id:JW-UMOhs -->

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

## Private documents cannot be created in the app <!-- id:0nwqhatV -->

The daemon's `PrepareChange` RPC refuses a private change unless the document is already private. It returns a failed-precondition error that says private document creation is disabled. The Seed desktop and web apps have no Private option. Root documents can never be private, and private paths must be a single segment. Existing private documents keep working. The gate sits only in that RPC. The indexer has no such gate, so a client that builds and signs its own Changes and a private Ref can publish a new private document, and every node indexes it. <!-- id:Z61_7G3f -->

The daemon's own `CreateRef` RPC publishes version and tombstone Refs as public, whatever the document's visibility. Clients that publish private documents sign their Refs themselves. <!-- id:EpU3LQMr -->

## Who may read private content over HTTP <!-- id:WVM-iNfP -->

Visibility filtering applies only in server mode (`-server-mode` or `SEED_SERVER_MODE=true`), as hosted [sites](./sites.md) and gateways run. In default mode the [daemon](../software/daemon.md) admits only loopback callers and trusts them, so they can read every blob. [Integrity](./integrity.md) describes both modes. <!-- id:ofQB_uNE -->

On a server-mode node, a private read request must carry a bearer token minted by the daemon (see [Identity](./identity.md)), and private content is served when the token's principal: <!-- id:cckJb-G0 -->
  - is the space owner, or <!-- id:GntVQvhc -->
  - holds a [WRITER or AGENT](./permissions.md) [capability](../capability.md) scoped to the **root** of the space, or <!-- id:rwwGSEZV -->
  - is an AGENT of a key that holds such a root grant. <!-- id:GVNNcPsq -->

A WRITER scoped to a sub-path can write there but is denied private reads there. This asymmetry comes from how the read predicate is written. In server mode, even the owner's own daemon denies its own private document to an unauthenticated HTTP request. The [Seed web app](../software/web.md) forwards the visitor's cookie as that bearer token on every daemon call. <!-- id:XdSIhVyZ -->

## How peers are gated <!-- id:COGK2cRq -->

Peer-to-peer delivery uses separate authentication and authorization rules, independent of server mode. It has two layers. <!-- id:mgaHufcC -->
  - **Peer authentication.** A [peer](./network.md) proves it holds an account by signing an ephemeral capability naming the account and the server's peer, fresh within one minute. The server remembers that proof in memory for the connection. <!-- id:tDVMmEf5 -->
  - **Authorization.** A private blob is served to a peer only if one of these holds: the peer is allowlisted for an in-flight push; it is authenticated as the space owner; it is the server the space names in its home document's `siteUrl` (resolved by fetching that site's `/hm/api/config` and comparing the peer ID); or it is authenticated as an account holding a **WRITER** capability for the space, at any path. <!-- id:VG44C2tX -->

Set reconciliation is filtered the same way. The server computes which spaces the peer may see and folds range fingerprints over the filtered view, so an unauthorized peer never learns that hidden blobs exist. Plain blob listing never lists private blobs. A daemon that holds a WRITER grant for a space authenticates automatically before syncing with that space's site. <!-- id:JDJJ5Hwi -->

Two facts matter here. First, AGENT keys count for HTTP reads but not for peer sync. An AGENT alone gets nothing private over the network, while a WRITER on a single page gives that peer the whole space's private blobs. Second, the `siteUrl` server is trusted because the home document says so. A space owner who points `siteUrl` at a hostile host grants that host the space's private blobs. This is by design, and in practice a private document needs a server. [Integrity](./integrity.md) lists this among the trusted parts. <!-- id:zESXNcTP -->

## No encryption <!-- id:_s1H1M1S -->

Private means access control on delivery. Nothing is encrypted. Any node that legitimately holds the blobs holds them in the clear, and a node's owner can read its own store. Visibility also cannot be revoked. What has been delivered to a peer stays there. <!-- id:iYCX4sLd -->

There are no read-only grants on private documents, no inheritance for the children of a private document, no access by link and no invitations. Without encryption, reading and syncing are the same permission.

# Working with private content <!-- id:RZqSX_dT -->

- In the [SDK](../build/sdk.md), `createVersionRef` and the other Ref builders accept a `visibility` option, and `createComment` does too, so a client can publish private Refs and comments itself. `PrepareDocumentChange` accepts `visibility`. Reading private content from a site needs the `Authorization: Bearer` header from `POST /hm/api/auth`. See [SDK](../build/sdk.md). <!-- id:6AP7MyE- -->
- The [Seed API](../build/web-api.md) on a site returns private resources only to requests carrying the auth cookie or an explicit bearer header whose principal passes the root-grant rule above. Otherwise they are absent from listings, and `Resource` reports them as not found. `GET /hm/api/file` and image routes forward the same cookie to the daemon. See [Web API](../build/web-api.md). <!-- id:KpChfFoG -->
- The [CLI](../build/cli.md) has no flag for private visibility and does not manage a bearer cookie, so it works with public content only.
- [Seed Agents](../agent.md) publish documents as public. A comment written by an agent inherits the visibility of what it replies to. The runtime sends no bearer token, so an agent cannot read private documents through a site.

# See also <!-- id:ZEH1bUk9 -->

- [Visibility](../visibility.md), [Ref](../ref.md), [Comment](../comment.md), [Capability](../capability.md) <!-- id:Nu4wuyOP -->
- [Identity](./identity.md), [Permissions](./permissions.md), [Integrity](./integrity.md), [Network](./network.md), [Sites](./sites.md) <!-- id:2qg6gojo -->
- [Glossary](../glossary.md) <!-- id:CVgi0Ulg -->

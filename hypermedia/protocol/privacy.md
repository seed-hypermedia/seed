---
name: Privacy
summary: A document or comment can be marked private, and this page explains who then receives its data, who may read it, and who can create private content.
---
Most Hypermedia content is public. It is signed, named by its hash, and free to copy. Some content should stay private, so the protocol lets you mark a [document](./documents.md) or a [comment](./comments.md) as private. Nodes then hand its [blobs](./blobs.md) only to peers and readers who can prove they belong to the [space](./spaces.md).

This page describes what the [daemon](../software/daemon.md) does. The [Seed desktop](../software/desktop.md) and [web](../software/web.md) apps cannot create a private document. A client that signs its own Refs can. <!-- id:JW-UMOhs -->

# How it works <!-- id:HEitzGwI -->

## Two visibility values <!-- id:5MBdl3xt -->

[Visibility](../visibility.md) is a string with two values: the empty string, which means public, and `Private`. Two kinds of blob carry it: [Ref](../ref.md) and [comment](../comment.md). These are the two kinds that place content somewhere. [Changes](../change.md) carry no visibility of their own, and [files](./files.md) do not either. <!-- id:PKEL938x -->

## Per blob, per space <!-- id:8z1idPs0 -->

The daemon keeps a table that says in which spaces each blob is visible. A public blob has one "everyone" row. A private blob has one row for each space that may see it. A blob with no visibility of its own takes it from whatever links to it:

- A Change takes it from the Change or Ref that depends on it.
- A file blob takes it from anything that links to it.

The order in which blobs arrive does not matter. A blob gets no visibility while the daemon doesn't hold it. When it arrives, it takes its visibility from the blobs that already link to it. Other links, such as an embed pinned to a document version, never change a Change's visibility. One public record wins: if any public Ref leads to a Change, that Change is public for everyone. <!-- id:WDS8_NWk -->

<!-- id:BMJ0IJ8B -->
| Blob <!-- col:sXtenxBO --> | Visibility <!-- col:AM-xyQOk --> <!-- id:SSO2_ONf --> |
| --- | --- |
| Change | none of its own. It becomes public when a public Ref leads to it. If only a private Ref leads to it, it is visible in that Ref's space <!-- id:HnhJ5VLw --> |
| Ref | explicit; a private Ref is visible in its own space and must use a single-segment path such as `/feedback-123` <!-- id:cHJX3lm1 --> |
| Comment | explicit; a private comment is visible to the commenter's space and the target's space; the daemon's `CreateComment` inherits the target document's visibility <!-- id:610WwsNn --> |
| [Capability](../capability.md), [Contact](./contacts.md), [Profile](../profile.md) | always public <!-- id:lRWlJCNm --> |
| DagPB and raw file blobs | inherited from whatever links to them <!-- id:VUqrUser --> |

Visibility sits on the Ref. So the same Changes can be private work in progress first, and become public later through a new public Ref. <!-- id:1IFBixEk -->

## Private documents cannot be created in the app <!-- id:0nwqhatV -->

The daemon's `PrepareChange` RPC refuses a private change unless the document is already private. It returns a failed-precondition error that says private document creation is disabled. The Seed desktop and web apps have no Private option. Two more rules apply:

- A [home document](./spaces.md) can never be private.
- A private path must be a single segment.

Private documents that exist keep working. Only that RPC refuses. The indexer does not. So a client that builds and signs its own Changes and a private Ref can publish a new private document, and every node indexes it. <!-- id:Z61_7G3f -->

The daemon's own `CreateRef` RPC publishes version Refs and tombstone Refs as public, whatever the document's visibility is. A client that publishes private documents signs its Refs itself. <!-- id:EpU3LQMr -->

## Who may read private content over HTTP <!-- id:WVM-iNfP -->

The daemon filters by visibility only in server mode (`-server-mode` or `SEED_SERVER_MODE=true`). Hosted [sites](./sites.md) and gateways run in server mode. In default mode the daemon accepts only callers on the same computer and trusts them, so they can read every blob. [Integrity](./integrity.md) describes both modes. <!-- id:ofQB_uNE -->

On a server-mode node, a request for private content must carry a bearer token that the daemon issued (see [Identity](./identity.md)). The daemon serves private content when the token's [principal](../principal.md), the key it names: <!-- id:cckJb-G0 -->
  - is the space owner, or <!-- id:GntVQvhc -->
  - holds a [WRITER or AGENT](./permissions.md) [capability](../capability.md) scoped to the **root** of the space, or <!-- id:rwwGSEZV -->
  - is an AGENT of a key that holds such a root grant. <!-- id:GVNNcPsq -->

A WRITER whose grant covers only a sub-path can write there, but cannot read private content there. The read rule is simply written that way. In server mode, even the owner's own daemon refuses its own private document to an HTTP request with no token. The [Seed web app](../software/web.md) passes the visitor's cookie to the daemon as that bearer token on every call. <!-- id:XdSIhVyZ -->

## How peers are gated <!-- id:COGK2cRq -->

Delivery between peers has its own rules. They do not depend on server mode. There are two layers. <!-- id:mgaHufcC -->
  - **Peer authentication.** A [peer](./network.md) proves it holds an account by signing a short-lived capability. The capability names the account and the server's peer, and must be less than one minute old. The server keeps that proof in memory for the connection. <!-- id:tDVMmEf5 -->
  - **Authorization.** A server gives a private blob to a peer only if one of these is true: the peer is on the allow list of a push that is in progress; the peer proved it is the space owner; the peer is the server the space names in its home document's `siteUrl` (the daemon fetches that site's `/hm/api/config` and compares the peer ID); or the peer proved it is an account that holds a **WRITER** capability for the space, at any path. <!-- id:VG44C2tX -->

The same filter applies when two peers compare what they hold. The server works out which spaces the peer may see, and computes its summaries over that filtered view only. So a peer with no access never learns that hidden blobs exist. A plain blob listing never lists private blobs. A daemon that holds a WRITER grant for a space proves its account by itself before it syncs with that space's site. <!-- id:JDJJ5Hwi -->

Two facts matter here.

- AGENT keys count for HTTP reads but not for peer sync. An AGENT alone gets nothing private over the network. A WRITER on a single page gives that peer the private blobs of the whole space.
- The `siteUrl` server is trusted because the home document says so. A space owner who points `siteUrl` at a hostile host gives that host the space's private blobs. This is by design: a private document needs a server. [Integrity](./integrity.md) lists this among the trusted parts. <!-- id:zESXNcTP -->

## No encryption <!-- id:_s1H1M1S -->

Private means that nodes control who receives the data. Nothing is encrypted. Any node that holds the blobs holds them as plain data, and a node's owner can read its own store. You also cannot take visibility back. What a peer has received stays there. <!-- id:iYCX4sLd -->

Private documents have no read-only grants, no access by link and no invitations. The children of a private document do not become private with it. Without encryption, reading and syncing are the same permission.

# Working with private content <!-- id:RZqSX_dT -->

- In the [SDK](../build/sdk.md), `createVersionRef` and the other Ref builders accept a `visibility` option, and `createComment` does too, so a client can publish private Refs and comments itself. `PrepareDocumentChange` accepts `visibility`. To read private content from a site, send the `Authorization: Bearer` header you get from `POST /hm/api/auth`. <!-- id:6AP7MyE- -->
- The [Seed API](../build/web-api.md) on a site returns private resources only to a request that carries the auth cookie or a bearer header, and whose principal passes the root-grant rule above. For any other request, listings leave them out and `Resource` reports them as not found. `GET /hm/api/file` and the image routes pass the same cookie to the daemon. <!-- id:KpChfFoG -->
- The [CLI](../build/cli.md) has no flag for private visibility and sends no bearer token, so it cannot read or publish private documents. A comment it writes on a private document is private, like its target.
- [Seed Agents](../agent.md) publish documents as public. A comment written by an agent takes the visibility of what it replies to. The runtime sends no bearer token, so an agent cannot read private documents through a site.

# See also <!-- id:ZEH1bUk9 -->

- [Visibility](../visibility.md), [Ref](../ref.md), [Comment](../comment.md), [Capability](../capability.md) <!-- id:Nu4wuyOP -->
- [Identity](./identity.md), [Permissions](./permissions.md), [Integrity](./integrity.md), [Network](./network.md), [Sites](./sites.md) <!-- id:2qg6gojo -->
- [Glossary](../glossary.md) <!-- id:CVgi0Ulg -->

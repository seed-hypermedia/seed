---
name: Daemon gRPC
summary: How to call the Seed daemon's gRPC services directly, what each service does, which RPCs are unimplemented, and why the daemon's ports must stay private.
---
Underneath every Seed site and every Seed app is one process, the Seed daemon. It holds the blobs, indexes them, syncs with peers, and answers a [gRPC](https://grpc.io/docs/what-is-grpc/introduction/) API. The web server, the desktop app and the CLI's local development mode are all clients of that API.

Most builders never need it. The [Seed API](./web-api.md) over HTTP and the [SDK](./sdk.md) cover reading, searching and publishing, and they work against any site on the network without running anything. Reach for gRPC when you run a daemon yourself and want what only it can do: manage keys, subscribe to spaces, drive sync and discovery, list peers, or query the index in ways the HTTP keys do not expose.

# Connecting

The daemon listens on three ports. Which numbers depends on who started it.

| Listener | Daemon default | Seed desktop app | Dev build of the app | Site container |
| --- | --- | --- | --- | --- |
| HTTP, with gRPC-Web at `/` | `55001` | `56001` | `58001` | `56001`, internal only |
| plain gRPC | `55002` | `56002` | `58002` | `56002`, internal only |
| libp2p | `55000` | `56000` | `58000` | `56000`, published |

Flags are `-http.port`, `-grpc.port` and `-p2p.port`; every flag can also be an environment variable with the `SEED_` prefix, so `-http.port` is `SEED_HTTP_PORT`. The full flag list is on the [daemon page](../apps/daemon.md).

The plain gRPC port speaks standard gRPC with [server reflection](https://grpc.io/docs/guides/reflection/) enabled, so [grpcurl](https://github.com/fullstorydev/grpcurl) can explore it without the proto files. Against a running desktop app:

```sh
grpcurl -plaintext localhost:56002 list
```

```
com.seed.activity.v1alpha.ActivityFeed
com.seed.activity.v1alpha.Subscriptions
com.seed.daemon.v1alpha.Daemon
com.seed.documents.v3alpha.AccessControl
com.seed.documents.v3alpha.Comments
com.seed.documents.v3alpha.Documents
com.seed.documents.v3alpha.Resources
com.seed.entities.v1alpha.Entities
com.seed.networking.v1alpha.Networking
com.seed.p2p.v1alpha.P2P
com.seed.p2p.v1alpha.Syncing
com.seed.payments.v1alpha.Invoices
com.seed.payments.v1alpha.Wallets
com.seed.telemetry.v1alpha.Telemetry
grpc.reflection.v1.ServerReflection
grpc.reflection.v1alpha.ServerReflection
```

```sh
grpcurl -plaintext localhost:56002 com.seed.daemon.v1alpha.Daemon/GetInfo
```

```json
{
  "state": "ACTIVE",
  "peerId": "12D3KooWGZRLjYnJpZUQBFYu5qUqPK2rW2rA62GtdRSXGw6KvExz",
  "startTime": "2026-09-16T18:15:28.665346Z",
  "protocolId": "/hypermedia/0.9.2"
}
```

`grpcurl … describe com.seed.documents.v3alpha.Documents` prints a service's RPCs and message types. The HTTP port carries the same services as [gRPC-Web](https://github.com/grpc/grpc-web), which is what the browser-based clients use; the desktop app and the web server both connect with `@connectrpc/connect` transports to the HTTP port, never to the raw gRPC port. The daemon also embeds a [grpcui](https://github.com/fullstorydev/grpcui) at `http://localhost:<http-port>/debug/grpcui/`, reachable only from the same machine.

Message definitions live in the repository under `proto/`, one folder per service family, and generated clients are committed beside them: Go under `backend/genproto` and TypeScript under `frontend/packages/shared/src/client/.generated`. The TypeScript package exposes `createGRPCClient(transport)` with one property per service. After editing a proto file, `./dev gen` regenerates both.

# There is no authentication

Say it plainly: the daemon's API has no authentication or authorization of its own. Anyone who can reach the gRPC or HTTP port can list keys, sign arbitrary bytes with any stored key, export keys, delete keys, store blobs, create refs and capabilities with any registered key, force a reindex, and read everything the daemon holds. Both ports bind all interfaces, not loopback, and the HTTP port answers any origin.

Write RPCs are authorized by the **signing key**, not the caller. Every write takes a `signing_key_name`; the daemon loads that key from its own store and checks that it may write to the target space and path. The question "may this caller write" is never asked. Comments skip even that: anyone may comment on anything.

The one piece of caller identity is the bearer token. `Daemon.Authenticate` proves possession of an account key and returns a token valid for thirty days; the HTTP middleware accepts it as `Authorization: Bearer <token>`. It is used for one purpose only: when the daemon runs with `-public-only`, private content is hidden from anonymous requests and shown to authenticated callers who may write the space. Without that flag, the token changes nothing. The plain gRPC port ignores it entirely.

So the mitigations are deployment, not configuration. A desktop app's daemon is reachable only on the local machine. A site's daemon publishes only its libp2p port outside the container network; its HTTP and gRPC ports are reachable by the web server alone, and the reverse proxy forwards only `/ipfs/*` to it. If you run a daemon yourself, keep the two API ports behind a firewall or bound to a private interface. [Integrity](../protocol/integrity.md) puts this in the larger picture of what the protocol does and does not verify.

# Conventions

**Addressing.** A space is named by its `account`, the principal string of its key. A document is `account` plus `path`, where the empty path is the home document. A `version` is one or more [Change](../change.md) ids joined by `.`; an empty version means latest. Comments and contacts are addressed as `<author>/<tsid>`. The proto files still say `account` where the rest of the documentation says space; a rename is on the backend team's list.

**Pagination.** Requests take `page_size` and `page_token`; responses return `next_page_token`. Tokens are opaque cursors. A page size of zero or less means the handler's default, which differs by RPC between 10 and 100; document listings cap larger requests at 2000. Some listings ignore paging and return everything; they are marked below.

**Redirects.** `GetDocument` on a path that holds a redirect [Ref](../ref.md) fails with `FailedPrecondition` and attaches `RedirectErrorDetails {target_account, target_path, republish}` to the status. `GetDocumentInfo` returns the redirect as data instead of failing. Follow redirects with a cycle guard.

**Status codes.**

| Code | Meaning in this API |
| --- | --- |
| `InvalidArgument` | unparsable principal, id, version or page token; a missing required field |
| `NotFound` | unknown key name, document, version or tracked domain |
| `FailedPrecondition` | the path holds a redirect; a Ref with a different genesis and no higher generation; discovery disabled; vault not connected |
| `PermissionDenied` | the signing key may not write there; private content on a public-only node; a capability whose signer is not the account |
| `Unauthenticated` | a bearer token that is malformed, expired or unknown (HTTP `401`) |
| `Unavailable` | `StoreBlobs` during a reindex, retry later; syncing disabled |
| `Unimplemented` | see the catalogue |
| `Internal` | storage failures and recovered panics |

# Service catalogue

The daemon registers fourteen services, plus gRPC reflection. Each table lists every RPC with one line. Unimplemented RPCs still appear in the proto files and in reflection; calling them returns `Unimplemented`.

## Daemon

Node management, keys, authentication, the vault connection, and the domain tracker.

| RPC | What it does |
| --- | --- |
| `GetInfo` | state (`STARTING`, `MIGRATING`, `ACTIVE`), peer id, start time, protocol id, running tasks such as a reindex |
| `GenMnemonic` | a fresh BIP-39 phrase, 12 words by default; stateless |
| `RegisterKey` | derive a key from a mnemonic and store it under a name; the empty name becomes the public key string |
| `ImportKey` | load a `.hmkey.json` from an absolute path on the daemon's filesystem; stored under its public key, not a label |
| `ExportKey` | write a key file, optionally password-encrypted, to an absolute path on the daemon's filesystem |
| `ListKeys`, `UpdateKey`, `DeleteKey`, `DeleteAllKeys` | list, rename, delete; `account_id` always equals `public_key` |
| `SignData` | sign arbitrary bytes with any stored key |
| `StoreBlobs` | store blobs atomically; a given `cid` is verified against the data, an omitted one is computed with BLAKE2b; structural blobs are verified and indexed; refused with `Unavailable` during reindex |
| `Authenticate` | prove an account key and receive a thirty-day bearer token; the principal must already appear in some blob the daemon holds |
| `ForceReindex` | rebuild every derived table from the stored blobs, synchronously |
| `ForceSync` | **Unimplemented** |
| `GetVaultStatus`, `StartVaultConnection`, `DisconnectVault`, `GetVaultEmail`, `ChangeVaultEmailStart`, `ChangeVaultEmailVerify`, `GetVaultPasswordStatus`, `SetVaultMasterPassword`, `GetVaultNotificationServer`, `SetVaultNotificationServer` | the connection between this daemon and a remote vault that holds the user's keys; see [identity](../protocol/identity.md) |
| `GetDomain`, `ListDomains`, `AddDomain`, `RemoveDomain`, `CheckDomain` | the tracker that polls `https://<domain>/hm/api/config` and caches each site's peer id, registered account and gateway flag |

## Documents

The document model: reading, preparing changes, refs, accounts, profiles, contacts, listings and attribute queries. The proto file itself warns that this service is a kitchen sink.

| RPC | What it does |
| --- | --- |
| `GetDocument` | a document at a version or latest; fails with redirect details on a redirect path |
| `GetDocumentInfo`, `BatchGetDocumentInfo` | metadata, authors, breadcrumbs, activity summary, generation and redirect info, without the body |
| `PrepareChange` | build an unsigned Change from edit operations against a base version; the client signs it and calls `StoreBlobs`. Creating a **private** document this way is refused outside tests |
| `DeleteDocument` | **Unimplemented**; publish a tombstone Ref with `CreateRef` |
| `CreateRef`, `GetRef`, `ListRefs` | publish a version, tombstone or redirect Ref signed by a named key; timestamps round to milliseconds; a different genesis needs a higher generation. `ListRefs` ignores paging |
| `ListAccounts`, `GetAccount`, `BatchGetAccounts` | accounts known to this node with their home document info, profile and alias |
| `UpdateProfile` | publish a Profile blob; the key must write the space root |
| `CreateAlias` | link this key to another account; needs an AGENT capability |
| `CreateContact`, `GetContact`, `UpdateContact`, `DeleteContact`, `ListContacts` | contact records; `ListContacts` filters by issuing account or by subject |
| `ListDirectory` | children of a path, optionally recursive, with sort options |
| `ListDocuments`, `ListRootDocuments`, `ListUnreferencedDocuments` | all documents, home documents, or documents whose parent does not link to them |
| `QueryDocuments` | filter by attributes, path, space and URL with and/or/not, sorted by built-in or user attributes; the [query grammar](./query-grammar.md) |
| `ListDocumentAttributeNames`, `ListDocumentAttributeValues` | which attribute keys exist and which values a key takes, for autocomplete |
| `ListDocumentChanges`, `GetDocumentChange` | the change history of a document and one change's author, deps and time |
| `UpdateDocumentReadStatus` | local read or unread state, never published |

## AccessControl

| RPC | What it does |
| --- | --- |
| `ListCapabilities` | capabilities that apply to a space and path; `path="*"` means all. `ignore_inherited=true` is **Unimplemented** |
| `ListCapabilitiesForDelegate` | capabilities granted to one principal |
| `CreateCapability` | sign a capability delegating `WRITER` or `AGENT`; the signing key must be the account itself, so there is no re-delegation, and `no_recursive=true` is **Unimplemented** |
| `GetCapability` | one capability by id |

There is no `RevokeCapability`; [permissions](../protocol/permissions.md) explains what that means in practice.

## Comments

| RPC | What it does |
| --- | --- |
| `CreateComment` | publish a comment on a document version, optionally as a reply; visibility is inherited from the target at creation. Passing `capability` is **Unimplemented** |
| `GetComment`, `BatchGetComments` | by record id `<author>/<tsid>`, or by version id |
| `ListComments` | every comment on a document; paging parameters are ignored |
| `ListCommentsByAuthor` | comments by one account |
| `UpdateComment` | replace a comment with a full new snapshot |
| `DeleteComment` | the signing key must be the author |
| `GetCommentReplyCount`, `ListCommentVersions` | reply count; every version of one comment, newest first |

## Resources

| RPC | What it does |
| --- | --- |
| `GetResource` | resolve an `hm://` or `https://` IRI to a document, comment or contact; web URLs are resolved through the host's `/hm/api/config`, so the daemon makes outbound HTTPS requests |
| `ListCitations` | who links to, embeds or mentions a resource, in the order this node learned of them |
| `PushResourcesToPeer` | announce documents to a specific peer and stream progress; what the desktop calls to publish to a site |

## Entities

| RPC | What it does |
| --- | --- |
| `DiscoverEntity` | ask the network for a document, a subtree (`hm://uid/path/*` or `/**`) or a profile; returns the cached state and progress immediately, and refuses with `FailedPrecondition` when discovery is disabled |
| `SearchEntities` | full-text search over documents, comments and contacts with filters, plus semantic and hybrid modes when an embedding model is configured |
| `ListEntityMentions` | deprecated; use `Resources.ListCitations` |
| `GetChange`, `GetEntityTimeline`, `DeleteEntity`, `ListDeletedEntities`, `UndeleteEntity` | **Unimplemented** |

## ActivityFeed and Subscriptions

| RPC | What it does |
| --- | --- |
| `ActivityFeed.ListEvents` | new blobs and mentions this node has seen, filtered by author, event type or resource, ordered by claimed or observed time |
| `Subscriptions.Subscribe` | subscribe to a space or path so the node keeps it synced; also triggers discovery and, unless `async`, blocks until the resource is local |
| `Subscriptions.Unsubscribe` | stop |
| `Subscriptions.ListSubscriptions` | everything subscribed; paging ignored |

## Networking

| RPC | What it does |
| --- | --- |
| `GetPeerInfo` | a peer's addresses, connection status and account binding |
| `ListPeers` | known peers without their addresses; call `GetPeerInfo` per peer |
| `Connect` | dial a multiaddr or a bare peer id now |

## P2P and Syncing, the peer protocol

These are the RPCs peers exchange over libp2p; the [network page](../protocol/network.md) explains the protocol. The daemon also re-exports them on its local gRPC server as a proxy: attach a `target-peer` metadata key holding a peer id, and the call is forwarded to that peer. This is how you inspect what another node offers.

| RPC | What it does |
| --- | --- |
| `P2P.ListBlobs` | stream the ids of every public blob, from a cursor |
| `P2P.ListPeers`, `P2P.ListSpaces` | peer exchange and the spaces a node holds |
| `P2P.Authenticate` | prove an account key to a peer for this connection, which unlocks that account's private blobs |
| `P2P.RequestInvoice` | Lightning invoice; `Unimplemented` until payments are wired |
| `Syncing.ReconcileBlobs` | range-based set reconciliation of blob sets per scope |
| `Syncing.AnnounceBlobs` | the receiving end of a push |

## Wallets and Invoices

Lightning wallets through a hosted [lndhub](https://github.com/getAlby/lndhub.go) at `ln.seed.hyper.media` (or the testnet host without `-lndhub.mainnet`): `CreateWallet`, `ImportWallet`, `ExportWallet`, `RemoveWallet`, `ListWallets`, `GetWallet`, `GetWalletBalance`, `UpdateWalletName`, `GetDefaultWallet`, `SetDefaultWallet`; `CreateInvoice`, `PayInvoice`, `DecodeInvoice`, `ListPaidInvoices`, `ListReceivedInvoices`. An `LNURL` service exists in the proto files but is never registered.

## Telemetry

`RecordCheckpoints` appends client-side timing checkpoints to an in-memory buffer shown on the daemon's `/debug/journeys` page. The proto comment claims it is loopback-only; it is registered on the public server like everything else.

# The daemon's own HTTP routes

Besides gRPC-Web, the HTTP port serves a few plain routes. Debug pages answer only to the local machine and refuse browser requests from another origin, so `curl` works and an iframe does not.

| Route | Purpose |
| --- | --- |
| `GET /ipfs/<cid>` | bytes of a blob or file, with range support; searches the network for up to a minute when unknown |
| `GET /ipfs/<cid>.dagjson` | a structural blob decoded to DAG-JSON |
| `POST /ipfs/file-upload` | multipart `file` up to 150 MiB, chunked into UnixFS; answers `201` with the root id |
| `POST /ipfs/<cid>` | store one raw block whose hash must match |
| `GET /hm/api/config` | `{peerId, addrs, protocolId}`; the web server's version adds the registered account |
| `GET /debug/version` | `{branch, commit, date}` |
| `POST /vault-connect` | completes a browser-mediated vault connection with a short-lived token |
| `/debug/metrics`, `/debug/pprof/`, `/debug/vars`, `/debug/requests`, `/debug/events`, `/debug/traces`, `/debug/p2p`, `/debug/network`, `/debug/sqlite`, `/debug/grpcui/`, `/debug/journeys`, `/debug/logs`, `/debug/buildinfo` | operator pages, local only |

# Working with it

## In the Seed app

The desktop app is a gRPC-Web client of its bundled daemon on port `56001`. You can open `http://localhost:56001/debug/grpcui/` in a browser on the same machine and call any RPC by hand.

## CLI

The Seed CLI signs locally and talks to a site's [Seed API](./web-api.md). The one exception is `seed-cli space dev`, which registers its dev key in the desktop dev app's daemon over gRPC-Web (`--daemon`, default `http://localhost:58001`) and publishes through the app's HTTP bridge. For raw daemon calls use `grpcurl` as above.

## SDK

`@seed-hypermedia/client` has no gRPC dependency by design, so it runs in browsers, Bun, Node and React Native. When you need the daemon, take the generated TypeScript clients from the shared package in the repository and a gRPC-Web transport pointed at the HTTP port; the desktop app and `seed-cli space dev` use `@connectrpc/connect-web`, and the web server uses `@connectrpc/connect-node`.

## Agents

Seed Agents run beside a site and use the Seed API, not gRPC. An external agent operating a machine with a daemon can use `grpcurl` from its shell; anything it can reach it can fully control, which is one more reason to keep daemon ports off the network.

# See also

- [Seed API](./web-api.md), the HTTP surface built on top of these services
- [Daemon](../apps/daemon.md), flags, data directory and how the apps launch it
- [Network](../protocol/network.md), what the P2P and Syncing services do between peers
- [Integrity](../protocol/integrity.md), the trust model and its limits
- [Contributing](./contributing.md), regenerating clients after a proto change

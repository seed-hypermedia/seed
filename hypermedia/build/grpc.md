---
name: Daemon gRPC
summary: How to call the Seed daemon's gRPC services directly, what each service does, which RPCs are unimplemented, and why the daemon's ports must stay private.
---
Underneath every Seed [site](../protocol/sites.md) and every Seed app is one process, the [Seed daemon](../apps/daemon.md). It holds the [blobs](../protocol/blobs.md), indexes them, [syncs](../protocol/network.md) with [peers](../protocol/network.md), and answers a [gRPC](https://grpc.io/docs/what-is-grpc/introduction/) API. The [web server](../apps/web.md), the [desktop app](../apps/desktop.md) and the [CLI](./cli.md)'s local development mode are all clients of that API. <!-- id:AtdDkP_3 -->

Most builders never need it. The [Seed API](./web-api.md) over HTTP and the [SDK](./sdk.md) cover reading, searching and publishing, and they work against any site on the network without running anything. Use gRPC when you run a daemon yourself and want what only it can do: manage [keys](./keys.md), subscribe to [spaces](../protocol/identity.md), drive sync and [discovery](../protocol/network.md), list peers, or query the index in ways the HTTP keys do not expose. <!-- id:armhSvIl -->

# Connecting <!-- id:RAt1sPiu -->

The daemon listens on three ports. Which numbers depends on who started it. <!-- id:fH2JGU0z -->

<!-- id:W32dRBdY -->
| Listener <!-- col:kdptVdiV --> | Daemon default <!-- col:z2-jw3dJ --> | Seed desktop app <!-- col:4lWHQsob --> | Dev build of the app <!-- col:GDOrAZrw --> | Site container <!-- col:aEVoHIN7 --> <!-- id:HoJxFMo_ --> |
| --- | --- | --- | --- | --- |
| HTTP, with gRPC-Web at `/` | `55001` | `56001` | `58001` | `56001`, internal only <!-- id:6IgJvLW8 --> |
| plain gRPC | `55002` | `56002` | `58002` | `56002`, internal only <!-- id:fWgTcgfm --> |
| libp2p | `55000` | `56000` | `58000` | `56000`, published <!-- id:WL0QYAWO --> |

Flags are `-http.port`, `-grpc.port` and `-p2p.port`. Every flag can also be an environment variable with the `SEED_` prefix, so `-http.port` is `SEED_HTTP_PORT`. The full flag list is on the [daemon page](../apps/daemon.md). <!-- id:2G6IKYHJ -->

The plain gRPC port speaks standard gRPC with [server reflection](https://grpc.io/docs/guides/reflection/) enabled, so [grpcurl](https://github.com/fullstorydev/grpcurl) can explore it without the proto files. Against a running desktop app: <!-- id:XdSqTtMJ -->

```sh <!-- id:xqpQ1m72 -->
grpcurl -plaintext localhost:56002 list
```

``` <!-- id:6zzRLzEK -->
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

```sh <!-- id:7eGD-y8y -->
grpcurl -plaintext localhost:56002 com.seed.daemon.v1alpha.Daemon/GetInfo
```

```json <!-- id:d0w4bnD7 -->
{
  "state": "ACTIVE",
  "peerId": "12D3KooWGZRLjYnJpZUQBFYu5qUqPK2rW2rA62GtdRSXGw6KvExz",
  "startTime": "2026-09-16T18:15:28.665346Z",
  "protocolId": "/hypermedia/0.9.2"
}
```

`grpcurl … describe com.seed.documents.v3alpha.Documents` prints a service's RPCs and message types. The HTTP port carries the same services as [gRPC-Web](https://github.com/grpc/grpc-web), which is what the browser-based clients use. The desktop app and the web server both connect with `@connectrpc/connect` transports to the HTTP port, never to the raw gRPC port. The daemon also embeds a [grpcui](https://github.com/fullstorydev/grpcui) at `http://localhost:<http-port>/debug/grpcui/`, reachable only from the same machine. <!-- id:VSFr5IT3 -->

Message definitions live in the repository under `proto/`, one folder per service family, and generated clients are committed beside them: Go under `backend/genproto` and TypeScript under `frontend/packages/shared/src/client/.generated`. The TypeScript package exposes `createGRPCClient(transport)` with one property per service. After editing a proto file, `./dev gen` regenerates both. <!-- id:R6ZNPlbM -->

# There is no authentication <!-- id:3Nue2Gcl -->

The daemon's API has no authentication or authorization of its own. Anyone who can reach the gRPC or HTTP port can list keys, sign arbitrary bytes with any stored key, export keys, delete keys, store blobs, create [refs](../ref.md) and [capabilities](../protocol/permissions.md) with any registered key, force a reindex, and read everything the daemon holds. Both ports bind all network interfaces, and the HTTP port answers any origin. <!-- id:4SSdtRrf -->

Write RPCs check the **signing key**. Every write takes a `signing_key_name`. The daemon loads that key from its own store and checks that it may write to the target space and path. It never asks whether the caller may write. [Comments](../protocol/comments.md) skip even that check: anyone may comment on anything. <!-- id:azQnlNR4 -->

The one piece of caller identity is the bearer token. `Daemon.Authenticate` proves possession of an account key and returns a token valid for thirty days. The HTTP middleware accepts it as `Authorization: Bearer <token>`. It has one use. When the daemon runs with `-public-only`, [private](../protocol/privacy.md) content is hidden from anonymous requests and shown to authenticated callers who may write the space. Without that flag, the token changes nothing. The plain gRPC port ignores it entirely. <!-- id:2ZbFPpFN -->

The protection comes from how you deploy the daemon. No setting adds it. A desktop app's daemon is reachable only on the local machine. A site's daemon publishes only its libp2p port outside the container network. Its HTTP and gRPC ports are reachable by the web server alone, and the reverse proxy forwards only `/ipfs/*` to it. If you run a daemon yourself, keep the two API ports behind a firewall or bound to a private interface. [Integrity](../protocol/integrity.md) puts this in the larger picture of what the protocol does and does not verify. <!-- id:TEErbvtS -->

# Conventions <!-- id:Vz0vDuSz -->

**Addressing.** A space is named by its `account`, the [principal](../principal.md) string of its key. A [document](../protocol/documents.md) is `account` plus `path`, where the empty path is the home document. A [`version`](../protocol/documents.md) is one or more [Change](../change.md) ids joined by `.`. An empty version means latest. Comments and [contacts](../protocol/permissions.md) are addressed as `<author>/<tsid>`. The proto files still say `account` where the rest of the documentation says space. A rename is on the backend team's list. <!-- id:JWCK5xyS -->

**Pagination.** Requests take `page_size` and `page_token`. Responses return `next_page_token`. Tokens are opaque cursors. A page size of zero or less means the handler's default, which differs by RPC between 10 and 100. Document listings cap larger requests at 2000. Some listings ignore paging and return everything. They are marked below. <!-- id:Rk8oOcYE -->

**Redirects.** `GetDocument` on a path that holds a redirect [Ref](../ref.md) fails with `FailedPrecondition` and attaches `RedirectErrorDetails {target_account, target_path, republish}` to the status. `GetDocumentInfo` returns the redirect as data instead of failing. Follow redirects with a cycle guard. <!-- id:2YPmZcPx -->

**Status codes.** <!-- id:fBu69C4Q -->

<!-- id:iBez1HSs -->
| Code <!-- col:KBg35977 --> | Meaning in this API <!-- col:_Bn9z9XT --> <!-- id:kp7UCi36 --> |
| --- | --- |
| `InvalidArgument` | unparsable principal, id, version or page token; a missing required field <!-- id:0NF3j4pG --> |
| `NotFound` | unknown key name, document, version or tracked domain <!-- id:eMe9EPRd --> |
| `FailedPrecondition` | the path holds a redirect; a Ref with a different genesis and no higher generation; discovery disabled; vault not connected <!-- id:CN_GoRhE --> |
| `PermissionDenied` | the signing key may not write there; private content on a public-only node; a capability whose signer is not the account <!-- id:EisdCLVd --> |
| `Unauthenticated` | a bearer token that is malformed, expired or unknown (HTTP `401`) <!-- id:E2bbm9Dz --> |
| `Unavailable` | `StoreBlobs` during a reindex, retry later; syncing disabled <!-- id:_h0IAYut --> |
| `Unimplemented` | see the catalogue <!-- id:IguL-1Ui --> |
| `Internal` | storage failures and recovered panics <!-- id:g1MTpY9v --> |

# Service catalogue <!-- id:g173tksb -->

The daemon registers fourteen services, plus gRPC reflection. Each table lists every RPC with one line. Unimplemented RPCs still appear in the proto files and in reflection. Calling them returns `Unimplemented`. <!-- id:Hyqerhp3 -->

## Daemon <!-- id:wJpLuWCE -->

Node management, keys, authentication, the vault connection, and the domain tracker. <!-- id:EPAP0JCA -->

<!-- id:wYFE4qLl -->
| RPC <!-- col:TxDtVoZt --> | What it does <!-- col:i6AnQcPl --> <!-- id:HjcmfJsc --> |
| --- | --- |
| `GetInfo` | state (`STARTING`, `MIGRATING`, `ACTIVE`), peer id, start time, protocol id, running tasks such as a reindex <!-- id:Ve8vGSiN --> |
| `GenMnemonic` | a fresh BIP-39 phrase, 12 words by default; stateless <!-- id:JyLCXv0h --> |
| `RegisterKey` | derive a key from a mnemonic and store it under a name; the empty name becomes the public key string <!-- id:txeTjaCA --> |
| `ImportKey` | load a `.hmkey.json` from an absolute path on the daemon's filesystem; stored under its public key, not a label <!-- id:-vM9eQUU --> |
| `ExportKey` | write a key file, optionally password-encrypted, to an absolute path on the daemon's filesystem <!-- id:pEwMZyCM --> |
| `ListKeys`, `UpdateKey`, `DeleteKey`, `DeleteAllKeys` | list, rename, delete; `account_id` always equals `public_key` <!-- id:T42h8vEP --> |
| `SignData` | sign arbitrary bytes with any stored key <!-- id:E9Wj5A3z --> |
| `StoreBlobs` | store blobs atomically; a given `cid` is verified against the data, an omitted one is computed with BLAKE2b; structural blobs are verified and indexed; refused with `Unavailable` during reindex <!-- id:byF9be6U --> |
| `Authenticate` | prove an account key and receive a thirty-day bearer token; the principal must already appear in some blob the daemon holds <!-- id:OCk7HIdK --> |
| `ForceReindex` | rebuild every derived table from the stored blobs, synchronously <!-- id:4GS93KkB --> |
| `ForceSync` | **Unimplemented** <!-- id:AdsoyRhN --> |
| `GetVaultStatus`, `StartVaultConnection`, `DisconnectVault`, `GetVaultEmail`, `ChangeVaultEmailStart`, `ChangeVaultEmailVerify`, `GetVaultPasswordStatus`, `SetVaultMasterPassword`, `GetVaultNotificationServer`, `SetVaultNotificationServer` | the connection between this daemon and a remote vault that holds the user's keys; see [identity](../protocol/identity.md) <!-- id:vU-8B5FH --> |
| `GetDomain`, `ListDomains`, `AddDomain`, `RemoveDomain`, `CheckDomain` | the tracker that polls `https://<domain>/hm/api/config` and caches each site's peer id, registered account and gateway flag <!-- id:a8QmL8Y2 --> |

## Documents <!-- id:DonHOwN8 -->

The document model: reading, preparing changes, refs, accounts, profiles, contacts, listings and attribute queries. The proto file itself warns that this service is a kitchen sink. <!-- id:WC2edTjV -->

<!-- id:f2kan-mC -->
| RPC <!-- col:BW57KBHI --> | What it does <!-- col:VhuwMmiJ --> <!-- id:ZTSCeuQW --> |
| --- | --- |
| `GetDocument` | a document at a version or latest; fails with redirect details on a redirect path <!-- id:WDFqgVON --> |
| `GetDocumentInfo`, `BatchGetDocumentInfo` | metadata, authors, breadcrumbs, activity summary, generation and redirect info, without the body <!-- id:DKb6iAsE --> |
| `PrepareChange` | build an unsigned Change from edit operations against a base version; the client signs it and calls `StoreBlobs`. Creating a **private** document this way is refused outside tests <!-- id:esQBn9SY --> |
| `DeleteDocument` | **Unimplemented**; publish a tombstone Ref with `CreateRef` <!-- id:cTOtpKxH --> |
| `CreateRef`, `GetRef`, `ListRefs` | publish a version, tombstone or redirect Ref signed by a named key; timestamps round to milliseconds; a different genesis needs a higher generation. `ListRefs` ignores paging <!-- id:Iacs_6dU --> |
| `ListAccounts`, `GetAccount`, `BatchGetAccounts` | accounts known to this node with their home document info, profile and alias <!-- id:EiaW2hQ1 --> |
| `UpdateProfile` | publish a Profile blob; the key must write the space root <!-- id:at1YTY6i --> |
| `CreateAlias` | link this key to another account; needs an AGENT capability <!-- id:Z09-qqEW --> |
| `CreateContact`, `GetContact`, `UpdateContact`, `DeleteContact`, `ListContacts` | contact records; `ListContacts` filters by issuing account or by subject <!-- id:FAXXY9DD --> |
| `ListDirectory` | children of a path, optionally recursive, with sort options <!-- id:Qd-Roq2- --> |
| `ListDocuments`, `ListRootDocuments`, `ListUnreferencedDocuments` | all documents, home documents, or documents whose parent does not link to them <!-- id:zdXcOt5T --> |
| `QueryDocuments` | filter by attributes, path, space and URL with and/or/not, sorted by built-in or user attributes; the [query grammar](./query-grammar.md) <!-- id:157XFRFC --> |
| `ListDocumentAttributeNames`, `ListDocumentAttributeValues` | which attribute keys exist and which values a key takes, for autocomplete <!-- id:3s2_lPkk --> |
| `ListDocumentChanges`, `GetDocumentChange` | the change history of a document and one change's author, deps and time <!-- id:IuLuH2Ww --> |
| `UpdateDocumentReadStatus` | local read or unread state, never published <!-- id:poeMouMF --> |

## AccessControl <!-- id:V2DlZ0VS -->

<!-- id:CJTYsusM -->
| RPC <!-- col:hztrVXyN --> | What it does <!-- col:Z1OeTSA1 --> <!-- id:md9Eostf --> |
| --- | --- |
| `ListCapabilities` | capabilities that apply to a space and path; `path="*"` means all. `ignore_inherited=true` is **Unimplemented** <!-- id:C7FdeBnm --> |
| `ListCapabilitiesForDelegate` | capabilities granted to one principal <!-- id:tfcZBA8c --> |
| `CreateCapability` | sign a capability delegating `WRITER` or `AGENT`; the signing key must be the account itself, so there is no re-delegation, and `no_recursive=true` is **Unimplemented** <!-- id:8ZOxQLuf --> |
| `GetCapability` | one capability by id <!-- id:E14JlBty --> |

There is no `RevokeCapability`. [Permissions](../protocol/permissions.md) explains what that means in practice. <!-- id:AMkgwRux -->

## Comments <!-- id:QYuY-NaV -->

<!-- id:m8TtjFuX -->
| RPC <!-- col:Fax0mXeS --> | What it does <!-- col:r5Fkh4aE --> <!-- id:pSjymC-H --> |
| --- | --- |
| `CreateComment` | publish a comment on a document version, optionally as a reply; visibility is inherited from the target at creation. Passing `capability` is **Unimplemented** <!-- id:ittq-OrC --> |
| `GetComment`, `BatchGetComments` | by record id `<author>/<tsid>`, or by version id <!-- id:vnSF87M2 --> |
| `ListComments` | every comment on a document; paging parameters are ignored <!-- id:1Cw4vkuX --> |
| `ListCommentsByAuthor` | comments by one account <!-- id:CqEZ7LW5 --> |
| `UpdateComment` | replace a comment with a full new snapshot <!-- id:zRR10PuG --> |
| `DeleteComment` | the signing key must be the author <!-- id:i4haeNU9 --> |
| `GetCommentReplyCount`, `ListCommentVersions` | reply count; every version of one comment, newest first <!-- id:YioAxH2E --> |

## Resources <!-- id:WDLSFw3p -->

<!-- id:tqVl1TR_ -->
| RPC <!-- col:EXGU_YH- --> | What it does <!-- col:PBA-XBKY --> <!-- id:yK9E7DKl --> |
| --- | --- |
| `GetResource` | resolve an `hm://` or `https://` IRI to a document, comment or contact; web URLs are resolved through the host's `/hm/api/config`, so the daemon makes outbound HTTPS requests <!-- id:aGXJIOva --> |
| `ListCitations` | who links to, embeds or mentions a resource, in the order this node learned of them <!-- id:u4-yqcky --> |
| `PushResourcesToPeer` | announce documents to a specific peer and stream progress; what the desktop calls to publish to a site <!-- id:BBaymRVK --> |

## Entities <!-- id:H8pgHv6y -->

<!-- id:nfK8w_bi -->
| RPC <!-- col:Pj2_nfN4 --> | What it does <!-- col:8zw5oQ3H --> <!-- id:2yZjP0ga --> |
| --- | --- |
| `DiscoverEntity` | ask the network for a document, a subtree (`hm://uid/path/*` or `/**`) or a profile; returns the cached state and progress immediately, and refuses with `FailedPrecondition` when discovery is disabled <!-- id:Nd_kAFFX --> |
| `SearchEntities` | full-text search over documents, comments and contacts with filters, plus semantic and hybrid modes when an embedding model is configured <!-- id:4zTWzN-x --> |
| `ListEntityMentions` | deprecated; use `Resources.ListCitations` <!-- id:LprWsyrz --> |
| `GetChange`, `GetEntityTimeline`, `DeleteEntity`, `ListDeletedEntities`, `UndeleteEntity` | **Unimplemented** <!-- id:oyF5CbTN --> |

## ActivityFeed and Subscriptions <!-- id:knBXy3q0 -->

<!-- id:9TdMm-Zq -->
| RPC <!-- col:U5a3duSq --> | What it does <!-- col:p8Qq1TGs --> <!-- id:V8QZe8tr --> |
| --- | --- |
| `ActivityFeed.ListEvents` | new blobs and mentions this node has seen, filtered by author, event type or resource, ordered by claimed or observed time <!-- id:VzyvSewi --> |
| `Subscriptions.Subscribe` | subscribe to a space or path so the node keeps it synced; also triggers discovery and, unless `async`, blocks until the resource is local <!-- id:M8zbQXUm --> |
| `Subscriptions.Unsubscribe` | stop <!-- id:TgCNvNzf --> |
| `Subscriptions.ListSubscriptions` | everything subscribed; paging ignored <!-- id:vYABPl1d --> |

## Networking <!-- id:FS1D-pL1 -->

<!-- id:xmADYZof -->
| RPC <!-- col:xT5yJXtH --> | What it does <!-- col:h9031qXY --> <!-- id:eQlFZ8vX --> |
| --- | --- |
| `GetPeerInfo` | a peer's addresses, connection status and account binding <!-- id:qIJg5Syw --> |
| `ListPeers` | known peers without their addresses; call `GetPeerInfo` per peer <!-- id:YNx196XN --> |
| `Connect` | dial a multiaddr or a bare peer id now <!-- id:DRO48bDF --> |

## P2P and Syncing, the peer protocol <!-- id:1o3_Sj0o -->

These are the RPCs peers exchange over libp2p. The [network page](../protocol/network.md) explains the protocol. The daemon also re-exports them on its local gRPC server as a proxy: attach a `target-peer` metadata key holding a peer id, and the call is forwarded to that peer. This is how you inspect what another node offers. <!-- id:SqnR5O68 -->

<!-- id:0bZ6RgYy -->
| RPC <!-- col:-OYuAWT- --> | What it does <!-- col:m6cp8bB6 --> <!-- id:3pMeP1F2 --> |
| --- | --- |
| `P2P.ListBlobs` | stream the ids of every public blob, from a cursor <!-- id:4sceovOE --> |
| `P2P.ListPeers`, `P2P.ListSpaces` | peer exchange and the spaces a node holds <!-- id:Pjt2Rchq --> |
| `P2P.Authenticate` | prove an account key to a peer for this connection, which gives access to that account's private blobs <!-- id:8pBXxFep --> |
| `P2P.RequestInvoice` | Lightning invoice; `Unimplemented` until payments are wired <!-- id:MdFFiYH0 --> |
| `Syncing.ReconcileBlobs` | range-based set reconciliation of blob sets per scope <!-- id:I83clmP7 --> |
| `Syncing.AnnounceBlobs` | the receiving end of a push <!-- id:ywULdtiK --> |

## Wallets and Invoices <!-- id:n0RpN6o- -->

Lightning wallets through a hosted [lndhub](https://github.com/getAlby/lndhub.go) at `ln.seed.hyper.media` (or the testnet host without `-lndhub.mainnet`): `CreateWallet`, `ImportWallet`, `ExportWallet`, `RemoveWallet`, `ListWallets`, `GetWallet`, `GetWalletBalance`, `UpdateWalletName`, `GetDefaultWallet`, `SetDefaultWallet`; `CreateInvoice`, `PayInvoice`, `DecodeInvoice`, `ListPaidInvoices`, `ListReceivedInvoices`. An `LNURL` service exists in the proto files but is never registered. <!-- id:ElgAttOY -->

## Telemetry <!-- id:lyJqnO5U -->

`RecordCheckpoints` appends client-side timing checkpoints to an in-memory buffer shown on the daemon's `/debug/journeys` page. The proto comment claims it is loopback-only. In fact it is registered on the public server like everything else. <!-- id:I_r7KSmW -->

# The daemon's own HTTP routes <!-- id:4yiGAfrt -->

Besides gRPC-Web, the HTTP port serves a few plain routes. Debug pages answer only to the local machine and refuse browser requests from another origin, so `curl` works and an iframe does not. <!-- id:ZT0v5LAc -->

<!-- id:Q2BFX_6k -->
| Route <!-- col:eDku4ask --> | Purpose <!-- col:01HhnQQy --> <!-- id:NT3eoZE5 --> |
| --- | --- |
| `GET /ipfs/<cid>` | bytes of a blob or file, with range support; searches the network for up to a minute when unknown <!-- id:WesTVIfa --> |
| `GET /ipfs/<cid>.dagjson` | a structural blob decoded to DAG-JSON <!-- id:IWFQXCHu --> |
| `POST /ipfs/file-upload` | multipart `file` up to 150 MiB, chunked into UnixFS; answers `201` with the root id <!-- id:7PFIIx5l --> |
| `POST /ipfs/<cid>` | store one raw block whose hash must match <!-- id:icGZIAB0 --> |
| `GET /hm/api/config` | `{peerId, addrs, protocolId}`; the web server's version adds the registered account <!-- id:UHwO76Vg --> |
| `GET /debug/version` | `{branch, commit, date}` <!-- id:d46PimSe --> |
| `POST /vault-connect` | completes a browser-mediated vault connection with a short-lived token <!-- id:-7ueEP9H --> |
| `/debug/metrics`, `/debug/pprof/`, `/debug/vars`, `/debug/requests`, `/debug/events`, `/debug/traces`, `/debug/p2p`, `/debug/network`, `/debug/sqlite`, `/debug/grpcui/`, `/debug/journeys`, `/debug/logs`, `/debug/buildinfo` | operator pages, local only <!-- id:gDU2r4sA --> |

# Working with it <!-- id:9QCz8_20 -->

## In the Seed app <!-- id:4MhqueZQ -->

The desktop app is a gRPC-Web client of its bundled daemon on port `56001`. You can open `http://localhost:56001/debug/grpcui/` in a browser on the same machine and call any RPC by hand. <!-- id:-mglE_8c -->

## CLI <!-- id:t1IU0clD -->

The Seed CLI signs locally and talks to a site's [Seed API](./web-api.md). The one exception is `seed-cli space dev`, which registers its dev key in the desktop dev app's daemon over gRPC-Web (`--daemon`, default `http://localhost:58001`) and publishes through the app's HTTP bridge. For raw daemon calls use `grpcurl` as above. <!-- id:eWxwnAay -->

## SDK <!-- id:GPnE2xEA -->

`@seed-hypermedia/client` has no gRPC dependency by design, so it runs in browsers, Bun, Node and React Native. When you need the daemon, take the generated TypeScript clients from the shared package in the repository and a gRPC-Web transport pointed at the HTTP port. The desktop app and `seed-cli space dev` use `@connectrpc/connect-web`, and the web server uses `@connectrpc/connect-node`. <!-- id:mQMz3A5F -->

## Agents <!-- id:-1e2cEC0 -->

[Seed Agents](../agent.md) run beside a site and use the Seed API. They do not use gRPC. An [external agent](./agents.md) on a machine with a daemon can use `grpcurl` from its shell. It can fully control any daemon it can reach, which is one more reason to keep daemon ports off the network. <!-- id:Apkp-ASE -->

# See also <!-- id:jOvd1DfV -->

- [Seed API](./web-api.md), the HTTP surface built on top of these services <!-- id:rl5FunrK -->
- [Daemon](../apps/daemon.md), flags, data directory and how the apps launch it <!-- id:0LT8YpjW -->
- [Network](../protocol/network.md), what the P2P and Syncing services do between peers <!-- id:f530rU6O -->
- [Integrity](../protocol/integrity.md), the trust model and its limits <!-- id:qdnA6nht -->
- [Contributing](./contributing.md), regenerating clients after a proto change <!-- id:4woNR5le -->
- [SDK](./sdk.md), the client that needs no daemon <!-- id:F4s6f4Rt -->

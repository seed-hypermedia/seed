---
name: The Seed daemon
summary: The Go node at the centre of every Seed installation, where it stores data, what it listens on, which flags matter, and what its local API does and does not protect.
---
The Seed daemon, `seed-daemon`, is the program that implements the [Hypermedia protocol](../protocol.md). It stores signed [blobs](../protocol/blobs.md), verifies and indexes them, keeps [account](../protocol/identity.md) keys, [syncs](../protocol/network.md) with other nodes over libp2p, and serves everything to the apps through [gRPC](../build/grpc.md) and HTTP. The [desktop app](./desktop.md) spawns one for you. A [site](../protocol/sites.md) runs one in a container. The [CLI](./cli.md) and the [agents service](./agents.md) never need one, because they talk to a site's [Seed API](../build/web-api.md). <!-- id:HHflIUFA -->

# Where the code is <!-- id:WZpCS4xs -->

The daemon lives in `backend/`, written in Go. The entry point is `backend/cmd/seed-daemon`. The main packages are `backend/blob` ([blob](../protocol/blobs.md) types, verification, the indexer), `backend/api` (the gRPC services), `backend/hmnet` (libp2p, sync, the file gateway), `backend/storage` (SQLite schema and migrations), `backend/core` (keys and signing) and `backend/config` (flags). The protobuf definitions are in `proto/` and generate both the Go server and the TypeScript clients. Run `./dev gen` after changing them. <!-- id:MEU8ufHu -->

Other binaries beside the daemon: `monitord` (health checks of sites), `relayd` (a libp2p [relay](../protocol/network.md)), `pingp2p` (connectivity test), `seed-sqlite` and `mkdb` (database tooling). <!-- id:XR_ivu-Q -->

# What it listens on <!-- id:Xn2Taszv -->

<!-- id:oOnByDF0 -->
| Listener <!-- col:62fAj-X- --> | Flag <!-- col:K_Qn3siD --> | Default <!-- col:em8fATmU --> | Serves <!-- col:To-x8rLi --> <!-- id:9vJVEeIH --> |
| --- | --- | --- | --- |
| libp2p | `-p2p.port` | 55000 | peer-to-peer [sync](../protocol/network.md) and the P2P RPCs <!-- id:xWIeXsr7 --> |
| HTTP | `-http.port` | 55001 | gRPC-web for every service, `/ipfs/*`, `/hm/api/config`, `/debug/*` <!-- id:G7uKQa9- --> |
| gRPC | `-grpc.port` | 55002 | the same services over plain gRPC <!-- id:H9V6rMI- --> |

HTTP binds `127.0.0.1` by default. Server and container deployments must pass `-http.listen-all` (or `SEED_HTTP_LISTEN_ALL=true`) to accept traffic from other hosts, including when using `-public-only`. Plain gRPC still binds all interfaces and needs a firewall. The [desktop app](./desktop.md) passes its own ports, listed on its page. A daemon you run yourself keeps the 55000 defaults. Every flag can also be set as an environment variable with the `SEED_` prefix, so `-p2p.port` is `SEED_P2P_PORT`. `SEED_DAEMON_FLAGS` prepends extra flags. <!-- id:a_qAaLbm -->

# Flags that matter to operators <!-- id:qKo2ROZg -->

<!-- id:wiR4Vn7l -->
| Flag <!-- col:9aAQ-i5K --> | Default <!-- col:k2MWOcv4 --> | Meaning <!-- col:WdP1mgRz --> <!-- id:oDc0TVDL --> |
| --- | --- | --- |
| `-data-dir` | `~/.mtt` | Where everything is stored. The desktop app passes its own data directory. <!-- id:ypeA1_vg --> |
| `-http.listen-all` | false | Bind HTTP to all interfaces instead of loopback. Required for hosted containers, including external SeedInfra deployments. |
| `-http.app-origins` | empty | Additional comma-separated trusted app origins. The desktop supplies its Vite dev origin or custom local-server port range; production server deployments normally leave this empty. |
| `-public-only` | false | Serve only public data in the APIs and over HTTP. Hosted sites and [gateways](../protocol/sites.md) use this mode. <!-- id:3vWzc_PR --> |
| `-keystore-dir` | empty | Use a file-based keystore in place of the OS keychain or vault. It is marked insecure. Sites use it inside their container. <!-- id:7a5pl9E4 --> |
| `-p2p.testnet-name` | empty | Joins a named testnet in place of mainnet by adding a suffix to the protocol id. <!-- id:7Km4dzez --> |
| `-p2p.no-relay` | false | Disables circuit relay. <!-- id:RD91Y6T8 --> |
| `-p2p.bootstrap-peers` | the Seed gateways and the public IPFS bootstrap peers | The [peers](../protocol/network.md) a fresh node connects to first. <!-- id:02bWii4y --> |
| `-syncing.no-discovery` | false | Refuse to fetch content the node does not have, turning off [discovery](../protocol/network.md). <!-- id:WI_pe4Gv --> |
| `-syncing.no-pull` | false | Disable the sync scheduler, which also runs every `DiscoverEntity` request and subscription rerun. <!-- id:lb7nxWOr --> |
| `-log-level` | info | debug, info, warning or error. <!-- id:uHUvjscG --> |

[Network](../protocol/network.md) lists every timeout and constant. [Self-hosting](../build/self-hosting.md) shows the flags a site container uses. <!-- id:tQ-U3ACD -->

# What it stores <!-- id:1pWs4GeY -->

The data directory holds three things. <!-- id:sBs3fgUk -->
  - `keys/libp2p_id_ed25519` is the device key. It is separate from every [account key](../protocol/identity.md). <!-- id:b69girWF -->
  - `vault.json` is the encrypted local keystore for account keys. A secret in the OS keychain decrypts it. <!-- id:hrt_nz2V -->
  - `db/db.sqlite` is the SQLite database. It holds every [blob](../protocol/blobs.md), the index derived from them, full-text search, and the domain store. <!-- id:EFYA2PwL -->

The schema in `backend/storage/schema.sql` is the source of truth, and migrations only go forward. Reindexing rebuilds everything derived from the blobs and can take a long time on a large node. A debug flag forces a reindex with profiling. <!-- id:VHdZ4OXj -->

# The HTTP surface <!-- id:6a_7IwIy -->

Besides gRPC-web, the HTTP port serves the [file](../protocol/files.md) gateway and a few utility routes. <!-- id:jRtCZj9l -->
  - `GET /ipfs/<cid>` returns a file or block. If the node does not have it, the daemon searches the network for up to a minute. `GET /ipfs/<cid>.dagjson` decodes a DAG-CBOR [blob](../protocol/blobs.md) and pretty-prints it. It is the quickest way to inspect a [change](../change.md), [ref](../ref.md) or [comment](../comment.md). `POST /ipfs/file-upload` chunks a file into UnixFS and returns its [CID](../protocol/blobs.md). `POST /ipfs/<cid>` stores one raw block. Both uploads accept up to 150 MiB and require a credential for cross-origin browser requests. See [Files](../protocol/files.md). <!-- id:Uv2WP0An -->
  - `GET /hm/api/config` on the daemon returns its peer id, addresses and protocol id. The [web app](./web.md)'s version of the same route adds the registered account. <!-- id:sVOzWC8O -->
  - `GET /debug/version` reports the build. The other `/debug/*` pages answer only to loopback callers that send no cross-site fetch header. They cover metrics, pprof, the p2p and network reports, the SQLite pool and an embedded grpcui. <!-- id:5j98RxA2 -->

# Authentication, plainly <!-- id:-A2Y41QE -->

The HTTP API rejects browser requests carrying cross-site or same-site fetch metadata, or an untrusted `Origin`, unless they provide a valid `Authorization: Bearer` token or `X-Seed-App-Secret`. Rejections are 403 without CORS allow headers. Non-browser clients without those browser headers continue to work without credentials. This browser gate does not authenticate arbitrary network clients: keep the ports on localhost or behind a firewall. Run internet-facing deployments with `-public-only` behind the [web app](./web.md); the web app calls the daemon server-side. [Integrity](../protocol/integrity.md) spells out what is verified and what is trusted. <!-- id:2ImcyxRS -->

CORS allows `http://localhost:17654` through `http://localhost:17664` and explicitly configured app origins, echoes the origin with `Vary: Origin`, and acknowledges Private Network Access preflights only for these origins. Actual cross-origin browser requests still need a credential. Public `GET /ipfs/<cid>`, `GET /hm/api/config`, and `GET /debug/version` remain exempt from the browser gate. Existing `-public-only` visibility filtering still applies.

The desktop generates a random 32-byte secret once per app launch, passes it to its child daemon as the hex-encoded `SEED_APP_SECRET` environment variable, and supplies it to its own top-level renderer through preload. RPCs, uploads, and direct daemon reads attach the header. The secret stays in memory, survives child-daemon restarts within that app launch, and never goes in a URL or file. A standalone daemon generates its own secret if the environment variable is absent. For `SEED_NO_DAEMON_SPAWN` development, supply the same freshly generated `SEED_APP_SECRET` to both processes and configure the Vite origin with `-http.app-origins`.

Regression commands from the repository root:

```sh
direnv exec . go build ./backend/daemon/...
direnv exec . go test ./backend/daemon -run 'HTTP|Loopback|Gate|CORS'
direnv exec . pnpm --filter @shm/desktop test:unit src/__tests__/daemon-http.test.ts
direnv exec . pnpm --filter @shm/desktop exec playwright test --project=e2e tests/daemon-auth.e2e.ts
```

The Electron regression compiles an opt-in Go test fixture that starts the full daemon with temporary storage and real HTTP/gRPC-web handlers. It does not need a packaged desktop app or a stub daemon. It requires the normal Go/llama build prerequisites and Electron dependencies.

# Working with it <!-- id:C41oDiC6 -->

## In the Seed app <!-- id:CHRc9FS5 -->

The [desktop app](./desktop.md) starts the daemon, waits for `/debug/version`, and then starts its own API bridge and the local [agents server](./agents.md). Its settings show the daemon's peer id and addresses. <!-- id:vJuF9ms7 -->

## CLI <!-- id:y6L_c2bq -->

The [CLI](./cli.md) does not need a local daemon. `seed-cli space dev` talks to the desktop's API bridge and the daemon's HTTP port to publish a folder into the running app; see [Publish a folder](../build/publish-a-folder.md). <!-- id:qa5l7wuV -->

## SDK <!-- id:RutkfUY7 -->

The [SDK](../build/sdk.md) targets the [Seed API](../build/web-api.md). It does not call the daemon. The daemon's protobuf messages are available to TypeScript through the generated clients in `@shm/shared`. <!-- id:bUwVaktl -->

## Web API <!-- id:w_DUhgsY -->

The [web app](./web.md) answers every site's `/api/<Key>` routes by calling the daemon over gRPC-web. Over plain HTTP, the daemon itself serves only `/ipfs` and `/hm/api/config`. [Building with gRPC](../build/grpc.md) lists the services for direct callers. <!-- id:9Q1wbtVB -->

## Agents <!-- id:_4dE_VFv -->

[Seed Agents](../agent.md) read and write through a site's [Seed API](../build/web-api.md) and fetch media from the daemon's `/ipfs` route. In the desktop app they use the bundled daemon through the API bridge. Hosted agents use hyper.media. <!-- id:FwY8APAq -->

# See also <!-- id:NgwiZFQY -->

- [Network](../protocol/network.md), [Files](../protocol/files.md), [Integrity](../protocol/integrity.md) <!-- id:6u82OxAd -->
- [Building with gRPC](../build/grpc.md), [Self-hosting](../build/self-hosting.md), [Contributing](../build/contributing.md) <!-- id:4MEJP6xc -->
- [The desktop app](./desktop.md), [The web app](./web.md) <!-- id:XTRrvAGF -->

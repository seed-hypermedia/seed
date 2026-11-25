---
name: The Seed daemon
summary: The Seed daemon is the Go program that stores, checks and syncs Hypermedia data, and this page says where its code is, what it listens on, which flags matter, what it stores, and who may call it.
---
The Seed daemon, `seed-daemon`, is the program that implements the [Hypermedia protocol](../protocol.md). On this site, "daemon" always means this program. You rarely use it directly: the [desktop app](./desktop.md) starts one for you, and a [site](../protocol/sites.md) runs one in a container. <!-- id:HHflIUFA -->

The daemon does five jobs:

- It stores signed [blobs](../protocol/blobs.md), and it checks and indexes them.
- It keeps [account](../protocol/identity.md) keys and signs with them.
- It [syncs](../protocol/network.md) with other nodes over libp2p.
- It serves [files](../protocol/files.md) over HTTP.
- It serves everything to the apps through [gRPC](../build/grpc.md) and HTTP.

The [CLI](./cli.md) and the [app environment](./app-environment.md) never need a daemon of their own, because they talk to a site's [Seed API](../build/web-api.md).

# Where the code is <!-- id:WZpCS4xs -->

The daemon is in `backend/`, written in Go. The entry point is `backend/cmd/seed-daemon`. These are the main packages: <!-- id:MEU8ufHu -->

- `backend/blob`: the blob types, verification and the indexer.
- `backend/api`: the gRPC services.
- `backend/hmnet`: libp2p, sync and the file gateway.
- `backend/storage`: the SQLite schema and migrations.
- `backend/core`: keys and signing.
- `backend/config`: the flags.

The protobuf definitions are in `proto/`. They generate both the Go server and the TypeScript clients. Run `./dev gen` after you change them.

`backend/cmd` holds other binaries beside the daemon: `monitord` (health checks of sites), `relayd` (a libp2p [relay](../protocol/network.md), a server that forwards connections for peers behind NAT), `pingp2p` (a connectivity test), and `seed-sqlite` and `mkdb` (database tools). <!-- id:XR_ivu-Q -->

# How programs talk to it <!-- id:Xn2Taszv -->

A program reaches the daemon through one of its three listeners. This section lists them, then the plain HTTP routes, then who may call.

<!-- id:oOnByDF0 -->
| Listener <!-- col:62fAj-X- --> | Flag <!-- col:K_Qn3siD --> | Default <!-- col:em8fATmU --> | Serves <!-- col:To-x8rLi --> <!-- id:9vJVEeIH --> |
| --- | --- | --- | --- |
| libp2p | `-p2p.port` | 55000 | peer-to-peer [sync](../protocol/network.md) and the P2P RPCs <!-- id:xWIeXsr7 --> |
| HTTP | `-http.port` | 55001 | gRPC-web for every service, `/ipfs/*`, `/hm/api/config`, `/debug/*` <!-- id:G7uKQa9- --> |
| gRPC | `-grpc.port` | 55002 | the same services over plain gRPC <!-- id:H9V6rMI- --> |

The gRPC and HTTP listeners bind every network address. In default mode the daemon still accepts only callers on the same machine. [Server mode](#who-is-admitted) skips that check and relies on the network of the deployment. <!-- id:a_qAaLbm -->

The [desktop app](./desktop.md) passes its own ports, listed in the [port table](../software.md). A daemon that you run yourself keeps the 55000 defaults. You can also set every flag as an environment variable with the `SEED_` prefix, so `-p2p.port` is `SEED_P2P_PORT`. `SEED_DAEMON_FLAGS` adds extra flags in front.

## The HTTP surface <!-- id:6a_7IwIy -->

Besides gRPC-web, the HTTP port serves the [file](../protocol/files.md) gateway and a few utility routes. <!-- id:jRtCZj9l -->
  - `GET /ipfs/<cid>` returns a file or one raw piece of IPFS data. If the node does not have it, the daemon searches the network for up to a minute. `GET /ipfs/<cid>.dagjson` decodes a [DAG-CBOR](../schema/dag-cbor.md) [blob](../protocol/blobs.md) and prints it as readable JSON. It is the quickest way to inspect a [change](../change.md), [ref](../ref.md) or [comment](../comment.md). `POST /ipfs/file-upload` splits a file into UnixFS chunks and returns its [CID](../cid.md). `POST /ipfs/<cid>` stores one raw piece of IPFS data. Both uploads accept up to 150 MiB and need no authentication. See [Files](../protocol/files.md). <!-- id:Uv2WP0An -->
  - `GET /hm/api/config` on the daemon returns its peer id, addresses and protocol id. The [web app](./web.md)'s version of the same route adds the registered account. <!-- id:sVOzWC8O -->
  - `GET /debug/version` reports the build. The other `/debug/*` pages cover metrics (`/debug/metrics`), pprof, the p2p and network reports, the SQLite pool and its memory, the C allocator and an embedded grpcui. The daemon admits callers to them by the same rules as the API. <!-- id:5j98RxA2 -->

## Who is admitted <!-- id:-A2Y41QE -->

The daemon has two modes. <!-- id:2ImcyxRS -->

**Default mode.** The daemon accepts only connections from the same machine (loopback). It trusts a local program once it is connected. That program can read everything the daemon holds and write as any key it keeps, because signing happens inside the daemon. For HTTP the daemon checks more:

- The `Host` header must be exactly `localhost` or a loopback IP address.
- A request from a browser must come from an exact origin the daemon trusts. The daemon reads the browser's fetch metadata and the `Origin` header. For media and frames that send no `Origin`, it uses the origin in `Referer`.
- `-api.allowed-origins` adds trusted browser origins, such as the origin of the desktop app's windows. It does not open the daemon to other machines or other `Host` names.

**Server mode.** `-server-mode`, or `SEED_SERVER_MODE=true`, turns the checks above off. The daemon trusts the network of the deployment. So you must do these things yourself:

- Keep the daemon's HTTP and gRPC ports private, behind the [web app](./web.md).
- Proxy only the public `/ipfs/*` routes.

In server mode the daemon hides [private content](../protocol/privacy.md) from a caller with no token. A caller with a valid [bearer token](../protocol/identity.md#proving-identity-to-a-server) may read the private content it is allowed to see. A bearer token never allows a write. The Docker image turns server mode on through its environment. [Integrity](../protocol/integrity.md) explains the trust model.

# Configuration <!-- id:qKo2ROZg -->

You configure the daemon with flags. These are the ones that matter most to a person who runs one.

<!-- id:wiR4Vn7l -->
| Flag <!-- col:9aAQ-i5K --> | Default <!-- col:k2MWOcv4 --> | Meaning <!-- col:WdP1mgRz --> <!-- id:oDc0TVDL --> |
| --- | --- | --- |
| `-data-dir` | `~/.mtt` | Where everything is stored. The desktop app passes its own data directory. <!-- id:ypeA1_vg --> |
| `-server-mode` | false | Trust the deployment network and filter anonymous private reads. Hosted sites and [gateways](../protocol/sites.md) use this mode; the Docker image sets `SEED_SERVER_MODE=true`. <!-- id:3vWzc_PR --> |
| `-api.allowed-origins` | empty | Additional exact browser origins accepted in default mode. |
| `-keystore-dir` | empty | Use a file-based keystore in place of the OS keychain or the local vault file. It is marked insecure. Sites use it inside their container. <!-- id:7a5pl9E4 --> |
| `-p2p.testnet-name` | empty | Joins a named testnet in place of mainnet by adding a suffix to the protocol id. <!-- id:7Km4dzez --> |
| `-p2p.no-relay` | false | Disables circuit relay. <!-- id:RD91Y6T8 --> |
| `-p2p.bootstrap-peers` | the Seed gateways and the public IPFS bootstrap peers | The [peers](../protocol/network.md) a fresh node connects to first. `none`, or an empty value, turns bootstrapping off. <!-- id:02bWii4y --> |
| `-p2p.isolated` | false | Talk to no other node: refuse every connection, and skip bootstrap, peer exchange, relay and NAT. It also turns off bootstrap peers and the wallet. |
| `-lndhub.disabled` | false | Turn off the wallet integration. Payment calls fail. |
| `-syncing.no-discovery` | false | Refuse to fetch content the node does not have, turning off [discovery](../protocol/network.md). <!-- id:WI_pe4Gv --> |
| `-syncing.no-pull` | false | Disable the sync scheduler, which also runs every `DiscoverEntity` request and subscription rerun. <!-- id:lb7nxWOr --> |
| `-storage.sqlite-soft-heap-limit` | 0 | Bytes of heap memory SQLite may hold across all connections. Above it page caches recycle their oldest pages instead of growing; nothing fails. 0 means no limit. See [Daemon operations](../operate/daemon-operations.md). <!-- id:3FqHYvTh --> |
| `-log-level` | info | debug, info, warning or error. <!-- id:uHUvjscG --> |

The [daemon network reference](../operate/daemon-network.md) lists the rest of the flags and every timeout and constant. [Self-hosting](../operate/self-hosting.md) shows the flags a site container uses. <!-- id:tQ-U3ACD -->

# What it stores <!-- id:1pWs4GeY -->

The data directory holds three things. <!-- id:sBs3fgUk -->
  - `keys/libp2p_id_ed25519` is the [device key](../protocol/network.md), which identifies this daemon to other peers. It is separate from every [account key](../protocol/identity.md). <!-- id:b69girWF -->
  - `vault.json` is the local vault file: the encrypted store for account keys. A secret in the OS keychain decrypts it. It is not the [vault](./vault.md) service, which can sync with it. <!-- id:hrt_nz2V -->
  - `db/db.sqlite` is the SQLite database. It holds every [blob](../protocol/blobs.md), the index derived from them, full-text search, and the domain store. <!-- id:EFYA2PwL -->

The schema in `backend/storage/schema.sql` is the source of truth, and migrations only go forward. A reindex rebuilds everything the daemon derives from the blobs. It can take a long time on a large node. A debug flag forces a reindex with profiling. <!-- id:VHdZ4OXj -->

# Running it

You rarely start the daemon by hand:

- The [desktop app](./desktop.md) starts one with its own ports and data directory.
- A [site](../protocol/sites.md) runs one in a container, in server mode. [Self-hosting](../operate/self-hosting.md) describes it.
- For development, `./dev run-backend` builds and runs `seed-daemon` alone. Flags after `--` go to the daemon.

[Contributing](../contribute/contributing.md) has the build setup.

[Daemon operations](../operate/daemon-operations.md) explains what to look at when a running daemon is slow or uses too much memory.

# Working with it <!-- id:C41oDiC6 -->

## In the Seed app <!-- id:CHRc9FS5 -->

The [desktop app](./desktop.md) starts the daemon and waits for `/debug/version` to answer. Then it starts its own API bridge, the local copy of the Seed API. When that setting is on, it also starts a local [app environment](./app-environment.md). The app's settings show the daemon's peer id and addresses. <!-- id:vJuF9ms7 -->

## CLI <!-- id:y6L_c2bq -->

The [CLI](./cli.md) does not need a local daemon. One command uses one: `seed-cli space dev` talks to the desktop app's API bridge and to the daemon's HTTP port, to publish a folder into the running app. See [Publish a folder](../build/publish-a-folder.md). <!-- id:qa5l7wuV -->

## SDK <!-- id:RutkfUY7 -->

The [SDK](../build/sdk.md) targets the [Seed API](../build/web-api.md). It does not call the daemon. The daemon's protobuf messages are available to TypeScript through the generated clients in `@shm/shared`. <!-- id:bUwVaktl -->

## Seed API <!-- id:w_DUhgsY -->

The [web app](./web.md) answers every site's `/api/<Key>` routes by calling the daemon over gRPC-web. Over plain HTTP, the daemon itself serves `/ipfs`, `/hm/api/config` and the `/debug` pages. [Daemon gRPC](../build/grpc.md) lists the services for programs that call the daemon directly. <!-- id:9Q1wbtVB -->

## Agents <!-- id:_4dE_VFv -->

[Seed Agents](../agent.md) read and write through a site's [Seed API](../build/web-api.md), and they fetch media from the daemon's `/ipfs` route. Agents on a local app environment use the desktop app's daemon through the API bridge. Hosted agents use hyper.media. <!-- id:FwY8APAq -->

# See also <!-- id:NgwiZFQY -->

- [Network](../protocol/network.md), [Files](../protocol/files.md), [Integrity](../protocol/integrity.md) <!-- id:6u82OxAd -->
- [Daemon gRPC](../build/grpc.md), [Self-hosting](../operate/self-hosting.md), [Daemon operations](../operate/daemon-operations.md), [Daemon network reference](../operate/daemon-network.md), [Contributing](../contribute/contributing.md) <!-- id:4MEJP6xc -->
- [The desktop app](./desktop.md), [The web app](./web.md) <!-- id:XTRrvAGF -->

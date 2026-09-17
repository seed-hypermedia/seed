---
name: The Seed daemon
summary: The Go node at the centre of every Seed installation, where it stores data, what it listens on, which flags matter, and what its local API does and does not protect.
---
The Seed daemon, `seed-daemon`, is the program that actually implements the Hypermedia protocol. It stores signed blobs, verifies and indexes them, keeps account keys, syncs with other nodes over libp2p, and serves everything to the apps through gRPC and HTTP. The desktop app spawns one for you; a site runs one in a container; the CLI and the agents service never need one because they talk to a site's API instead.

# Where the code is

The daemon lives in `backend/`, written in Go. The entry point is `backend/cmd/seed-daemon`. The important packages are `backend/blob` (blob types, verification, the indexer), `backend/api` (the gRPC services), `backend/hmnet` (libp2p, sync, the file gateway), `backend/storage` (SQLite schema and migrations), `backend/core` (keys and signing) and `backend/config` (flags). The protobuf definitions are in `proto/` and generate both the Go server and the TypeScript clients; run `./dev gen` after changing them.

Other binaries beside the daemon: `monitord` (health checks of sites), `relayd` (a libp2p relay), `pingp2p` (connectivity test), `seed-sqlite` and `mkdb` (database tooling).

# What it listens on

| Listener | Flag | Default | Serves |
| --- | --- | --- | --- |
| libp2p | `-p2p.port` | 55000 | peer-to-peer sync and the P2P RPCs |
| HTTP | `-http.port` | 55001 | gRPC-web for every service, `/ipfs/*`, `/hm/api/config`, `/debug/*` |
| gRPC | `-grpc.port` | 55002 | the same services over plain gRPC |

Both gRPC and HTTP bind all interfaces, not loopback. The desktop app passes 56001 and friends; a self-run daemon keeps the 55000 defaults. Every flag can also be set as an environment variable with the `SEED_` prefix, so `-p2p.port` is `SEED_P2P_PORT`, and `SEED_DAEMON_FLAGS` prepends extra flags.

# Flags that matter to operators

| Flag | Default | Meaning |
| --- | --- | --- |
| `-data-dir` | `~/.mtt` | Where everything is stored. The desktop app passes its own data directory. |
| `-public-only` | false | Serve only public data in the APIs and over HTTP. This is the hosted and gateway mode. |
| `-keystore-dir` | empty | File-based keystore instead of the OS keychain or vault. Marked insecure; sites use it inside their container. |
| `-p2p.testnet-name` | empty | Joins a named testnet instead of mainnet by suffixing the protocol id. |
| `-p2p.no-relay` | false | Disables circuit relay. |
| `-p2p.bootstrap-peers` | the hyper.media peers | The peers a fresh node connects to first. |
| `-syncing.no-discovery` | false | Refuse to fetch content the node does not have. |
| `-syncing.no-pull` | false | Disable the periodic sync scheduler. |
| `-log-level` | info | debug, info, warning or error. |

[Network](../protocol/network.md) lists every timeout and constant. [Self-hosting](../build/self-hosting.md) shows the flags a site container uses.

# What it stores

Inside the data directory: `keys/libp2p_id_ed25519` is the device key, distinct from any account key; `vault.json` is the encrypted local keystore for account keys, unlocked with a secret in the OS keychain; `db/db.sqlite` is the SQLite database that holds every blob, the index derived from them, full-text search, and the domain store. The schema in `backend/storage/schema.sql` is the source of truth and is only ever migrated forward. Reindexing rebuilds everything derived from the blobs and can take a long time on a large node; a debug flag forces a reindex with profiling.

# The HTTP surface

Beyond gRPC-web, the HTTP port serves the file gateway and a few utility routes.

- `GET /ipfs/<cid>` returns a file or block, searching the network for up to a minute if the node does not have it. `GET /ipfs/<cid>.dagjson` decodes a DAG-CBOR blob and pretty-prints it, which is the quickest way to inspect a change, ref or comment. `POST /ipfs/file-upload` chunks a file into UnixFS and returns its CID; `POST /ipfs/<cid>` stores one raw block. Both uploads accept up to 150 MiB and require no authentication. See [Files](../protocol/files.md).
- `GET /hm/api/config` on the daemon returns its peer id, addresses and protocol id; the web app's version of the same route adds the registered account.
- `GET /debug/version` reports the build. The other `/debug/*` pages, metrics, pprof, the p2p and network reports, the SQLite pool and an embedded grpcui, answer only to loopback callers without a cross-site fetch header.

# Authentication, plainly

The local gRPC and HTTP API has no authentication. Whoever can reach the port can read everything the node holds and can write as any key the node keeps, because signing happens inside the daemon. Bearer tokens exist, but they only widen reads on a public-only node; they never gate writes. The mitigations are deliberate and simple: keep the ports on localhost or behind a firewall, and run any daemon that faces the internet with `-public-only` behind the web app, which is how sites are deployed. [Integrity](../protocol/integrity.md) spells out what is verified and what is trusted.

# Working with it

## In the Seed app

The desktop app starts the daemon, waits for `/debug/version`, and then starts its own API bridge and the local agents server. Its settings show the daemon's peer id and addresses.

## CLI

The CLI does not need a local daemon. `seed-cli space dev` talks to the desktop's API bridge and the daemon's HTTP port to publish a folder into the running app; see [Publish a folder](../build/publish-a-folder.md).

## SDK

The SDK targets the Seed API, not the daemon. The daemon's protobuf messages are available to TypeScript through the generated clients in `@shm/shared`.

## Web API

Every site's `/api/<Key>` routes are answered by the web app calling the daemon over gRPC-web; the daemon itself only serves `/ipfs` and `/hm/api/config` over HTTP. [Building with gRPC](../build/grpc.md) lists the services for direct callers.

## Agents

Seed Agents read and write through a site's Seed API and fetch media from the daemon's `/ipfs` route. In the desktop app they use the bundled daemon through the API bridge; hosted agents use hyper.media.

# See also

- [Network](../protocol/network.md), [Files](../protocol/files.md), [Integrity](../protocol/integrity.md)
- [Building with gRPC](../build/grpc.md), [Self-hosting](../build/self-hosting.md), [Contributing](../build/contributing.md)

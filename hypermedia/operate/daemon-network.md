---
name: Daemon Network Reference
summary: This page is the reference for the network layer of the Seed daemon, with its ports, flags, constants, transports, relays, scheduler rules and debug pages.
---
The [Seed daemon](../software/daemon.md) is the program that stores Seed content and syncs it with other nodes. This page is the operator's reference for its network layer: the ports it listens on, how other nodes reach it through relays, how it schedules sync, the flags and constants that tune this, and the debug pages.

The first thing to check when a node does not sync: open `/debug/p2p` and `/debug/network` on the daemon's HTTP port. They show whether the node is reachable and what each sync attempt did; see [Debug pages and metrics](#debug-pages-and-metrics).

[Network](../protocol/network.md) explains the ideas: peers, scopes, reconciliation, discovery, subscriptions and push. [Self-hosting](./self-hosting.md) has the steps for running a [site](../protocol/sites.md).

# Transports and addresses <!-- id:CC2JPslL -->

The daemon uses the default transports of go-libp2p: TCP, QUIC, WebSocket, WebTransport and WebRTC-direct. It uses TLS or Noise for the handshake, and yamux to carry several streams on one connection. It listens on four addresses for one port `P`: <!-- id:PJyggZK2 -->

``` <!-- id:1v6x7Gi6 -->
/ip4/0.0.0.0/udp/P/quic-v1
/ip4/0.0.0.0/udp/P/quic-v1/webtransport
/ip4/0.0.0.0/udp/P/webrtc-direct
/ip4/0.0.0.0/tcp/P
```

The daemon does not listen on IPv6. <!-- id:XPHhuCFo -->

- `-p2p.listen-addrs` replaces this set of addresses.
- `-p2p.announce-addrs` replaces the addresses the node tells others. A site announces `/dns4/<host>/tcp/56000`, `/dns4/<host>/udp/56000/quic-v1` and `/dns4/<host>/tcp/143`.
- By default a desktop node also announces and stores private LAN addresses, so two laptops on one network can find each other. `-p2p.no-private-ips` turns that off.

# Reachability and relays <!-- id:qD9Mpybv -->

Most desktop nodes are behind a home or office router (NAT), so other nodes cannot connect to them directly. A relay is a server that passes a connection on to such a node. <!-- id:zLvDN-Vk -->

- The daemon turns on hole punching and AutoNAT.
- Unless you tell it otherwise, the daemon assumes that others **cannot** reach it directly.
- It asks one of two fixed Seed relay servers to hold a place for it (a circuit-relay reservation). It keeps at most two relay connections.
- The daemon never finds relays through the network. The two addresses are built into the program.
- The daemon itself is never a relay for others. The relay is a separate small program in the repository.

A site runs with `-p2p.no-relay=true -p2p.force-reachability-public=true`. So it never uses a relay and always answers direct connections. The `/debug/p2p` page shows whether the node is reachable; it follows the same access rules as the rest of the daemon's API. <!-- id:5a2izYC9 -->

The relay servers listen on port 4002, over TCP and QUIC. A node on a network that does not allow that port gets no reservation, and others cannot reach it through a relay.

# Routing

There is no distributed hash table (DHT). The daemon contains a client for a delegated-routing server, but `-p2p.delegated-dht` is empty by default, so every lookup of who has a piece of content fails without an error. The daemon's own Kademlia code is never called.

# Hot and cold: the scheduler <!-- id:Tz31gKkU -->

The daemon looks for content through one scheduler. The scheduler has `-syncing.max-workers` places (six by default), and it always keeps one place free for work a person is waiting for. <!-- id:wUKjzEQZ -->
  - **Hot tasks** come from a client that is looking at something. The [Seed app](../software/desktop.md) calls `DiscoverEntity` for the [document](../protocol/documents.md) on screen every few seconds. Each call keeps the task alive for 40 seconds and runs it again every 10 seconds. The newest hot task runs first, and a hot task may take the place of an idle background run. <!-- id:LIkGyvRh -->
  - **Cold tasks** are subscriptions. Each one runs again every `-syncing.interval` (one minute by default) after it ends. Runs are grouped a few seconds together to save battery. <!-- id:D5xC6MPG -->

A scope is the set of content one sync asks for, such as one [space](../protocol/spaces.md). The better a node knows a scope, the fewer peers it asks. It still asks as often. <!-- id:z4__ZMV7 -->

- A scope the node already holds asks only the site server, or the [gateways](../protocol/sites.md) when there is no site server. It adds no random peers. The same is true for a recursive scope whose last two waves brought nothing.
- A scope the node does not hold, whose site server is known, asks two more peers.
- Only a scope with no known host asks twenty.

# Reconciliation and wave tuning

Two nodes compare what they hold without sending the whole list. This is range-based set reconciliation (RBSR); [Network](../protocol/network.md) explains the idea. The numbers below are the daemon's settings for it. <!-- id:NFiHqoS1 -->

- **Item.** One item is `(timestamp, CID)`: a [blob](../protocol/blobs.md)'s signed time and its [CID](../cid.md). Items are ordered by the time and then by the bytes.
- **Fingerprint.** A fingerprint is a short hash that stands for a whole range of items. The hash of one item is the SHA-256 of its CID bytes. The fingerprint of a range is the first 16 bytes of the SHA-256 of the sum of those hashes, followed by the number of items.
- **Buckets.** The node that starts splits its whole range into 16 parts, called buckets, and sends one fingerprint for each. It sends a range of fewer than 32 items as a plain list.
- **Answers.** The other node answers each fingerprint with "same", or with its own split of that range. It answers each list with its own list.
- **Limits.** A message is at most 1 MiB, a round at most 15 seconds, and a session at most 1,000 rounds.
- **Direction.** The result goes one way: the node that starts learns which CIDs the other has that it lacks. The daemon also works out what the other node would need, but does not use it. Seed pulls, and never lets a stranger push.

A wave is one round of asking a group of peers, and a tier is one group. <!-- id:tKAT4bm0 -->

- A later tier runs only if the tier before it left something missing.
- The exception is an **exhaustive wave**, which asks every tier. Every recursive scope gets one every ten minutes. New interest from a person can force one, at most once every two minutes.
- Inside a tier the node talks to up to 20 peers at once. It stops waiting for slow peers once 70 percent are done and downloads have been idle for five seconds.
- When a connection to a peer fails, the node leaves that peer out for 30 seconds. The time doubles with each failure, up to ten minutes. This only decides whom to ask next. The node keeps no score for peers.

# Ports <!-- id:yH9-GRd7 -->

The daemon listens in three places: libp2p, an HTTP server (which carries gRPC-web, `/ipfs`, `/hm/api/config` and `/debug/*`) and a plain gRPC server. The HTTP and gRPC servers listen on every network address. In default mode the daemon then accepts only callers on the same machine (loopback). In [server mode](../protocol/integrity.md) it trusts the network it is deployed on. Each kind of Seed deployment uses its own group of ports: <!-- id:r5mn0pmN -->

<!-- id:3eZQEvYE -->
| Deployment <!-- col:xSsqC6jm --> | libp2p <!-- col:FlGdXj3L --> | HTTP (gRPC-web, `/ipfs`, `/debug`) <!-- col:VNwbp64X --> | gRPC <!-- col:e909sAB3 --> | Other <!-- col:Orb2hlMs --> <!-- id:EIljUu9Y --> |
| --- | --- | --- | --- | --- |
| `seed-daemon` defaults | 55000 | 55001 | 55002 | <!-- id:qcJNGiIY --> |
| Seed app, production | 56000 | 56001 | 56002 | 56004 [Seed API](../build/web-api.md) bridge <!-- id:P5Fs4jsK --> |
| Seed app, development (`./dev`) | 58000 | 58001 | 58002 | 58004 Seed API bridge <!-- id:qYRUih6B --> |
| Self-hosted site (docker compose) | 56000 TCP and UDP, published; host TCP 143 forwards to it | 56001, internal only (the web app and the `/ipfs` proxy use it) | 56002, internal only | 80 and 443 on the proxy <!-- id:LSnMxBHH --> |
| `hyper.media` and `dev.hyper.media` bootstrap addresses | 56001 (QUIC and TCP) and TCP 143 |  |  | <!-- id:o29Au7If --> |
| `staging.hyper.media` bootstrap address | 55001 |  |  | <!-- id:_TKThVuE --> |

Ports 56003 and 58003 are reserved and unused. Metrics are at `/debug/metrics` on the HTTP port.

The Seed app and the [web app](../software/web.md) always talk to the daemon over gRPC-web on the HTTP port. They never use the plain gRPC port. <!-- id:9iOmo8-W -->

Some networks, such as the eduroam university network, do not allow the libp2p port but allow TCP 143 (IMAP). So a site opens port 143 as a second way in to the same TCP listener, and announces it. A Seed app learns that address from the site's `/hm/api/config`, like any other address.

# Flags that matter to operators <!-- id:3QqngMIS -->

You can also set every flag as an environment variable with the `SEED_` prefix: `-p2p.port` is `SEED_P2P_PORT`. `SEED_DAEMON_FLAGS` holds a string of flags that is put before the others. <!-- id:VxP7Bhfp -->

<!-- id:1vWpv4nJ -->
| Flag <!-- col:uX6RT6Am --> | Default <!-- col:Cfis3a2B --> | Effect <!-- col:j2nEJwUU --> <!-- id:lCMGGhsQ --> |
| --- | --- | --- |
| `-p2p.port` | 55000 | port for the four listen multiaddrs <!-- id:uexjTBvV --> |
| `-p2p.testnet-name` | empty | appends `-<name>` to the protocol id <!-- id:oTYiCOWi --> |
| `-p2p.bootstrap-peers` | the compiled-in list | comma-separated multiaddrs; replaces the list. `none`, or an empty value, turns bootstrapping off <!-- id:fGhOLF2y --> |
| `-p2p.isolated` | false | talk to no other node: refuse every connection, and skip bootstrap, peer exchange, relay and NAT. Also turns off bootstrap peers and the wallet |
| `-lndhub.disabled` | false | turn off the wallet integration; payment calls fail |
| `-p2p.listen-addrs`, `-p2p.announce-addrs` | derived from the port; none | replace the listen set; replace what is advertised <!-- id:S5zKQ_qt --> |
| `-p2p.no-relay` | false | disables autorelay and the private-reachability assumption <!-- id:I6ljf4DY --> |
| `-p2p.force-reachability-public` | false | skip AutoNAT; announce as directly reachable <!-- id:oymqZZcM --> |
| `-p2p.no-private-ips` | false | filter LAN addresses from what is announced and stored <!-- id:lnQLb8mr --> |
| `-p2p.delegated-dht` | empty | URL of a `/routing/v1` server; empty means routing is off <!-- id:oU9C-xEc --> |
| `-p2p.max-inbound-reconciles`, `-p2p.inbound-reconcile-wait` | auto (2 × CPUs, min 2); 3 s | cap on concurrent inbound reconciliations and how long a caller waits before `ResourceExhausted` <!-- id:_uX4FgJP --> |
| `-syncing.no-peer-sharing` | false | refuse to answer peer-exchange requests <!-- id:iXxwJ0zo --> |
| `-syncing.interval` | 1m | cadence of subscription reruns <!-- id:3_Aq7uvm --> |
| `-syncing.max-workers` | 6 | scheduler pool; one slot is reserved for hot work <!-- id:4sCPvyU3 --> |
| `-syncing.timeout-per-peer` | 2m | budget for one peer inside a wave <!-- id:gacr1Mb- --> |
| `-syncing.warmup-duration` | 20s | random delay before the first dispatch after start <!-- id:bQwDpQ_3 --> |
| `-syncing.exhaustive-wave-interval` | 10m | how often a recursive scope runs a full-width wave <!-- id:JtFDmPYH --> |
| `-syncing.no-pull` | false | do not run the scheduler, so neither `DiscoverEntity` tasks nor subscription reruns execute; the one-shot discovery inside `Subscribe`, the file gateway and push still reach the network <!-- id:Ian9qsQl --> |
| `-syncing.no-discovery` | false | discovery errors; the file gateway serves local blobs only <!-- id:FHUBDoCZ --> |
| `-server-mode` | false | trust the deployment network and filter anonymous private reads (what hosted sites run); keep daemon API ports private <!-- id:fPjzahjC --> |

The daemon accepts `-syncing.allow-push`, `-syncing.refresh-interval`, `-syncing.smart` and `-syncing.no-sync-back`, and they do nothing. `Daemon.ForceSync` returns `Unimplemented`. <!-- id:z4l0WCEN -->

# Constants <!-- id:3NI0uq_X -->

<!-- id:Io7qL8me -->
| What <!-- col:mJTtDbAh --> | Value <!-- col:0kuqfITS --> <!-- id:F94k6eBL --> |
| --- | --- |
| connection manager low / high watermark | 150 / 300 connections <!-- id:aY5b-93E --> |
| connections per source IP | 64 <!-- id:I3SwGU5B --> |
| target connected non-bootstrap peers; peer-exchange tick | 20; every 60 s <!-- id:QsU2DF3I --> |
| peer freshness window (exchange and pruning) | 30 days <!-- id:2SZgbDrb --> |
| dial timeout inside a wave; per-peer sync budget | 6 s; 2 min <!-- id:eTDRsB3T --> |
| discovery budget | 10 min <!-- id:nZoTglks --> |
| hot task heartbeat; hot rerun cooldown | 40 s; 10 s <!-- id:Oi50Pe8l --> |
| exhaustive wave; user-forced probe | every 10 min; at most every 2 min <!-- id:bA6ztQic --> |
| RBSR message cap; fingerprint; buckets; list threshold | 1 MiB; 16 bytes; 16; under 32 items <!-- id:5URtQJ90 --> |
| RBSR rounds per session; round timeout | 1,000; 15 s <!-- id:j4JagStf --> |
| peers per tier at once | 20 <!-- id:H4OWW4_m --> |
| straggler cut | 70 % done and 5 s idle (2 s on hot waves) <!-- id:tg5P_QpN --> |
| bulk media slots per daemon | 1 <!-- id:GSVRrG5f --> |
| push announcement limit; push fetch idle timeout | 200,000 CIDs; 40 s <!-- id:G2Ia4buX --> |
| peer authentication clock skew | ± 1 min <!-- id:5gpc8bZM --> |
| gRPC over libp2p max message | 8 MiB <!-- id:_QHXI5Y3 --> |
| site config cache; domain re-check | 5 min; every 30 min <!-- id:GUSVjx9- --> |

# Debug pages and metrics <!-- id:BYh0isvq -->

These pages are on the daemon's HTTP port. They follow the same access rules as the rest of the daemon's API: default mode accepts only callers on the same machine, and server mode relies on a private deployment network. <!-- id:gWdN_dcN -->

- `/debug/p2p`: a JSON dump of libp2p, Bitswap and the connection manager. It includes whether the node is reachable.
- `/debug/network`: an HTML report of the discovery phases, reconciliation, Bitswap results and the limiter for incoming requests.
- `/debug/metrics`: metrics in Prometheus format.
- `/debug/grpcui/`: a gRPC console inside the daemon.

The sync results there have these labels. For each peer: `ok`, `preempted`, `protocol_mismatch`, `dial_failed`, `auth_failed`, `putmany_failed` and `rpc_error`. For each discovery: `connected`, `dht`, `notfound` and `error`.

# Local API access

The daemon also offers the peer-to-peer services `P2P` and `Syncing` on its local API, behind a `target-peer` metadata key. So a local client can run `ListSpaces` or `ReconcileBlobs` against a remote peer through your daemon. <!-- id:ceErZghv -->

- **Default mode** accepts only callers on the same machine, and then trusts local tools. Over HTTP, the Host name must be exactly `localhost` or a loopback IP address, and the daemon checks browser metadata and exact origins.
- **Server mode** (`-server-mode`) is for a trusted deployment network, and hosted servers run with it. Keep the daemon's API ports private, and pass only the public `/ipfs/*` routes through the proxy. Server mode does not change what other peers can see.

The [gRPC guide](../build/grpc.md) lists every service.

# See also

- [Network](../protocol/network.md): how nodes find each other, reconcile and fetch.
- [Seed daemon](../software/daemon.md): the program this page tunes.
- [Self-hosting](./self-hosting.md): the compose file and registration for a site.
- [Daemon operations](./daemon-operations.md): what to check when a daemon is slow or large.
- [gRPC](../build/grpc.md): the daemon's full service catalogue.

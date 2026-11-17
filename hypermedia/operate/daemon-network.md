---
name: Daemon Network Reference
summary: The ports, flags, constants, transports, relays, scheduler rules and debug pages of the Seed daemon's network layer.
---
This page is the operator's reference for the network layer of the [Seed daemon](../software/daemon.md). It lists the addresses and ports the daemon listens on, how it becomes reachable through relays, how its sync scheduler spends its slots, the flags and constants that tune all of this, and the debug pages that show what a node is doing. [Network](../protocol/network.md) explains the ideas behind it: peers, scopes, reconciliation, discovery, subscriptions and push. [Self-hosting](./self-hosting.md) has the steps for running a site.

# Transports and addresses <!-- id:CC2JPslL -->

The daemon uses go-libp2p's default transports (TCP, QUIC, WebSocket, WebTransport and WebRTC-direct), TLS or Noise for the handshake, and yamux for multiplexing. It listens on four multiaddrs for one port `P`: <!-- id:PJyggZK2 -->

``` <!-- id:1v6x7Gi6 -->
/ip4/0.0.0.0/udp/P/quic-v1
/ip4/0.0.0.0/udp/P/quic-v1/webtransport
/ip4/0.0.0.0/udp/P/webrtc-direct
/ip4/0.0.0.0/tcp/P
```

The daemon does not listen on IPv6. The `-p2p.listen-addrs` flag replaces this set, and `-p2p.announce-addrs` replaces what the node tells others (a site announces `/dns4/<host>/tcp/56000`, `/dns4/<host>/udp/56000/quic-v1` and `/dns4/<host>/tcp/143`). By default a desktop node also announces and stores private LAN addresses, so two laptops on one network can find each other. `-p2p.no-private-ips` turns that off. <!-- id:XPHhuCFo -->

# Reachability and relays <!-- id:qD9Mpybv -->

Most desktop nodes sit behind NAT. The daemon enables hole punching and AutoNAT. Unless told otherwise, it assumes it is **not** publicly reachable. It asks one of two fixed Seed relay servers for a circuit-relay reservation, and keeps at most two relay connections. Relays are never discovered from the network. The two addresses are compiled in. The daemon itself is never a relay for others. The relay is a separate small program in the repository. <!-- id:zLvDN-Vk -->

A site runs with `-p2p.no-relay=true -p2p.force-reachability-public=true`, so it never uses a relay and always answers direct dials. Current reachability is shown on the `/debug/p2p` page, under the daemon's API admission policy. <!-- id:5a2izYC9 -->

The relay servers listen on port 4002 over TCP and QUIC. A node on a network that blocks that port gets no reservation and cannot be dialed through a relay.

# Routing

There is no distributed hash table. The daemon links a delegated-routing client, but `-p2p.delegated-dht` is empty by default, so every provider lookup fails quietly. The local Kademlia code has no callers.

# Hot and cold: the scheduler <!-- id:Tz31gKkU -->

The daemon runs discovery through one scheduler with `-syncing.max-workers` slots (default six) and one slot always reserved for interactive work. <!-- id:wUKjzEQZ -->
  - **Hot tasks** come from a client that is looking at something. The Seed app calls `DiscoverEntity` for the document on screen every few seconds. Each call is a heartbeat that keeps the task alive for 40 seconds and reruns it every 10 seconds. Hot tasks are last-in-first-out and may preempt an idle background run. <!-- id:LIkGyvRh -->
  - **Cold tasks** are subscriptions. They rerun every `-syncing.interval` (default one minute) after completing, clumped a few seconds together to save battery. <!-- id:D5xC6MPG -->

As a scope settles, the fan-out narrows and the frequency stays the same. A scope you already hold, or a recursive scope whose last two waves fetched nothing, adds no random sample at all. It asks only the site server, or the gateways when there is no site server. A scope you lack whose site server is known samples two extra peers, and only a scope with no known host samples twenty. <!-- id:z4__ZMV7 -->

# Reconciliation and wave tuning

In the daemon, an item is `(timestamp, CID)`, ordered by the blob's signed timestamp and then by bytes. Each item's hash is the SHA-256 of its CID bytes, and a range's fingerprint is the first 16 bytes of the SHA-256 of the sum of those hashes followed by the item count. The initiator splits its whole range into 16 buckets and sends one fingerprint per bucket. A range of fewer than 32 items is sent as a plain list. The responder answers each fingerprint with "same" or with its own subdivision, and each list with its own list. Messages are capped at 1 MiB, a round at 15 seconds, and a session at 1,000 rounds. The result is one-directional: the initiator learns which CIDs the peer has that it lacks. The daemon also computes what the responder would need from the initiator, but does not use it. Seed pulls, and never lets a stranger push. <!-- id:NFiHqoS1 -->

A later tier runs only if the previous one left something owed. The exception is an **exhaustive wave**. Every recursive scope gets one every ten minutes, and a user's fresh interest can force one at most once every two minutes. Within a tier the node talks to up to 20 peers at once. It cuts stragglers once 70 percent are done and downloads have been idle for five seconds. A peer whose dial fails is benched for 30 seconds, doubling up to ten minutes. This only filters eligibility and keeps no reputation. <!-- id:tKAT4bm0 -->

# Ports <!-- id:yH9-GRd7 -->

The daemon has three listeners: libp2p, an HTTP server (which carries gRPC-web, `/ipfs`, `/hm/api/config` and `/debug/*`) and a plain gRPC server. Both HTTP and gRPC bind wildcard addresses, with runtime admission allowing only loopback socket peers in default mode. Server mode trusts deployment networking instead. Every Seed deployment picks its own port block: <!-- id:r5mn0pmN -->

<!-- id:3eZQEvYE -->
| Deployment <!-- col:xSsqC6jm --> | libp2p <!-- col:FlGdXj3L --> | HTTP (gRPC-web, `/ipfs`, `/debug`) <!-- col:VNwbp64X --> | gRPC <!-- col:e909sAB3 --> | Other <!-- col:Orb2hlMs --> <!-- id:EIljUu9Y --> |
| --- | --- | --- | --- | --- |
| `seed-daemon` defaults | 55000 | 55001 | 55002 | <!-- id:qcJNGiIY --> |
| Seed app, production | 56000 | 56001 | 56002 | 56003 metrics, 56004 Seed API bridge <!-- id:P5Fs4jsK --> |
| Seed app, development (`./dev`) | 58000 | 58001 | 58002 | 58003 metrics, 58004 Seed API bridge <!-- id:qYRUih6B --> |
| Self-hosted site (docker compose) | 56000 TCP and UDP, published; host TCP 143 forwards to it | 56001, internal only (the web app and the `/ipfs` proxy use it) | 56002, internal only | 80 and 443 on the proxy <!-- id:LSnMxBHH --> |
| `hyper.media` and `dev.hyper.media` bootstrap addresses | 56001 (QUIC and TCP) and TCP 143 |  |  | <!-- id:o29Au7If --> |
| `staging.hyper.media` bootstrap address | 55001 |  |  | <!-- id:_TKThVuE --> |

The Seed app and the [web app](../software/web.md) always talk to the daemon over gRPC-web on the HTTP port. They never use the plain gRPC port. Networks that block the libp2p port, such as the eduroam university network, leave TCP 143 (IMAP) open, so a site publishes 143 as a second way in to the same TCP listener and announces it. A Seed app learns the address from the site's `/hm/api/config` like any other. <!-- id:9iOmo8-W -->

# Flags that matter to operators <!-- id:3QqngMIS -->

Every flag can also be set as an environment variable with the `SEED_` prefix (`-p2p.port` is `SEED_P2P_PORT`), and `SEED_DAEMON_FLAGS` prepends a string of flags. <!-- id:VxP7Bhfp -->

<!-- id:1vWpv4nJ -->
| Flag <!-- col:uX6RT6Am --> | Default <!-- col:Cfis3a2B --> | Effect <!-- col:j2nEJwUU --> <!-- id:lCMGGhsQ --> |
| --- | --- | --- |
| `-p2p.port` | 55000 | port for the four listen multiaddrs <!-- id:uexjTBvV --> |
| `-p2p.testnet-name` | empty | appends `-<name>` to the protocol id <!-- id:oTYiCOWi --> |
| `-p2p.bootstrap-peers` | the compiled-in list | comma-separated multiaddrs; replaces the list (an empty value is an error and does not mean "none") <!-- id:fGhOLF2y --> |
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

`-syncing.allow-push`, `-syncing.refresh-interval`, `-syncing.smart` and `-syncing.no-sync-back` are parsed and have no effect. `Daemon.ForceSync` returns `Unimplemented`. <!-- id:z4l0WCEN -->

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

On the daemon's HTTP port, under the ordinary API admission policy: `/debug/p2p` (JSON dump of libp2p, Bitswap and the connection manager, including reachability), `/debug/network` (an HTML report of discovery phases, reconciliation, Bitswap outcomes and the inbound limiter), `/debug/metrics` (Prometheus) and `/debug/grpcui/` (an embedded gRPC console). Default mode admits only loopback socket peers; server mode relies on private deployment networking. The sync outcome labels there are `ok`, `preempted`, `protocol_mismatch`, `dial_failed`, `auth_failed`, `putmany_failed` and `rpc_error` per peer, and `connected`, `dht`, `notfound` and `error` per discovery. <!-- id:gWdN_dcN -->

# Local API access

The peer-to-peer services `P2P` and `Syncing` are also re-exported locally behind a `target-peer` metadata key, so a local client can run `ListSpaces` or `ReconcileBlobs` against a remote peer through your daemon. Default mode admits only loopback socket peers and trusts local tools after admission. HTTP requires the Host hostname to be exactly `localhost` or a literal loopback IP and checks browser metadata and exact origins. Hosted servers run with `-server-mode` on a trusted deployment network: keep daemon API ports private and proxy only the public `/ipfs/*` routes. Server mode does not change P2P visibility rules. The [gRPC guide](../build/grpc.md) has the catalogue. <!-- id:ceErZghv -->

# See also

- [Network](../protocol/network.md): how nodes find each other, reconcile and fetch.
- [Seed daemon](../software/daemon.md): the program this page tunes.
- [Self-hosting](./self-hosting.md): the compose file and registration for a site.
- [Troubleshooting](./troubleshooting.md): what to check when something does not sync.
- [gRPC](../build/grpc.md): the daemon's full service catalogue.

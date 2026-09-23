---
name: Network
summary: How Seed nodes find each other and exchange signed blobs over libp2p, using range-based set reconciliation to learn what is missing and Bitswap to fetch it.
---
Every Seed node is a peer on one shared network. When you open a [document](./documents.md) you do not have, your node asks the peers most likely to hold it. It compares notes with them to find exactly which [blobs](./blobs.md) it lacks, and downloads only those. Nothing is broadcast to everyone. Sync follows the [sites](./sites.md), [contacts](./permissions.md) and subscriptions you care about. <!-- id:s6MwlPMV -->

This page describes the network layer of the Seed daemon as it runs today. It is the deepest layer of the [Hypermedia protocol](../protocol.md). Most builders never touch it. They read and write through a site's [Seed API](../build/web-api.md). Read this page to learn why a document appears on another machine, why that sometimes takes a while, or how to run a node that other nodes can reach. <!-- id:rrHf8uOe -->

# Peers and the device key <!-- id:fW5msSPp -->

Each running daemon is one libp2p peer. Its identity on the wire is a **device key**: an [Ed25519](https://en.wikipedia.org/wiki/EdDSA#Ed25519) key pair generated the first time the daemon starts and stored in the data directory. The peer id derived from it is the `12D3Koo…` string you see in the [Seed app](../apps/desktop.md)'s network dialog. <!-- id:UY6Ypwol -->

The device key is separate from any account key. Account keys ([identity](./identity.md)) sign content. The device key only secures connections. One person can run several devices, and a site's server is a device that holds no account key at all. When a connection needs to prove which account is behind it, the peer signs a short-lived [capability](./permissions.md) with the account key (see "Private content" below). The `account_id` field that the networking API still exposes on a peer is always empty today. <!-- id:hZ_imBXf -->

# Protocol id and versions <!-- id:bZHlAHsP -->

Every Seed peer announces the libp2p protocol id `/hypermedia/0.9.2`. A daemon started with a testnet name announces `/hypermedia/0.9.2-<name>` instead. Only that suffix isolates testnets, and the bootstrap list is the same everywhere. A remote peer whose version string does not match exactly is rejected as an incompatible protocol version, so peers on different daemon generations do not sync with each other. The same id names the stream on which the daemon serves its peer-to-peer gRPC services. <!-- id:YLHlb4Ut -->

# Transports and addresses <!-- id:CC2JPslL -->

The daemon uses go-libp2p's default transports (TCP, QUIC, WebSocket, WebTransport and WebRTC-direct), TLS or Noise for the handshake, and yamux for multiplexing. It listens on four multiaddrs for one port `P`: <!-- id:PJyggZK2 -->

``` <!-- id:1v6x7Gi6 -->
/ip4/0.0.0.0/udp/P/quic-v1
/ip4/0.0.0.0/udp/P/quic-v1/webtransport
/ip4/0.0.0.0/udp/P/webrtc-direct
/ip4/0.0.0.0/tcp/P
```

IPv6 listening is off for now. The `-p2p.listen-addrs` flag replaces this set, and `-p2p.announce-addrs` replaces what the node tells others (a site announces `/dns4/<host>/tcp/56000` and `/dns4/<host>/udp/56000/quic-v1`). By default a desktop node also announces and stores private LAN addresses, so two laptops on one network can find each other. `-p2p.no-private-ips` turns that off. <!-- id:XPHhuCFo -->

# Reachability and relays <!-- id:qD9Mpybv -->

Most desktop nodes sit behind NAT. The daemon enables hole punching and AutoNAT. Unless told otherwise, it assumes it is **not** publicly reachable. It asks one of two fixed Seed relay servers for a circuit-relay reservation, and keeps at most two relay connections. Relays are never discovered from the network. The two addresses are compiled in. The daemon itself is never a relay for others. The relay is a separate small program in the repository. <!-- id:zLvDN-Vk -->

A site runs with `-p2p.no-relay=true -p2p.force-reachability-public=true`, so it never uses a relay and always answers direct dials. Current reachability is shown on the loopback-only `/debug/p2p` page. <!-- id:5a2izYC9 -->

# Finding peers <!-- id:626I71gy -->

Seed does not run a distributed hash table (DHT) today. The daemon links the code for a delegated-routing client, but the URL it would talk to is empty by default. So every provider lookup fails quietly, and the local Kademlia code has no callers. Nothing announces "I have this document" to a global index, and a node cannot find a document by its hash alone. The flag help text that promises a local DHT client is wrong. <!-- id:C_91MIol -->

Discovery uses these sources: <!-- id:ypoIObe0 -->
  - **Bootstrap gateways.** Every daemon dials a compiled-in list of Seed servers at startup and keeps them connected: production `hyper.media`, `dev.hyper.media`, `staging.hyper.media` and one community node. These are ordinary site daemons that hold nearly everything public. They form the first tier every discovery asks. The daemon also dials the public kubo bootstrap peers from IPFS, out of habit. They speak no Hypermedia protocol and are filtered out of discovery. <!-- id:MBKb82xz -->
  - **Peer exchange.** After identifying a bootstrap peer, the daemon asks it for its recent peer list (rows updated within 30 days) and stores them in its own `peers` table. A tick every 60 seconds keeps about 20 non-bootstrap Hypermedia peers connected, dialing stored peers when short. Dead peers fade out because their rows stop being refreshed. <!-- id:AHKK0Ycl -->
  - **Site peer resolution.** When a [space](./identity.md) declares a `siteUrl` in its home document [metadata](../metadata.md), the daemon fetches `https://<site>/hm/api/config` to learn the site server's peer id and addresses, and treats that server as the **authority** for the space. The answer is cached for five minutes and remembered in the `domains` table as a fallback. <!-- id:1EGqCshv -->
  - **Explicit connections.** The `Networking.Connect` RPC takes multiaddrs, and the Seed app accepts a peer address, an `hm://connect/…` link or any site URL in its network dialog. <!-- id:JDqif9sd -->
  - **DNS names inside multiaddrs.** DNS appears only in `/dns4/hyper.media/…` addresses and in the HTTPS hostnames of site URLs. There is no DNSLink or TXT-record lookup. <!-- id:utfMssWU -->

So a public document is findable only because some [gateway](./sites.md) or site server has it. The network as a whole keeps no index. A [private](./privacy.md) document is findable only from its site server or from a device that authenticated as an authorized account. <!-- id:VBWkFsW- -->

# What sync exchanges <!-- id:oRGp7Z3y -->

A sync always asks about a **scope**, and never for "everything peer X has". A scope is one [resource](../glossary.md) IRI such as `hm://ACC/notes/foo`, optionally its direct children (`depth one`) or all descendants (`recursive`), optionally restricted to some blob types. Both sides compute the same set of blobs for a scope from their own index: <!-- id:v01a_crK -->
  1. the [Refs](../ref.md), [capabilities](../capability.md), [comments](../comment.md), [profiles](../profile.md) and [contacts](../contact.md) anchored on the resources in scope; <!-- id:45mCSNnK -->
  2. every [change](../change.md) reachable from those Refs through their heads and dependencies; <!-- id:6igt5Qam -->
  3. the media those blobs link to (files, images, chunks), following every link but skipping blobs the index has stashed as unauthorized; <!-- id:1TFxz3Da -->
  4. inbound contacts naming the space's account, when the scope is a whole space; <!-- id:ObsE4rln -->
  5. capabilities with the AGENT role whose delegate authored anything already in the set, repeated until nothing new appears. <!-- id:aueRH4nV -->

Because both peers derive the set with the same rules, they can compare it without listing it. The daemon keeps this set materialized per scope and patches it after every indexing commit. A background verifier recomputes a few scopes every 30 seconds and repairs drift. <!-- id:kyanjcoF -->

# Reconciling with RBSR <!-- id:CCzzBZWN -->

**Range-Based Set Reconciliation** (RBSR) is an algorithm that finds the differences between large sets held by different peers. Each peer recursively compares hash summaries of ordered key ranges, so the peers never exchange every item identifier. When the hash of a range differs, the peers split that range and compare smaller segments until they isolate the exact items that differ. The cost grows with the number of differences, and the total set size barely matters. Seed's implementation follows [Aljoscha Meyer's paper](https://arxiv.org/abs/2212.13567) and the Negentropy design. <!-- id:xySd4TLf -->

In the daemon, an item is `(timestamp, CID)`, ordered by the blob's signed timestamp and then by bytes. Each item's hash is the SHA-256 of its CID bytes, and a range's fingerprint is the first 16 bytes of the SHA-256 of the sum of those hashes followed by the item count. The initiator splits its whole range into 16 buckets and sends one fingerprint per bucket. A range of fewer than 32 items is sent as a plain list. The responder answers each fingerprint with "same" or with its own subdivision, and each list with its own list. Messages are capped at 1 MiB, a round at 15 seconds, and a session at 1,000 rounds. The result is one-directional: the initiator learns which CIDs the peer has that it lacks. The daemon also computes what the responder would need from the initiator, but does not use it. Seed pulls, and never lets a stranger push. <!-- id:NFiHqoS1 -->

# Fetching with Bitswap <!-- id:ceeB4L1N -->

Once the wanted CIDs are known, the blobs themselves travel over [Bitswap](https://docs.ipfs.tech/concepts/bitswap/), the IPFS block exchange. In Bitswap each peer keeps a wantlist of the blocks it needs, exchanges wantlists on connect, and serves what it has. Seed opens one Bitswap session per discovery and fetches in render order: signed DAG-CBOR blobs first, then "chrome" media (icons, covers), then inline images, and finally bulk files. Bulk downloads share a single daemon-wide slot, so a large PDF never starves a page's text. Every block is verified against its [CID](../cid.md) on arrival and indexed like any other blob. [Files](./files.md) covers the media side. <!-- id:FHknLJFV -->

Bitswap has no built-in access control. It accepts a callback that runs for every `(peer, CID)` request. Seed uses that callback to keep private blobs from unauthorized peers (below). <!-- id:8htzlUD2 -->

# Discovery, step by step <!-- id:RyvMaoH1 -->

`DiscoverEntity` is the single entry point that the Seed app, a site server and subscriptions all use. It takes an [`hm://`](./urls.md) discovery URL: <!-- id:hDOJOgRm -->

<!-- id:hHR-wFxJ -->
| URL <!-- col:L51yKcPv --> | Scope <!-- col:OJHggs38 --> <!-- id:nLYNL14P --> |
| --- | --- |
| `hm://ACC` | the home document, all blob types <!-- id:WRlzhBNQ --> |
| `hm://ACC/path` | one document <!-- id:jWQwHNzS --> |
| `hm://ACC/path/*` | the document and its direct children <!-- id:zoImNPgK --> |
| `hm://ACC/path/**` | the document and every descendant <!-- id:NY8AInJp --> |
| `hm://ACC/:profile`, `hm://ACC/path:profile` | profile, Ref and change blobs only <!-- id:HWAiYWf4 --> |

A discovery run has a ten-minute budget and proceeds in tiers: <!-- id:qLpkpCaQ -->
  1. **Authority.** The space's site server, if its `siteUrl` is known, plus the bootstrap gateways. If the space has a site and you already hold the content, the gateways are dropped. <!-- id:n0zX5Ecz -->
  2. **Connected.** A sample of already-connected Hypermedia peers, up to 20. <!-- id:5PXdiW6i -->
  3. **Cold.** Peers from the stored table that need a dial. <!-- id:gsStG1E2 -->

A later tier runs only if the previous one left something owed. The exception is an **exhaustive wave**. Every recursive scope gets one every ten minutes, and a user's fresh interest can force one at most once every two minutes. Within a tier the node talks to up to 20 peers at once. It cuts stragglers once 70 percent are done and downloads have been idle for five seconds. A peer whose dial fails is benched for 30 seconds, doubling up to ten minutes. This only filters eligibility and keeps no reputation. <!-- id:tKAT4bm0 -->

For recursive scopes a quick structure-only pass (Refs and changes, depth one, no media) runs first so a directory listing appears before its files. Once the target resolves locally the run ends with outcome `connected`. If nothing resolved, the run ends with the leftover "DHT" phase, which finds nothing and reports no error. The caller keeps polling. <!-- id:b4tx7iL8 -->

# Hot and cold: the scheduler <!-- id:Tz31gKkU -->

The daemon runs discovery through one scheduler with `-syncing.max-workers` slots (default six) and one slot always reserved for interactive work. <!-- id:wUKjzEQZ -->
  - **Hot tasks** come from a client that is looking at something. The Seed app calls `DiscoverEntity` for the document on screen every few seconds. Each call is a heartbeat that keeps the task alive for 40 seconds and reruns it every 10 seconds. Hot tasks are last-in-first-out and may preempt an idle background run. <!-- id:LIkGyvRh -->
  - **Cold tasks** are subscriptions. They rerun every `-syncing.interval` (default one minute) after completing, clumped a few seconds together to save battery. <!-- id:D5xC6MPG -->

As a scope settles, the fan-out narrows and the frequency stays the same. A scope you already hold, or a recursive scope whose last two waves fetched nothing, adds no random sample at all. It asks only the site server, or the gateways when there is no site server. A scope you lack whose site server is known samples two extra peers, and only a scope with no known host samples twenty. <!-- id:z4__ZMV7 -->

# Subscriptions <!-- id:qdL5oZqn -->

A subscription is a row `(iri, recursive)` and a standing cold task for it. `Subscriptions.Subscribe` stores the row, schedules the task and runs one discovery right away (synchronously, unless asked to run in the background or the resource is already local). A site server subscribes recursively to every account registered on it. That keeps a whole space current on the site. The Seed app subscribes to the spaces you join or follow. There is no "mirror everything from peer X" mode any more. The older `-syncing.smart` and `-syncing.no-sync-back` flags are accepted and ignored, and `Daemon.ForceSync` returns Unimplemented. <!-- id:Rre7kjpx -->

# Push <!-- id:N3Jjt-C7 -->

Pull is the default, but a publisher should not have to wait for its site to poll. `Resources.PushResourcesToPeer` takes a peer's addresses and a list of resources, computes the related material (changes, Refs, the authors' root Refs and profiles, link targets, [citations](./comments.md), comment links, and media), and calls the peer's `AnnounceBlobs` RPC with the CIDs. The receiving daemon checks which CIDs it lacks, fetches them over Bitswap from the announcer, and indexes them. Progress streams back to the caller. <!-- id:1gzJjA-e -->

The Seed app pushes when you publish a document, when you register a site, and when you push a document to a site explicitly. It pushes to the space's site server and to the site servers of the documents you referenced, so that citations and backlinks appear on the self-hosted sites of the people you cite. Private blobs are included in a push only when the target is the space's own site server. A receiving node accepts any announcement (the `-syncing.allow-push` flag exists but nothing reads it). It can only fetch what the announcer is willing to serve it. Push only speeds up sync. Publishing happens when you sign: your blobs exist in your local daemon from that moment, even if the push announces nothing. <!-- id:tzqHChlt -->

# Sync and gossip <!-- id:1C6REGld -->

Seed's peer-to-peer sync is built around [identity](./identity.md), trust and relevance. So it works very differently from [gossip protocols](https://en.wikipedia.org/wiki/Gossip_protocol), although both run in distributed peer-to-peer networks. <!-- id:JTmIApFc -->

**Seed sync is narrowly scoped.** Gossip protocols spread messages across a broad set of peers with mesh fan-out and probabilistic forwarding. They do not know who should receive a message, only that it should spread, and spam spreads the same way. Seed sync replicates resources only to peers with explicit trust or relevance relationships. It does no broadcast and no fan-out. <!-- id:Np6hvCgY -->

**Identity defines Seed's propagation graph.** Eligible recipients are known in advance: verified owners of sites, trusted [contacts](./permissions.md) (and so their peers, including identity delegation), and explicit subscriptions. The graph is directed, bounded and controlled by users. A node should never push content to uninterested or random peers. <!-- id:ZRCc3DMM -->

**Seed does not use epidemic convergence.** Gossip repeats spreading until coverage is highly probable. Seed does no mesh spreading, no redundant forwarding of blobs, and no probabilistic delivery across the network. Sync delivers to targets. <!-- id:cjYOcj2Z -->

Discovery does contact up to 20 peers per tier. That fan-out is a _pull_ asking "do you have this?", scoped to one resource. It never pushes your content to strangers. Seed's design direction is to keep narrowing that pull as trust relationships become explicit. <!-- id:M5oOcjbz -->

# Private content over the network <!-- id:fvIIPM6D -->

Public blobs are served to anyone who asks. A [private](./privacy.md) blob ([visibility](../visibility.md)) is served to a peer only if one of these holds: <!-- id:iS2tjilm -->
  - the peer authenticated as the account that owns the space, or as an account holding a [WRITER](./permissions.md) [capability](../capability.md) for it; <!-- id:ZPz5rNOI -->
  - the peer is the space's site server, as reported by `https://<siteUrl>/hm/api/config`; <!-- id:bNyYTDro -->
  - the blob is allow-listed for that peer for the duration of a push. <!-- id:w6NR4xAH -->

Authentication is the `P2P.Authenticate` RPC: the caller sends its account, a millisecond timestamp and a signature over an ephemeral capability blob that delegates from the account to the caller's peer id with the server's peer id as audience. The server accepts a one-minute clock skew and remembers the binding until the connection closes. A desktop node authenticates automatically toward the site servers of every space its keys can write to, and only there. <!-- id:jHpRxoGE -->

The same rule shapes reconciliation. Before answering, a peer filters its scope set to what the caller may see and folds private items out of the fingerprints. So an unauthorized peer never learns that a private blob exists. [Privacy](./privacy.md) has the full HTTP-side rules. <!-- id:acPTtPhz -->

# Worked example: a document you do not have <!-- id:8gc6eN0x -->

You open `hm://ACC/notes/foo` in the Seed app and nothing about `ACC` is on your machine yet. <!-- id:p3LkUrxf -->
  1. The app calls `DiscoverEntity` with that URL and keeps calling it every few seconds while the view is open. The daemon creates a hot task and, because you just showed interest, arms one exhaustive wave. <!-- id:l0dKo1tH -->
  2. The scheduler dispatches the task at once in the reserved hot slot. <!-- id:rI9GIrsT -->
  3. The daemon looks for `ACC`'s `siteUrl`. It knows nothing, so there is no site server. The wave is a full search: every bootstrap gateway plus a sample of 20 peers. <!-- id:aW6eMg6v -->
  4. A local reconciliation store for the scope is built. It is empty. <!-- id:foNjEbdE -->
  5. Tier `authority` runs first. For each gateway the daemon opens (or reuses) a gRPC stream over libp2p, asks which spaces it may see (public only, since it did not authenticate), and runs `ReconcileBlobs` rounds for the filter `hm://ACC/notes/foo` until the ranges agree. <!-- id:Ow6Xre8P -->
  6. The wanted CIDs go to Bitswap: DAG-CBOR blobs first, then icons and inline images, then bulk files if the media slot is free. Blocks stream through one writer into the index, which also patches the maintained scope sets. <!-- id:K0CNVaEB -->
  7. The authority tier is satisfied, so the connected and cold tiers are skipped unless this is the exhaustive wave. <!-- id:OcxqwPsy -->
  8. `GetResource` now resolves. The task completes with the version, and reruns on the ten-second cooldown while you keep looking. <!-- id:hdCaY0qt -->
  9. Later, once `ACC`'s home document (and its `siteUrl`) has arrived and you have subscribed, a settled run asks only the site server. It makes one reconciliation round trip every ten seconds while viewed and once a minute otherwise, plus one full-width probe every ten minutes. <!-- id:vgnaIEH- -->

If step 5 finds nothing anywhere, the run ends with an empty version and no error. The page keeps showing its "looking for this document" state, and the task retries with the same peer set every ten seconds. <!-- id:ePa3MdMI -->

# Reference <!-- id:j2EZU_KH -->

## Ports <!-- id:yH9-GRd7 -->

The daemon has three listeners: libp2p, an HTTP server (which carries gRPC-web, `/ipfs`, `/hm/api/config` and the loopback-only `/debug/*` pages) and a plain gRPC server. Both HTTP and gRPC bind all interfaces, including non-loopback ones. Every Seed deployment picks its own port block: <!-- id:r5mn0pmN -->

<!-- id:3eZQEvYE -->
| Deployment <!-- col:xSsqC6jm --> | libp2p <!-- col:FlGdXj3L --> | HTTP (gRPC-web, `/ipfs`, `/debug`) <!-- col:VNwbp64X --> | gRPC <!-- col:e909sAB3 --> | Other <!-- col:Orb2hlMs --> <!-- id:EIljUu9Y --> |
| --- | --- | --- | --- | --- |
| `seed-daemon` defaults | 55000 | 55001 | 55002 | <!-- id:qcJNGiIY --> |
| Seed app, production | 56000 | 56001 | 56002 | 56003 metrics, 56004 Seed API bridge <!-- id:P5Fs4jsK --> |
| Seed app, development (`./dev`) | 58000 | 58001 | 58002 | 58003 metrics, 58004 Seed API bridge <!-- id:qYRUih6B --> |
| Self-hosted site (docker compose) | 56000 TCP and UDP, published | 56001, internal only (the web app and the `/ipfs` proxy use it) | 56002, internal only | 80 and 443 on the proxy <!-- id:LSnMxBHH --> |
| `hyper.media` and `dev.hyper.media` bootstrap addresses | 56001 (QUIC and TCP) and TCP 143 |  |  | <!-- id:o29Au7If --> |
| `staging.hyper.media` bootstrap address | 55001 |  |  | <!-- id:_TKThVuE --> |

The Seed app and the [web app](../apps/web.md) always talk to the daemon over gRPC-web on the HTTP port. They never use the plain gRPC port. The hosted `hyper.media` servers appear to map their libp2p listener to 56001, with 143 as a second TCP listener for restrictive firewalls. That layout is not in this repository. For those hosts, trust the bootstrap addresses over the compose file. Older team notes that mention 53101 describe a standalone web daemon that no longer exists. <!-- id:9iOmo8-W -->

## Flags that matter to operators <!-- id:3QqngMIS -->

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
| `-public-only` | false | serve only public data over HTTP and gRPC (what hosted sites run) <!-- id:fPjzahjC --> |

`-syncing.allow-push`, `-syncing.refresh-interval`, `-syncing.smart` and `-syncing.no-sync-back` are parsed and have no effect. <!-- id:z4l0WCEN -->

## Constants <!-- id:3NI0uq_X -->

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

## Debug pages and metrics <!-- id:BYh0isvq -->

On the daemon's HTTP port, reachable only from the same machine: `/debug/p2p` (JSON dump of libp2p, Bitswap and the connection manager, including reachability), `/debug/network` (an HTML report of discovery phases, reconciliation, Bitswap outcomes and the inbound limiter), `/debug/metrics` (Prometheus) and `/debug/grpcui/` (an embedded gRPC console). The sync outcome labels there are `ok`, `preempted`, `protocol_mismatch`, `dial_failed`, `auth_failed`, `putmany_failed` and `rpc_error` per peer, and `connected`, `dht`, `notfound` and `error` per discovery. <!-- id:gWdN_dcN -->

# Working with the network <!-- id:56Wwc-GS -->

## In the Seed app <!-- id:NspzMlft -->

The network dialog (from the app's settings or the connection indicator) lists connected peers with their short peer id, protocol and the domains known for them, and lets you copy a peer's addresses. "Add connection" accepts a raw multiaddr list, an `hm://connect/…` or `https://…/hm/connect#…` link generated by another Seed app, or any site URL, which the app resolves through that site's `/hm/api/config`. The app keeps a gateway URL setting (default `https://hyper.media`) and shows whether that gateway is reachable. Publishing a document pushes it to the space's site server and to the sites of referenced documents, with per-host progress. "Publish Site" registers a space with a site and pushes its home document with that document's related material. The site's recursive subscription pulls the rest. Subscriptions happen when you join a site or follow an account. <!-- id:BPFMRl6v -->

## CLI <!-- id:92u9c-9q -->

The [Seed CLI](../build/cli.md) runs no peer. It talks HTTPS to a site (default `https://hyper.media`, or `--server`), signs locally and publishes through that site's [Seed API](../build/web-api.md). The site's daemon does the networking. When the site does not yet hold a document you ask for, `GET /api/DiscoveryStatus?uid=…&path=…` on that site pokes its daemon and reports `pending`, `found` or `failed`. The CLI has no commands for peers, subscriptions or push. Use gRPC against a daemon for those (below). The [CLI reference](../build/cli.md) lists every command. <!-- id:cov2Cv33 -->

## SDK <!-- id:ud6p7qig -->

The [SDK](../build/sdk.md), `@seed-hypermedia/client`, has no libp2p either. `createSeedClient(baseUrl)` reads and publishes through a site. `client.request('DiscoveryStatus', {uid, path, version?, latest?})` is the non-blocking discovery poke. `resolveHypermediaUrl(url)` turns a web URL into an `hm://` id by asking `GetDomain` or the page's `X-Hypermedia-*` headers. `GetDomain` and `ListDomains` expose the daemon's domain table (peer id, registered account, gateway flag, last check). See the [SDK guide](../build/sdk.md). <!-- id:641cdQbW -->

## Web API <!-- id:w2oRNUi- -->

A site's [Seed API](../build/web-api.md) exposes discovery as `GET /api/DiscoveryStatus` (flat params `uid`, `path`, `v`, `l`). The site services expose `POST /hm/api/discover` with JSON `{uid, path[], version?, media?}`, which blocks until the site's daemon has the document (and, with `media`, its files). `GET /hm/api/config` describes the peer: `{peerId, protocolId, addrs, registeredAccountUid, isGateway, …}`. The daemon's own HTTP port answers the same path with only `{peerId, addrs, protocolId}`. <!-- id:WItao87q -->

For deep integration the daemon's gRPC surface (plain gRPC on its gRPC port, or gRPC-web on the HTTP port, both with reflection) has these calls: <!-- id:eU7Ugij2 -->
  - `Networking.GetPeerInfo`, `Networking.ListPeers` (no addresses, by design) and `Networking.Connect(addrs)`. <!-- id:7voiOes4 -->
  - `Subscriptions.Subscribe/Unsubscribe/ListSubscriptions`. <!-- id:kvpyNysS -->
  - `Entities.DiscoverEntity(id, version?)`. <!-- id:9mUDFYsX -->
  - `Resources.PushResourcesToPeer(addrs, resources)`. Its `recursive` field is ignored today. <!-- id:0Shqcv40 -->
  - `Daemon.GetInfo` for your own peer id and protocol id. <!-- id:bgeUY0Z- -->

The peer-to-peer services `P2P` and `Syncing` are also re-exported locally behind a `target-peer` metadata key, so a local client can run `ListSpaces` or `ReconcileBlobs` against a remote peer through your daemon. A local daemon's API has no authentication. Keep it on localhost or behind a firewall, and run public servers with `-public-only`. The [gRPC guide](../build/grpc.md) has the catalogue. <!-- id:ceErZghv -->

```sh <!-- id:FZrOsxuq -->
grpcurl -plaintext localhost:56002 com.seed.networking.v1alpha.Networking/ListPeers
grpcurl -plaintext -d '{"id":"hm://ACC/notes/foo"}' localhost:56002 \
  com.seed.entities.v1alpha.Entities/DiscoverEntity
```

## Agents <!-- id:oUrThvEg -->

[Seed Agents](../agent.md) read and write through a site's Seed API, like the CLI. [`read`](../agent/read.md) of `hm://ACC/notes/foo` asks the configured site, and that site's daemon discovers what it lacks. Hosted agents use `https://hyper.media`. The desktop's built-in agent uses the app's own daemon through its local bridge. An agent never sees peers, relays or reconciliation. An agent that drives a site with `curl` can use the same `DiscoveryStatus` and `/hm/api/discover` calls. External agents using the `seed-cli` skill inherit the CLI's behaviour above. See [using Seed from your own agent](../build/agents.md). <!-- id:g3tI7XJo -->

# Where this is going <!-- id:KowfZ7Nb -->

As of September 2026 the network layer is stable, and two things are open. First, routing. With no DHT, a fresh install can only reach content held by a gateway, a site server or a peer it was told about. A delegated-routing server or a real provider system is the next step, and unused code hooks exist for both. Second, the team wants to narrow discovery toward explicit trust relationships (sites you joined, contacts, subscriptions) and stop sampling twenty peers. The team also wants to expose subscriptions through the public API as well as gRPC. The HM26 redesign notes on the [roadmap](./roadmap.md) touch both. <!-- id:KKqDkzn8 -->

# See also <!-- id:69ZiysmY -->

- [Sites](./sites.md): what a site server is and how registration makes it the authority for a space. <!-- id:_4OPjj29 -->
- [Files](./files.md): how media travels over the same Bitswap sessions and the `/ipfs` gateway. <!-- id:XrRcRSJk -->
- [Privacy](./privacy.md) and [Integrity](./integrity.md): what a peer may see and what is verified. <!-- id:P2cn3zac -->
- [Identity](./identity.md): account keys versus the device key. <!-- id:GN1r8jDV -->
- [Self-hosting](../build/self-hosting.md): the compose file, ports and registration link for running your own node. <!-- id:NTPVJGG5 -->
- [Signed Blobs](./blobs.md): the data that moves, with the schema pages [blob](../blob.md), [change](../change.md) and [ref](../ref.md). <!-- id:RXbiH6dR -->

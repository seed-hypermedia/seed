---
name: Network
summary: How Seed nodes find each other and exchange signed blobs over libp2p, using range-based set reconciliation to learn what is missing and Bitswap to fetch it.
---
Every Seed node is a peer on one shared network. When you open a [document](./documents.md) you do not have, your node asks the peers most likely to hold it. It compares notes with them to find exactly which [blobs](./blobs.md) it lacks, and downloads only those. Nothing is broadcast to everyone. Sync follows the [sites](./sites.md), [contacts](./contacts.md) and subscriptions you care about. <!-- id:s6MwlPMV -->

This page describes the network layer of the Seed daemon. It is the deepest layer of the [Hypermedia protocol](../protocol.md). Most builders never touch it. They read and write through a site's [Seed API](../build/web-api.md). Read this page to learn why a document appears on another machine and why that sometimes takes a while. To run a node that other nodes can reach, read the [daemon network reference](../operate/daemon-network.md), which has the ports, flags, constants and debug pages. <!-- id:rrHf8uOe -->

# Peers and the device key <!-- id:fW5msSPp -->

Each running daemon is one libp2p peer. Its identity on the wire is a **device key**: an [Ed25519](https://en.wikipedia.org/wiki/EdDSA#Ed25519) key pair generated the first time the daemon starts and stored in the data directory. The peer id derived from it is the `12D3Koo…` string you see in the [Seed app](../software/desktop.md)'s network dialog. <!-- id:UY6Ypwol -->

The device key is separate from any account key. Account keys ([identity](./identity.md)) sign content. The device key only secures connections. One person can run several devices, and a site's server is a device that holds no account key at all. When a connection needs to prove which account is behind it, the peer signs a short-lived [capability](./permissions.md) with the account key (see [Privacy](./privacy.md)). The `account_id` field that the networking API exposes on a peer is always empty. <!-- id:hZ_imBXf -->

# Protocol id and versions <!-- id:bZHlAHsP -->

Every Seed peer announces the libp2p protocol id `/hypermedia/0.9.2`. A daemon started with a testnet name announces `/hypermedia/0.9.2-<name>` instead. Only that suffix isolates testnets, and the bootstrap list is the same everywhere. A remote peer whose version string does not match exactly is rejected as an incompatible protocol version, so peers on different daemon generations do not sync with each other. The same id names the stream on which the daemon serves its peer-to-peer gRPC services. <!-- id:YLHlb4Ut -->

# Transports and reachability

Peers connect over the default go-libp2p transports: TCP, QUIC, WebSocket, WebTransport and WebRTC-direct. Most desktop nodes sit behind NAT, so they use hole punching and a circuit relay to be reachable. A site server is always directly reachable and never uses a relay. The [daemon network reference](../operate/daemon-network.md) has the listen addresses, the relay servers and the flags that control them.

# Finding peers <!-- id:626I71gy -->

Seed does not run a distributed hash table (DHT). Nothing announces "I have this document" to a global index, and a node cannot find a document by its hash alone. <!-- id:C_91MIol -->

Discovery uses these sources: <!-- id:ypoIObe0 -->
  - **Bootstrap gateways.** Every daemon dials a compiled-in list of Seed servers at startup and keeps them connected: production `hyper.media`, `dev.hyper.media`, `staging.hyper.media` and one community node. These are ordinary site daemons that hold nearly everything public. They form the first tier every discovery asks. The daemon also dials the public kubo bootstrap peers from IPFS, out of habit. They speak no Hypermedia protocol and are filtered out of discovery. <!-- id:MBKb82xz -->
  - **Peer exchange.** After identifying a bootstrap peer, the daemon asks it for its recent peer list (rows updated within 30 days) and stores them in its own `peers` table. A tick every 60 seconds keeps about 20 non-bootstrap Hypermedia peers connected, dialing stored peers when short. Dead peers fade out because their rows stop being refreshed. <!-- id:AHKK0Ycl -->
  - **Site peer resolution.** When a [space](./spaces.md) declares a `siteUrl` in its home document [metadata](../metadata.md), the daemon fetches `https://<site>/hm/api/config` to learn the site server's peer id and addresses, and treats that server as the **authority** for the space. The answer is cached for five minutes and remembered in the `domains` table as a fallback. <!-- id:1EGqCshv -->
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

The result is one-directional: the initiator learns which CIDs the peer has that it lacks. Seed pulls, and never lets a stranger push. The [daemon network reference](../operate/daemon-network.md) has the item order, fingerprint and message limits the daemon uses.

# Fetching with Bitswap <!-- id:ceeB4L1N -->

Once the wanted CIDs are known, the blobs themselves travel over [Bitswap](https://docs.ipfs.tech/concepts/bitswap/), the IPFS block exchange. In Bitswap each peer keeps a wantlist of the blocks it needs, exchanges wantlists on connect, and serves what it has. Seed opens one Bitswap session per discovery and fetches in render order: signed DAG-CBOR blobs first, then "chrome" media (icons, covers), then inline images, and finally bulk files. Bulk downloads share a single daemon-wide slot, so a large PDF never starves a page's text. Every block is verified against its [CID](../cid.md) on arrival and indexed like any other blob. [Files](./files.md) covers the media side. <!-- id:FHknLJFV -->

Bitswap has no built-in access control. It accepts a callback that runs for every `(peer, CID)` request. Seed uses that callback to keep private blobs from unauthorized peers (see [Privacy](./privacy.md)). <!-- id:8htzlUD2 -->

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

A later tier runs only if the previous one left something owed. The exception is an **exhaustive wave**, a full-width search that every recursive scope gets on a fixed interval and that a user's fresh interest can force. The [daemon network reference](../operate/daemon-network.md) has the intervals, the per-tier limits and the rule for benching peers that fail to dial.

For recursive scopes a quick structure-only pass (Refs and changes, depth one, no media) runs first so a directory listing appears before its files. Once the target resolves locally the run ends with outcome `connected`. If nothing resolved, the run ends with the leftover "DHT" phase, which finds nothing and reports no error. The caller keeps polling. <!-- id:b4tx7iL8 -->

# Hot and cold tasks

The daemon runs every discovery through one scheduler. A **hot task** comes from a client that is looking at something: the Seed app calls `DiscoverEntity` for the document on screen every few seconds, and each call keeps the task alive. A **cold task** is a subscription, rerun on a fixed interval. One scheduler slot is always reserved for hot work, so background sync never delays the document on screen. As a scope settles, the daemon asks fewer peers about it. The [daemon network reference](../operate/daemon-network.md) has the scheduler's slots, intervals and fan-out rules.

# Subscriptions <!-- id:qdL5oZqn -->

A subscription is a row `(iri, recursive)` and a standing cold task for it. `Subscriptions.Subscribe` stores the row, schedules the task and runs one discovery right away (synchronously, unless asked to run in the background or the resource is already local). A site server subscribes recursively to every account registered on it. That keeps a whole space current on the site. The Seed app subscribes to the spaces you join or follow. There is no mode that mirrors everything a peer holds. <!-- id:Rre7kjpx -->

# Push <!-- id:N3Jjt-C7 -->

Pull is the default, but a publisher should not have to wait for its site to poll. `Resources.PushResourcesToPeer` takes a peer's addresses and a list of resources, computes the related material (changes, Refs, the authors' root Refs and profiles, link targets, [citations](./links-and-citations.md), comment links, and media), and calls the peer's `AnnounceBlobs` RPC with the CIDs. The receiving daemon checks which CIDs it lacks, fetches them over Bitswap from the announcer, and indexes them. Progress streams back to the caller. <!-- id:1gzJjA-e -->

The Seed app pushes when you publish a document, when you register a site, and when you push a document to a site explicitly. It pushes to the space's site server and to the site servers of the documents you referenced, so that citations and backlinks appear on the self-hosted sites of the people you cite. Private blobs are included in a push only when the target is the space's own site server. A receiving node accepts any announcement. It can only fetch what the announcer is willing to serve it. Push only speeds up sync. Publishing happens when you sign: your blobs exist in your local daemon from that moment, even if the push announces nothing. <!-- id:tzqHChlt -->

# Sync and gossip <!-- id:1C6REGld -->

Seed's peer-to-peer sync is built around [identity](./identity.md), trust and relevance. So it works very differently from [gossip protocols](https://en.wikipedia.org/wiki/Gossip_protocol), although both run in distributed peer-to-peer networks. <!-- id:JTmIApFc -->

**Seed sync is narrowly scoped.** Gossip protocols spread messages across a broad set of peers with mesh fan-out and probabilistic forwarding. They do not know who should receive a message, only that it should spread, and spam spreads the same way. Seed sync replicates resources only to peers with explicit trust or relevance relationships. It does no broadcast and no fan-out. <!-- id:Np6hvCgY -->

**Identity defines Seed's propagation graph.** Eligible recipients are known in advance: verified owners of sites, trusted [contacts](./contacts.md) (and so their peers, including identity delegation), and explicit subscriptions. The graph is directed, bounded and controlled by users. A node should never push content to uninterested or random peers. <!-- id:ZRCc3DMM -->

**Seed does not use epidemic convergence.** Gossip repeats spreading until coverage is highly probable. Seed does no mesh spreading, no redundant forwarding of blobs, and no probabilistic delivery across the network. Sync delivers to targets. <!-- id:cjYOcj2Z -->

Discovery does contact up to 20 peers per tier. That fan-out is a _pull_ asking "do you have this?", scoped to one resource. It never pushes your content to strangers. <!-- id:M5oOcjbz -->

# Private content over the network <!-- id:fvIIPM6D -->

Public blobs are served to anyone who asks. A [private](./privacy.md) blob ([visibility](../visibility.md)) is served only to a peer that authenticated as an authorized account, to the space's site server, or to the target of a push. <!-- id:iS2tjilm -->

The same rule shapes reconciliation. Before answering, a peer filters its scope set to what the caller may see and folds private items out of the fingerprints. So an unauthorized peer never learns that a private blob exists. [Privacy](./privacy.md) has the full rules for peers and for HTTP. <!-- id:acPTtPhz -->

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

# Working with the network <!-- id:56Wwc-GS -->

Only the daemon speaks libp2p. The [Seed CLI](../build/cli.md), the [SDK](../build/sdk.md) and [Seed Agents](../build/agents.md) run no peer. They read and publish through a site's [Seed API](../build/web-api.md), and that site's daemon does the networking.
  - **In the Seed app.** The network dialog lists connected peers. "Add connection" accepts a multiaddr list, an `hm://connect/…` or `https://…/hm/connect#…` link from another Seed app, or any site URL.
  - **Through a site.** `GET /api/DiscoveryStatus?uid=…&path=…` asks the site's daemon to look for a document it does not hold and reports `pending`, `found` or `failed`. `POST /hm/api/discover` blocks until the daemon has the document. `GET /hm/api/config` describes the site's peer. The [Seed API](../build/web-api.md) guide has the shapes, and the SDK calls the same routes with `client.request('DiscoveryStatus', …)`.
  - **Against a daemon.** The [gRPC](../build/grpc.md) surface has the calls for peers, subscriptions, discovery and push:

    - `Networking.GetPeerInfo`, `Networking.ListPeers` (no addresses, by design) and `Networking.Connect(addrs)`. <!-- id:7voiOes4 -->
    - `Subscriptions.Subscribe/Unsubscribe/ListSubscriptions`. <!-- id:kvpyNysS -->
    - `Entities.DiscoverEntity(id, version?)`. <!-- id:9mUDFYsX -->
    - `Resources.PushResourcesToPeer(addrs, resources)`. Its `recursive` field has no effect. <!-- id:0Shqcv40 -->
    - `Daemon.GetInfo` for your own peer id and protocol id. <!-- id:bgeUY0Z- -->

```sh <!-- id:FZrOsxuq -->
grpcurl -plaintext localhost:56002 com.seed.networking.v1alpha.Networking/ListPeers
grpcurl -plaintext -d '{"id":"hm://ACC/notes/foo"}' localhost:56002 \
  com.seed.entities.v1alpha.Entities/DiscoverEntity
```

# See also <!-- id:69ZiysmY -->

- [Sites](./sites.md): what a site server is and how registration makes it the authority for a space. <!-- id:_4OPjj29 -->
- [Files](./files.md): how media travels over the same Bitswap sessions and the `/ipfs` gateway. <!-- id:XrRcRSJk -->
- [Privacy](./privacy.md) and [Integrity](./integrity.md): what a peer may see and what is verified. <!-- id:P2cn3zac -->
- [Identity](./identity.md): account keys versus the device key. <!-- id:GN1r8jDV -->
- [Daemon network reference](../operate/daemon-network.md): ports, flags, constants, transports, relays, the scheduler and debug pages.
- [Self-hosting](../operate/self-hosting.md): the compose file, ports and registration link for running your own node. <!-- id:NTPVJGG5 -->
- [Signed Blobs](./blobs.md): the data that moves, with the schema pages [blob](../blob.md), [change](../change.md) and [ref](../ref.md). <!-- id:RXbiH6dR -->

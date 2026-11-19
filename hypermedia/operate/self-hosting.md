---
name: Self-hosting
summary: This guide shows how to run your own Seed site on a Linux server with the deploy script, register your space from the Seed app, and keep the site updated, backed up and reachable on your domain.
---
A Seed [site](../protocol/sites.md) shows one [space](../protocol/spaces.md) at a web domain. It is three containers: a [Seed daemon](../software/daemon.md), a [Seed web app](../software/web.md), and a reverse proxy in front of them. This guide runs those three containers on a server you control. You install the site, register a space, and look after the node from day to day. <!-- id:m5g9GCjF -->

If the site is already running and something is wrong, the first thing to check is `seed-deploy doctor`.

The hosted service runs sites for you under `*.hyper.media`. Your content and your [key](../protocol/identity.md) stay yours either way. So a hosted site can move to your own server later, and back again. An organization that wants a closed node for invited people only uses the [enterprise node](./enterprise-node.md) profile of the same script.

**Goal.** A site at `https://example.org` that publishes your space, gets TLS certificates by itself, checks for updates every ten minutes, and can be backed up with one command. <!-- id:BjaNX3tF -->

**Prerequisites.** <!-- id:DJRbdi8X -->
  - A Linux server with about 2 GB of RAM, a public IPv4 address, and ports 80 and 443 free. The deploy script needs `glibc` 2.25 or newer, which means Ubuntu 18.04, Debian 10, RHEL 8, Fedora 28 or Amazon Linux 2023 and later. It installs Docker and [Bun](https://bun.sh/) if they are missing. <!-- id:d7Tn8Tvy -->
  - A domain name you control, with access to its DNS records. <!-- id:zum2Xo9b -->
  - The [Seed desktop app](../software/desktop.md) with the space you want to publish, and its key. Whoever holds that key can publish to the site. <!-- id:MybpMXQm -->

# 1. Point the domain at the server <!-- id:3BEmtxgu -->

At your DNS provider, add an `A` record for the domain. The name is `@` for the root, or a subdomain such as `docs`. The value is the server's IP address. Do this first. The proxy asks Let's Encrypt for a certificate when it first starts, and that works only once the name leads to the server. <!-- id:44XlNfaJ -->

# 2. Run the deploy script <!-- id:7oxvMDev -->

Log in as root or as a user with `sudo`, and run: <!-- id:eWW1L2-a -->

```sh <!-- id:Y-SDXUh5 -->
curl -fsSL https://deploy.seed.hyper.media | sh
```

That URL serves the bootstrap script, which is `ops/deploy.sh` on the `main` branch of the Seed repository. (The address is run by the Seed team and can change.) You can get the script from GitHub directly if you want to read it first. The bootstrap script does four things: <!-- id:LkTUHoaL -->

1. It installs Docker and Bun when they are missing.
2. It downloads the deploy program to `/usr/local/lib/seed/deploy.js`.
3. It installs the `seed-deploy` command.
4. It starts a wizard that asks you questions.

The wizard asks: <!-- id:V8Vv6kDw -->

<!-- id:jnEd7ls6 -->
| Question <!-- col:xxu6Oy70 --> | What to answer <!-- col:9dB-CWsG --> <!-- id:DGKoRMiN --> |
| --- | --- |
| Public hostname | the full URL, `https://example.org` <!-- id:_2wOpp0M --> |
| P2P network | Mainnet, unless you are testing against the team's dev network <!-- id:bloR0LZW --> |
| Release channel | Stable (`latest`) for the released images; Bleeding edge (`dev`) tracks `main` <!-- id:K40FtFaY --> |
| Log level | Info <!-- id:sq8TazXi --> |
| Gateway mode | No, for a site that publishes one space; Yes makes the node serve every public account it learns about, like `hyper.media` <!-- id:ULr-bkUF --> |
| Agents | No, unless you want to run [Seed Agents](../agent.md) on the site itself, at `https://example.org/hm/api/apps` <!-- id:v1UGWEYM --> |
| Contact email | optional, for security notices <!-- id:6Xta8RjE --> |

The contact email is the only way a security notice reaches you. The script does not tell the Seed team about your deployment.

The script then writes the configuration, makes a Caddyfile, pulls the images and starts the containers. A first deploy ends with: <!-- id:wNxm1pUP -->

``` <!-- id:0xlrFWjZ -->
Setup complete
  Your site is live at https://example.org

  Registration URL:
  https://example.org/hm/register?secret=…

Copy this URL and paste it into the Seed desktop app
to link your publisher account to this site.
```

Until you register a space, the site shows a "not registered" page. `seed-deploy secret` prints the registration URL again. <!-- id:Kbuubsnb -->

# 3. Register your space from the Seed app <!-- id:7NO6ywu_ -->

1. In the desktop app, open the space.
2. Choose **Publish Site** from the options menu at the top right.
3. Paste the registration URL and confirm.

This is what happens: <!-- id:ojfgDQRq -->

- The app reads the site's `/hm/api/config`.
- The app sends its [account](../protocol/identity.md) id and its [peer](../protocol/network.md) addresses to `/hm/api/register`, with the secret.
- The app pushes the space's [home document](../protocol/spaces.md), and what belongs to it, to the site's daemon.
- The site records the account and [subscribes](../protocol/network.md) its daemon to the space. From then on it shows that account's home [document](../protocol/documents.md) at `https://example.org`.

Registration uses up the secret. A registered site refuses any other account. To move a site to another space: <!-- id:Kj_aBupp -->

1. Replace the web configuration file (`web/config.json`, described below) with `{"availableRegistrationSecret": "<secret>"}`. The secret from `seed-deploy secret` works.
2. Run `seed-deploy restart`, so the web app reads the file again.
3. Register again.

# What is running <!-- id:Tc2sHwL6 -->

Three containers run. The compose file that the script downloads from the repository defines them. <!-- id:_4EyLyS4 -->

<!-- id:5tv0t3iJ -->
| Container <!-- col:nCbRVSuL --> | Image <!-- col:o5lhpOcI --> | Ports on the host <!-- col:zpYLky3C --> | Role <!-- col:PN9x-oKW --> <!-- id:ZWYWhuGR --> |
| --- | --- | --- | --- |
| `seed-proxy` | `caddy:2` | 80, 443, 443/udp | TLS from Let's Encrypt, then reverse proxy <!-- id:JRlA2dUp --> |
| `seed-web` | `seedhypermedia/web` | 3000 | the Seed web app: pages, the [Seed API](../build/web-api.md), [site services](../build/site-services.md) <!-- id:F1mI7hqv --> |
| `seed-daemon` | `seedhypermedia/site` | 56000, 56000/udp and 143 | the Seed daemon: storage, indexing, libp2p <!-- id:hZP5lv-s --> |

How the pieces fit together: <!-- id:vOtNmSQ4 -->

- **Routing.** Caddy sends `/ipfs/*` to the daemon and everything else to the web app.
- **Agents.** With agents on, a fourth container runs: `seed-agents` (image `seedhypermedia/agents`, compose profile `agents`, data in `agents/`). It answers `/hm/api/apps` and `/hm/api/agents` and everything under them, open like the rest of the site. The web app offers it as the site's [app environment](../software/app-environment.md) (`SEED_AGENT_SERVER_URL`). With agents off, the web app offers the hosted one.
- **Notify.** Email notifications always go through the hosted [notify service](../software/notify.md) at `https://hyper.media/hm/api/notify`.
- **Private ports.** The daemon's own HTTP and gRPC ports (`56001` and `56002`) are not published on the host. Trusted services reach them over the container network. Keep them private, and pass only the public `/ipfs/*` routes through the proxy.
- **Server mode.** The Docker image turns on [server mode](../protocol/integrity.md) with `SEED_SERVER_MODE=true`, though the compose file passes no mode flag. In server mode the daemon trusts the network it is deployed on and does not serve private content to readers without a sign-in. It does not check who may write (see [daemon gRPC](../build/grpc.md)).
- **Private documents.** On a site that holds [private documents](../protocol/privacy.md) of the registered space, the web app passes on the visitor's sign-in token, so the daemon can allow private reads.

The daemon must be reachable from the internet: <!-- id:TzLz7e3d -->

- It runs with `-p2p.force-reachability-public` and `-p2p.no-relay`. It announces `/dns4/example.org/tcp/56000` and the same for QUIC. Peers connect to it directly, and so does the desktop app that publishes to the site. So the libp2p port must be open to the internet.
- Host port 143 leads to the same listener, and the daemon announces it as `/dns4/example.org/tcp/143`. Some university networks, such as eduroam, do not allow port 56000 but allow 143 (IMAP). A Seed app on such a network reaches the site through 143. Open 143 in the host firewall too.
- A host that already runs a mail server on port 143 cannot start the daemon container until one of the two moves.

**Agents and code execution.** Code execution in a sandbox needs `/dev/kvm`, which ordinary virtual servers do not have. This is true for a site and for an enterprise node. The compose file comes without it, and then agents are not offered `execute`. On a host with KVM, set `"agents_kvm": true` in `config.json`. The deploy then adds the device and the `kvm` group to the container, the way it adds `/dev/dri` to the daemon on a host with a GPU. See the [code execution backend](./code-execution-backend.md), and [operations](./operations.md) for running the app environment. <!-- id:4WR_fupu -->

Everything lives under one directory, `/opt/seed` by default. <!-- id:L3C83lx- -->

<!-- id:VDZpA09T -->
| Path <!-- col:mYFH-a-D --> | Contents <!-- col:efF_SgFi --> <!-- id:5uWbKA37 --> |
| --- | --- |
| `config.json` | the wizard's answers: `domain`, `testnet`, `release_channel`, `gateway`, `email`, plus the registration `link_secret` and bookkeeping <!-- id:zlho2phR --> |
| `docker-compose.yml` | the compose file, refreshed on every deploy <!-- id:P9kUqDMx --> |
| `proxy/CaddyFile`, `proxy/data`, `proxy/config` | the proxy configuration and its certificates <!-- id:KWcKSXuT --> |
| `web/config.json` | the site's web configuration: `availableRegistrationSecret` before registration, `registeredAccountUid` and `sourcePeerId` after <!-- id:YRkfZtBv --> |
| `web/image-cache/` | resized images <!-- id:niBgeHXG --> |
| `daemon/` | the daemon's data directory: the SQLite database, the [blob](../protocol/blobs.md) store, `keys/` with the node's libp2p identity, and a file keystore for the server signing key <!-- id:kzvlGdB0 --> |

The containers run as your user, never as root. Every bind mount has the `:z` flag, for hosts with SELinux. <!-- id:3h8EJ7kz -->

# Day-to-day <!-- id:M3CamdNc -->

The `seed-deploy` command manages the node. <!-- id:XqYfefmx -->

<!-- id:0HIsFkzj -->
| Command <!-- col:eGiYAwF2 --> | What it does <!-- col:vhLyrSd8 --> <!-- id:6zNrP5Ir --> |
| --- | --- |
| `seed-deploy` or `seed-deploy deploy` | headless update: refetch the compose file, pull images if anything changed, recreate containers, prune old images; a no-op when nothing changed <!-- id:GU195g26 --> |
| `seed-deploy deploy --reconfigure` | re-run the wizard with current values as defaults <!-- id:Lwf4cCYL --> |
| `seed-deploy doctor` | health: containers, disk, cron, certificate expiry, whether the site is registered <!-- id:zFrRi04q --> |
| `seed-deploy logs daemon`, `logs web`, `logs proxy` | tail a container's logs (also `agents` when it runs, and `vault`, `notify` on an enterprise node) <!-- id:ymL5e_DO --> |
| `seed-deploy secret`, `seed-deploy config` | the registration URL; the configuration with secrets redacted <!-- id:upwAVBuC --> |
| `seed-deploy stop`, `start`, `restart` | without redeploying <!-- id:2S70cDXD --> |
| `seed-deploy backup [path]` | a `.tar.gz` of the configuration and the `web`, `daemon` and `proxy` directories (and `agents` when it runs); containers stop during the backup and restart after <!-- id:_Luurojk --> |
| `seed-deploy restore <file>` | unpack a backup, optionally edit the configuration, deploy <!-- id:kTfGHtpF --> |
| `seed-deploy cron`, `cron remove` | install or remove the update jobs <!-- id:Vj549Ste --> |
| `seed-deploy upgrade` | update the deploy script itself <!-- id:h1DRBc9S --> |
| `seed-deploy uninstall` | remove containers, data and configuration <!-- id:Xj7rMjuS --> |

**Updates.** The wizard installs two cron jobs. One runs `upgrade` then `deploy` every ten minutes, so the node follows its release channel. The other removes unused images older than an hour, every hour. The deploy script itself always follows the `main` branch, whatever the image channel is, so fixes to the script reach every node. `SEED_DEPLOY_URL` and `SEED_REPO_URL` point the script at another source, for testing a branch. <!-- id:FQiu7j7S -->

**Which version is running.** `https://example.org/hm/api/version` returns the commit, branch and build date of both the web app and the daemon. <!-- id:ivRZzWHc -->

**Testing a branch.** `seed-deploy --advanced` adds two choices. You can choose the node directory, so a branch build with its own database migrations lives in `/opt/seed-mybranch` beside your main node. And you can choose an image tag. Only one node runs on a host at a time, because the container names are fixed. `deploy` and `start` refuse to replace containers that belong to another directory, and `doctor` warns when the two disagree. <!-- id:TfFlkN89 -->

**Metrics.** The compose file has a `metrics` profile with Prometheus and Grafana, served at `https://example.org/.metrics` when enabled. <!-- id:auv0SAGe -->

**Debug pages.** In server mode, trusted services on the daemon's private container network can open its `/debug/*` pages. Keep the API ports private, and do not pass these routes through the proxy. `docker exec seed-daemon` gives you a shell there. `seed-deploy logs daemon` is usually enough. <!-- id:fOadKE20 -->

# Related setups

- [Enterprise node](./enterprise-node.md): the deploy script's second profile, for one organization, invite-only and cut off from the public network.
- [Custom domains](./custom-domains.md): serving a site at your own domain, hosted or self-hosted, and moving a node to a new hostname.
- [Publishing a space to a domain](./publishing-to-a-domain.md): the owner's steps in the Seed app.
- [Self-hosting an app environment](./self-hosted-app-environment.md): running the app environment on its own, without the deploy script.

# See also <!-- id:l3G-hpNd -->

- [Running Seed](../operate.md), the hub for operators
- [Sites](../protocol/sites.md), what a site is in the protocol: the home document's `siteUrl`, registration, gateways <!-- id:vHRmyQVb -->
- [Network](../protocol/network.md), how the site's daemon syncs with the app that publishes to it <!-- id:pYi4ny5p -->
- [Seed API](../build/web-api.md), everything your new server answers <!-- id:DRTZJIFU -->
- [Web app](../software/web.md) and [daemon](../software/daemon.md), configuration and flags in detail, and the [daemon network reference](./daemon-network.md), for the daemon's network flags <!-- id:eSSvPKrX -->
- [Keys](../build/keys.md), the key that publishes to the site <!-- id:ia1UxKo- -->
- [Contributing](../contribute/contributing.md), for the `ops/` deploy tooling <!-- id:4hicMIvg -->

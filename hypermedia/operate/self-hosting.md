---
name: Self-hosting
summary: Run your own Seed site on a Linux server with the deploy script, register your space from the Seed app, and keep it updated, backed up and reachable on your domain.
---
A Seed [site](../protocol/sites.md) is a [Seed daemon](../software/daemon.md) and a [Seed web app](../software/web.md) behind a reverse proxy, serving one [space](../protocol/spaces.md) at a web domain. The hosted service runs sites for you under `*.hyper.media`. This guide runs the same three containers on a server you control: install, register a space, and look after the node day to day. An organization that wants a closed, invite-only node uses the [enterprise node](./enterprise-node.md) profile of the same script. Your content and your [key](../build/keys.md) stay yours either way, so a hosted site can move to your own server later and back again. <!-- id:m5g9GCjF -->

**Goal.** A site at `https://example.org` that publishes your space, gets TLS certificates by itself, checks for updates every ten minutes, and can be backed up in one command. <!-- id:BjaNX3tF -->

**Prerequisites.** <!-- id:DJRbdi8X -->
  - A Linux server with about 2 GB of RAM, a public IPv4 address, and ports 80 and 443 free. The deploy script needs `glibc` 2.25 or newer, which means Ubuntu 18.04, Debian 10, RHEL 8, Fedora 28 or Amazon Linux 2023 and later. It installs Docker and [Bun](https://bun.sh/) if they are missing. <!-- id:d7Tn8Tvy -->
  - A domain name you control, with access to its DNS records. <!-- id:zum2Xo9b -->
  - The [Seed desktop app](../software/desktop.md) with the space you want to publish, and its key. Whoever holds that key can publish to the site. <!-- id:MybpMXQm -->

# 1. Point the domain at the server <!-- id:3BEmtxgu -->

In your DNS provider, add an `A` record for the domain (the name is `@` for the root, or a subdomain such as `docs`) whose value is the server's IP address. Do this first. The proxy requests a certificate from Let's Encrypt on first start, and that only succeeds once the name resolves to the server. <!-- id:44XlNfaJ -->

# 2. Run the deploy script <!-- id:7oxvMDev -->

Log in as root or as a user with `sudo`, and run: <!-- id:eWW1L2-a -->

```sh <!-- id:Y-SDXUh5 -->
curl -fsSL https://deploy.seed.hyper.media | sh
```

That URL serves the bootstrap script, `ops/deploy.sh` on the `main` branch of the Seed repository. You can fetch it from GitHub directly if you want to read it first. The bootstrap installs Docker and Bun when needed, downloads the deployment engine to `/usr/local/lib/seed/deploy.js`, installs a `seed-deploy` command, and starts an interactive wizard. <!-- id:LkTUHoaL -->

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

The contact email is the only way a security notice reaches you: the script does not report deployments to the Seed team.

It then writes the configuration, generates a Caddyfile, pulls the images and starts the containers. On a first deploy it ends with: <!-- id:wNxm1pUP -->

``` <!-- id:0xlrFWjZ -->
Setup complete
  Your site is live at https://example.org

  Registration URL:
  https://example.org/hm/register?secret=…

Copy this URL and paste it into the Seed desktop app
to link your publisher account to this site.
```

Until a space is registered the site renders a "not registered" page. `seed-deploy secret` prints the registration URL again. <!-- id:Kbuubsnb -->

# 3. Register your space from the Seed app <!-- id:7NO6ywu_ -->

In the desktop app, open the space, choose **Publish Site** from the options menu at the top right, paste the registration URL and confirm. The app fetches the site's `/hm/api/config`, sends its [account](../protocol/identity.md) id and [peer](../protocol/network.md) addresses to `/hm/api/register` with the secret, and pushes the space's home document with its related material to the site's daemon. The site records the account, [subscribes](../protocol/network.md) its daemon to the space, and from then on renders that account's home document at `https://example.org`. <!-- id:ojfgDQRq -->

The secret is consumed on registration. A registered site refuses a different account. To move a site to another space, replace the web configuration file described below with `{"availableRegistrationSecret": "<secret>"}` (the secret from `seed-deploy secret` works), run `seed-deploy restart` so the web app rereads it, and register again. <!-- id:Kj_aBupp -->

# What is running <!-- id:Tc2sHwL6 -->

Three containers, defined by the compose file the script downloads from the repository. <!-- id:_4EyLyS4 -->

<!-- id:5tv0t3iJ -->
| Container <!-- col:nCbRVSuL --> | Image <!-- col:o5lhpOcI --> | Ports on the host <!-- col:zpYLky3C --> | Role <!-- col:PN9x-oKW --> <!-- id:ZWYWhuGR --> |
| --- | --- | --- | --- |
| `seed-proxy` | `caddy:2` | 80, 443, 443/udp | TLS from Let's Encrypt, then reverse proxy <!-- id:JRlA2dUp --> |
| `seed-web` | `seedhypermedia/web` | 3000 | the Seed web app: pages, the [Seed API](../build/web-api.md), site services <!-- id:F1mI7hqv --> |
| `seed-daemon` | `seedhypermedia/site` | 56000, 56000/udp and 143 | the Seed daemon: storage, indexing, libp2p <!-- id:hZP5lv-s --> |

Caddy sends `/ipfs/*` to the daemon and everything else to the web app. With agents on, a fourth container, `seed-agents` (`seedhypermedia/agents`, compose profile `agents`, data in `agents/`), answers `/hm/api/apps` and `/hm/api/agents` and everything under them, open like the rest of the site, and the web app offers it as its app environment (`SEED_AGENT_SERVER_URL`); with agents off the web app offers the hosted one. Email notifications always go through the hosted notify service at `https://hyper.media/hm/api/notify`. The daemon's own HTTP and gRPC ports (`56001` and `56002`) are not published on the host. Trusted services reach them over the container network. The Docker image enables server mode with `SEED_SERVER_MODE=true`, even though Compose passes no mode flag. Server mode trusts the deployment network and filters anonymous private reads; it does not authorize write callers (see [daemon gRPC](../build/grpc.md)). Keep those API ports private and proxy only the public `/ipfs/*` routes. On a site that holds [private documents](../protocol/privacy.md) of the registered space, the web app forwards the visitor's sign-in token so the daemon can authorize private reads. <!-- id:vOtNmSQ4 -->

The daemon runs with `-p2p.force-reachability-public` and `-p2p.no-relay`, announcing `/dns4/example.org/tcp/56000` and the QUIC equivalent, so the libp2p port must be reachable from the internet. Peers, including the desktop app that publishes to the site, connect to it directly. Host port 143 forwards to the same listener and is announced as `/dns4/example.org/tcp/143`. University networks such as eduroam block 56000 but leave 143 (IMAP) open, so a Seed app on campus reaches the site through it. Open 143 in the host firewall too. A host that already runs a mail server on 143 cannot start the daemon container until one of the two moves. <!-- id:TzLz7e3d -->

**Agents and code execution.** Sandboxed code execution in the app environment needs `/dev/kvm`, which standard virtual servers do not have. This holds for a site and an enterprise node alike. The compose file ships without it; set `"agents_kvm": true` in `config.json` on a host with KVM, and the deploy adds the device and the `kvm` group to the container, the way it adds `/dev/dri` to the daemon on hosts with a GPU. See the [code execution backend](./code-execution-backend.md), and [operations](./operations.md) for running the app environment. <!-- id:4WR_fupu -->

Everything lives under one directory, `/opt/seed` by default. <!-- id:L3C83lx- -->

<!-- id:VDZpA09T -->
| Path <!-- col:mYFH-a-D --> | Contents <!-- col:efF_SgFi --> <!-- id:5uWbKA37 --> |
| --- | --- |
| `config.json` | the wizard's answers: `domain`, `testnet`, `release_channel`, `gateway`, `email`, plus the registration `link_secret` and bookkeeping <!-- id:zlho2phR --> |
| `docker-compose.yml` | the compose file, refreshed on every deploy <!-- id:P9kUqDMx --> |
| `proxy/CaddyFile`, `proxy/data`, `proxy/config` | the proxy configuration and its certificates <!-- id:KWcKSXuT --> |
| `web/config.json` | the site's web configuration: `availableRegistrationSecret` before registration, `registeredAccountUid` and `sourcePeerId` after <!-- id:YRkfZtBv --> |
| `web/image-cache/` | resized images <!-- id:niBgeHXG --> |
| `daemon/` | the daemon's data directory: the SQLite database, the blob store, `keys/` with the node's libp2p identity, and a file keystore for the server signing key <!-- id:kzvlGdB0 --> |

Containers run as your user and never as root. All bind mounts carry the `:z` flag for SELinux hosts. <!-- id:3h8EJ7kz -->

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

**Updates.** The wizard installs two cron jobs. Every ten minutes it runs `upgrade` then `deploy`, so the node follows its release channel. Every hour it prunes unused images older than an hour. The deploy script itself always tracks the `main` branch, independent of the image channel, so fixes to the orchestration reach every node. `SEED_DEPLOY_URL` and `SEED_REPO_URL` redirect the source for testing a branch. <!-- id:FQiu7j7S -->

**Which version is running.** `https://example.org/hm/api/version` returns the commit, branch and build date of both the web app and the daemon. <!-- id:ivRZzWHc -->

**Testing a branch.** `seed-deploy --advanced` adds two things: choosing the node directory, so a branch build with its own database migrations lives in `/opt/seed-mybranch` beside your main node, and a custom image tag. Only one node runs at a time per host, because the container names are fixed. `deploy` and `start` refuse to replace a stack owned by another directory, and `doctor` warns when they disagree. <!-- id:TfFlkN89 -->

**Metrics.** The compose file has a `metrics` profile with Prometheus and Grafana, served at `https://example.org/.metrics` when enabled. <!-- id:auv0SAGe -->

**Debug pages.** In server mode, the daemon's `/debug/*` pages are available to trusted services on its private container network. Keep the API ports private and do not proxy these routes publicly. `docker exec seed-daemon` gets you a shell there. `seed-deploy logs daemon` is usually enough. <!-- id:fOadKE20 -->

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
- [Web app](../software/web.md) and [daemon](../software/daemon.md), configuration and flags in detail <!-- id:eSSvPKrX -->
- [Keys](../build/keys.md), the key that publishes to the site <!-- id:ia1UxKo- -->
- [Contributing](../contribute/contributing.md), for the `ops/` deploy tooling <!-- id:4hicMIvg -->

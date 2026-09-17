---
name: Self-hosting
summary: Run your own Seed site on a Linux server with the deploy script, register your space from the Seed app, and keep it updated, backed up and reachable on your domain.
---
A Seed [site](../protocol/sites.md) is a [Seed daemon](../apps/daemon.md) and a [Seed web app](../apps/web.md) behind a reverse proxy, serving one [space](../protocol/identity.md) at a web domain. The hosted service runs sites for you under `*.hyper.media`. This guide runs the same three containers on a server you control. Your content and your [key](./keys.md) stay yours either way, so a hosted site can move to your own server later and back again. <!-- id:m5g9GCjF -->

**Goal.** A site at `https://example.org` that publishes your space, gets TLS certificates by itself, checks for updates every ten minutes, and can be backed up in one command. <!-- id:BjaNX3tF -->

**Prerequisites.** <!-- id:DJRbdi8X -->
  - A Linux server with about 2 GB of RAM, a public IPv4 address, and ports 80 and 443 free. The deploy script needs `glibc` 2.25 or newer, which means Ubuntu 18.04, Debian 10, RHEL 8, Fedora 28 or Amazon Linux 2023 and later. It installs Docker and [Bun](https://bun.sh/) if they are missing. <!-- id:d7Tn8Tvy -->
  - A domain name you control, with access to its DNS records. <!-- id:zum2Xo9b -->
  - The [Seed desktop app](../apps/desktop.md) with the space you want to publish, and its key. Whoever holds that key can publish to the site. <!-- id:MybpMXQm -->

# 1. Point the domain at the server <!-- id:3BEmtxgu -->

In your DNS provider, add an `A` record for the domain (the name is `@` for the root, or a subdomain such as `docs`) whose value is the server's IP address. Do this first. The proxy requests a certificate from Let's Encrypt on first start, and that only succeeds once the name resolves to the server. <!-- id:44XlNfaJ -->

# 2. Run the deploy script <!-- id:7oxvMDev -->

Log in as root or as a user with `sudo`, and run: <!-- id:eWW1L2-a -->

```sh <!-- id:Y-SDXUh5 -->
curl -fsSL https://deploy.seed.hyper.media | sh
```

At the time of writing that URL redirects to the bootstrap script in the Seed repository, `ops/deploy.sh` on the `main` branch. You can fetch it from GitHub directly if you want to read it first. The bootstrap installs Docker and Bun when needed, downloads the deployment engine to `/usr/local/lib/seed/deploy.js`, installs a `seed-deploy` command, and starts an interactive wizard. <!-- id:LkTUHoaL -->

The wizard asks: <!-- id:V8Vv6kDw -->

<!-- id:jnEd7ls6 -->
| Question <!-- col:xxu6Oy70 --> | What to answer <!-- col:9dB-CWsG --> <!-- id:DGKoRMiN --> |
| --- | --- |
| Public hostname | the full URL, `https://example.org` <!-- id:_2wOpp0M --> |
| P2P network | Mainnet, unless you are testing against the team's dev network <!-- id:bloR0LZW --> |
| Release channel | Stable (`latest`) for the released images; Bleeding edge (`dev`) tracks `main` <!-- id:K40FtFaY --> |
| Log level | Info <!-- id:sq8TazXi --> |
| Gateway mode | No, for a site that publishes one space; Yes makes the node serve every public account it learns about, like `hyper.media` <!-- id:ULr-bkUF --> |
| Contact email | optional, for security notices <!-- id:6Xta8RjE --> |

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
| `seed-web` | `seedhypermedia/web` | 3000 | the Seed web app: pages, the [Seed API](./web-api.md), site services <!-- id:F1mI7hqv --> |
| `seed-daemon` | `seedhypermedia/site` | 56000 and 56000/udp | the Seed daemon: storage, indexing, libp2p <!-- id:hZP5lv-s --> |

Caddy sends `/ipfs/*` to the daemon and everything else to the web app. The daemon's own HTTP and gRPC ports (`56001` and `56002`) are not published on the host. Only the web app reaches them over the container network. The daemon's API has no authentication of its own (see [daemon gRPC](./grpc.md)), so keep it that way and do not open those ports in a firewall. The compose file does not pass `-public-only` to the daemon. On a site that holds [private documents](../protocol/privacy.md) of the registered space, the web app decides what a visitor may see by forwarding their sign-in token to the daemon. <!-- id:vOtNmSQ4 -->

The daemon runs with `-p2p.force-reachability-public` and `-p2p.no-relay`, announcing `/dns4/example.org/tcp/56000` and the QUIC equivalent, so the libp2p port must be reachable from the internet. Peers, including the desktop app that publishes to the site, connect to it directly. <!-- id:TzLz7e3d -->

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
| `seed-deploy logs daemon`, `logs web`, `logs proxy` | tail a container's logs <!-- id:ymL5e_DO --> |
| `seed-deploy secret`, `seed-deploy config` | the registration URL; the configuration with secrets redacted <!-- id:upwAVBuC --> |
| `seed-deploy stop`, `start`, `restart` | without redeploying <!-- id:2S70cDXD --> |
| `seed-deploy backup [path]` | a `.tar.gz` of the configuration and the `web`, `daemon` and `proxy` directories; containers stop during the backup and restart after <!-- id:_Luurojk --> |
| `seed-deploy restore <file>` | unpack a backup, optionally edit the configuration, deploy <!-- id:kTfGHtpF --> |
| `seed-deploy cron`, `cron remove` | install or remove the update jobs <!-- id:Vj549Ste --> |
| `seed-deploy upgrade` | update the deploy script itself <!-- id:h1DRBc9S --> |
| `seed-deploy uninstall` | remove containers, data and configuration <!-- id:Xj7rMjuS --> |

**Updates.** The wizard installs two cron jobs. Every ten minutes it runs `upgrade` then `deploy`, so the node follows its release channel. Every hour it prunes unused images older than an hour. The deploy script itself always tracks the `main` branch, independent of the image channel, so fixes to the orchestration reach every node. `SEED_DEPLOY_URL` and `SEED_REPO_URL` redirect the source for testing a branch. <!-- id:FQiu7j7S -->

**Which version is running.** `https://example.org/hm/api/version` returns the commit, branch and build date of both the web app and the daemon. <!-- id:ivRZzWHc -->

**Testing a branch.** `seed-deploy --advanced` adds two things: choosing the node directory, so a branch build with its own database migrations lives in `/opt/seed-mybranch` beside your main node, and a custom image tag. Only one node runs at a time per host, because the container names are fixed. `deploy` and `start` refuse to replace a stack owned by another directory, and `doctor` warns when they disagree. <!-- id:TfFlkN89 -->

**Metrics.** The compose file has a `metrics` profile with Prometheus and Grafana, served at `https://example.org/.metrics` when enabled. <!-- id:auv0SAGe -->

**Debug pages.** The daemon's `/debug/*` pages answer only to loopback inside its container. `docker exec seed-daemon` gets you a shell there. `seed-deploy logs daemon` is usually enough. <!-- id:fOadKE20 -->

# Custom domains for hosted sites <!-- id:ZBecOkd6 -->

If your site is on the hosted service at `yoursite.hyper.media`, you can still serve it at your own [domain](../protocol/sites.md) without self-hosting. In the Seed app, open the site, choose **Publish Custom Domain** from the options menu, enter the domain and confirm. Then in DNS either add an `ALIAS` or flattened `CNAME` record pointing at `yoursite.hyper.media` (turn off proxying if you use Cloudflare), or, when your provider cannot do that, an `A` record pointing at the hosted service's address. At the time of writing `hyper.media` resolves to `40.160.6.196`; check with `dig +short A hyper.media` before you copy it. Keep the app open while DNS propagates, usually within ten minutes, and the site goes live on the new domain. <!-- id:VQS9iJXY -->

# The legacy script <!-- id:7nY6Bjnv -->

`website_deployment.sh` at the repository root is the previous installer. It is deprecated, with a notice in its header. The deploy script detects installations it made, migrates their configuration, and removes the Watchtower auto-updater they used. Do not use it for new sites. <!-- id:sJgPjee4 -->

# Where this is going <!-- id:0mQ2tb5Q -->

As of September 2026, the deploy script does not yet report new deployments to the Seed team (a `TODO` in the source), so security notices depend on the email you entered. A guide for self-hosting behind a different domain setup than a single `A` record, and for running a node without publishing a site, is not written. The hosted service's own infrastructure (multi-tenant sites, custom domains at scale) lives in a separate repository and is not documented here. <!-- id:kTbKBOKg -->

# See also <!-- id:l3G-hpNd -->

- [Sites](../protocol/sites.md), what a site is in the protocol: the home document's `siteUrl`, registration, gateways <!-- id:vHRmyQVb -->
- [Network](../protocol/network.md), how the site's daemon syncs with the app that publishes to it <!-- id:pYi4ny5p -->
- [Seed API](./web-api.md), everything your new server answers <!-- id:DRTZJIFU -->
- [Web app](../apps/web.md) and [daemon](../apps/daemon.md), configuration and flags in detail <!-- id:eSSvPKrX -->
- [Keys](./keys.md), the key that publishes to the site
- [Contributing](./contributing.md), for the `ops/` deploy tooling

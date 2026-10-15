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
| Agents | No, unless you want to run [Seed Agents](../agent.md) on the site itself, at `https://example.org/hm/api/agents` |
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

Caddy sends `/ipfs/*` to the daemon and everything else to the web app. With agents on, a fourth container, `seed-agents` (`seedhypermedia/agents`, compose profile `agents`, data in `agents/`), answers `/hm/api/agents` and everything under it, open like the rest of the site, and the web app offers it as its agent server (`SEED_AGENT_SERVER_URL`); with agents off the web app offers the hosted one. Email notifications always go through the hosted notify service at `https://hyper.media/hm/api/notify`. The daemon's own HTTP and gRPC ports (`56001` and `56002`) are not published on the host. Only the web app reaches them over the container network. The daemon's API has no authentication of its own (see [daemon gRPC](./grpc.md)), so keep it that way and do not open those ports in a firewall. The compose file does not pass `-public-only` to the daemon. On a site that holds [private documents](../protocol/privacy.md) of the registered space, the web app decides what a visitor may see by forwarding their sign-in token to the daemon. <!-- id:vOtNmSQ4 -->

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

**Debug pages.** The daemon's `/debug/*` pages answer only to loopback inside its container. `docker exec seed-daemon` gets you a shell there. `seed-deploy logs daemon` is usually enough. <!-- id:fOadKE20 -->

# Enterprise profile

The deploy script has a second profile for an organization that wants Seed for itself: one server, one [space](../protocol/identity.md), accounts only for the people it invites, and no peer-to-peer connection to the public network (public content from other spaces is read over HTTPS, see below). Start it with `--profile enterprise` instead of the default site profile:

```sh
curl -fsSL https://deploy.seed.hyper.media | sh -s -- --profile enterprise
```

Without a terminal, for example over `ssh host 'curl … | sh -s -- …'`, pass the answers as flags and `--yes` instead of the wizard: `seed-deploy deploy --profile enterprise --hostname https://example.org --tag latest --email you@example.org [--agents] [--notify] --yes`, with the SMTP account in `SEED_SMTP_HOST`, `SEED_SMTP_USER`, `SEED_SMTP_PASSWORD` and `SEED_SMTP_SENDER` when `--notify` is on and there is no email relay (below). `--tag` takes any image tag, including the sanitized branch name a branch build of the Docker images produces.

Everything above about DNS, the install directory, `seed-deploy` and backups still applies. What differs is what runs, how people get in, and what the box may talk to.

**What it runs.** The compose file is `ops/docker-compose.enterprise.yml`. All services share one internal network; only the proxy publishes ports.

| Container | Image | Ports on the host | Role |
| --- | --- | --- | --- |
| `seed-proxy` | `caddy:2` | 80, 443, 443/udp | TLS, then reverse proxy with the sign-in gate |
| `seed-web` | `seedhypermedia/web` | none | the web app with `SEED_REQUIRE_SIGN_IN=1`, signing and identity enabled, a session secret, and the vault's internal address for the membership check at sign-in |
| `seed-daemon` | `seedhypermedia/site` | none | the daemon with `-p2p.isolated` (no bootstrap, a deny-all connection gater, no peer exchange), `-lndhub.disabled`, no discovery, no pull, no relay, listening on loopback only, on a private network named `ent-<your-domain>` |
| `seed-vault` | `seedhypermedia/vault` | none | the [identity vault](../apps/vault.md), invite-only, served at `/vault` on the site's own origin |
| `seed-notify` | `seedhypermedia/notify` | none | optional, compose profile `notify`, served by the site itself under `/hm/api/notify`, open (signed requests and email tokens are its credentials) |
| `seed-agents` | `seedhypermedia/agents` | none | optional, compose profile `agents`, served by the site itself under `/hm/api/agents`, for members only |

The `metrics` profile with Prometheus and Grafana is the same as in the site profile. Every image uses the release channel's tag, and `web_image` and `site_image` in `config.json` override the web and daemon images as before.

**The wizard asks** for the public hostname, the name of the organization's space (the bare hostname by default; `--site-name` without a terminal), on a first run an optional password for the space's exported owner key (`--owner-password` or `SEED_OWNER_PASSWORD` without a terminal), the release channel (`latest`, or `dev` for `main` builds), the log level, whether to run agents (default no), whether to run notify (default no) and if so, unless an email relay is configured, the SMTP host, user, password and sender address, and a contact email. The vault and the notify service both send with STARTTLS on port 587 (`smtp.port` in `config.json` overrides it). There is no network, gateway or analytics question: the profile forces mainnet off, gateway off and statistics off. The wizard generates four secrets and stores them in `config.json`: `link_secret`, the registration secret used by `/hm/register`; `vault_admin_secret`, a 40-character bearer token for the vault's admin API; `session_secret`, the key the web app signs its session cookie with; and `service_secret`, which the agents service presents (header `X-Seed-Service-Secret`) in place of a session cookie, because it reads the site server-side, for example to notice mentions that fire its triggers. `seed-deploy config` prints them redacted, along with the email relay token.

**Email without an SMTP account.** The Seed hosting service hands an enterprise instance an email relay: an HTTPS address and a bearer token. With them configured, the [vault](../apps/vault.md) sends its verification codes and the [notify](../apps/notify.md) service its notification emails as `POST <relay url>` with `Authorization: Bearer <token>` and a JSON body `{to, subject, text, html?, replyTo?}`; the relay answers `202` when it accepts the message and sets the From address itself, and anything else (`401`, `429`, another 4xx) fails the send the way an SMTP rejection does. The relay wins over SMTP, so with it the notify question needs no SMTP account. `seed-deploy --advanced` asks for the two values (the ordinary wizard does not, so a relay stays as it is across reconfigurations); without a terminal pass `--email-relay-url` and `--email-relay-token`, or `SEED_EMAIL_RELAY_URL` and `SEED_EMAIL_RELAY_TOKEN` in the environment. They are stored as `email_relay_url` and `email_relay_token` in `config.json` and reach the containers as `SEED_VAULT_EMAIL_RELAY_URL`/`_TOKEN` on `seed-vault` and `NOTIFY_EMAIL_RELAY_URL`/`_TOKEN` on `seed-notify`.

**Getting in.** For every request to the site that is not on an open path, Caddy first asks the web app (`forward_auth` to `/hm/api/session`, with the original path in `X-Forwarded-Uri`) whether the request carries a member session: `204` lets it through, otherwise the web app's answer, a `302` to `/hm/sign-in?next=…` for a browser or a `401` for an API call, goes back to the client. The daemon's `/ipfs/*` reads, the `/.metrics` pages and the agents service (`/hm/api/agents` and everything under it, its API and WebSocket) sit behind the same gate; only `POST /hm/api/agents/webhooks/*`, which outside services call with the trigger's secret in the path, is open. The notify service is open and goes straight to `seed-notify`: `/hm/api/notify` and everything under it, plus the API paths older Seed apps call on the advertised notify origin (`/hm/api/notifications`, `/hm/api/notification-config`, `/hm/api/notification-inbox`, `/hm/api/notification-read-state`, `/hm/api/public-subscribe`, `/hm/api/email-notif-token`, `/hm/api/unsubscribe`); its requests are signed by the account or carry the email token, and the people who follow an email link need not be members. The open paths are the sign-in flow (`/hm/sign-in`, `/hm/auth/callback`, `/hm/api/auth`, `/hm/api/session`), the email notification settings page (`/hm/email-notifications`, reached from a link in an email), the endpoints the Seed app and the deploy script use (`/hm/api/config`, `/hm/api/version`, `/hm/api/register`, `/hm/register`, `/hm/create-site`, and `POST /hm/api/enterprise-bootstrap` and `POST /hm/api/enterprise-site-url`, which demand the vault admin secret), the vault under `/vault`, the calls the sign-in callback makes before a cookie exists (`POST /api/PublishBlobs`, `GET /api/Account`, `POST /ipfs/*` for the vault's profile uploads) and static assets. The list is generated from the web app's `isOpenPath` rules in `frontend/apps/web/app/require-sign-in.ts`, so the two never disagree. Three commands cover the rest:

| Command | What it does |
| --- | --- |
| `seed-deploy invite <email> [--role reader\|writer] [--no-email]` | asks the vault's admin API (`POST /vault/api/admin/invitations` with the `vault_admin_secret`) for a single-use invitation link of the form `https://example.org/hm/sign-in?invite=<code>&email=<email>` (the site's sign-in page, which creates the account in the vault and signs the person in to the site in one flow, so they land on the site as a member); the vault emails it to the person through the hosting relay (`--no-email` to only print it) and the command prints the link too. Each invitation is bound to that one address (the vault shows it read-only and accepts no other), and the vault is invite-only, so this is how each person gets an account. `--role writer` makes the vault grant them a WRITER capability on the space, signed with the owner key, as soon as their account exists; the default `reader` gives read access only |
| `seed-deploy bootstrap-space [--site-name …] [--owner-password …]` | creates the organization's space and registers the site to it, what the first deploy does on its own; for when that attempt failed. Idempotent: on a registered site it prints the existing account and changes nothing |
| `seed-deploy register <accountUid>` | registers a space that already lives on this daemon: reads the daemon's peer id from `/hm/api/config` and posts it with the account id and `link_secret` to `/hm/api/register`, the same call the Seed app makes. For a space created in the browser, `/hm/register?secret=…` from `seed-deploy secret` works as on a site |
| `seed-deploy set-hostname https://new.example.org` | moves the node to a new hostname: rewrites `domain` in `config.json`, redeploys (Caddyfile, certificate, every container's env) and then republishes the space's home document with the new address; see below |
| `seed-deploy doctor` | in addition to the usual checks: that `docker port seed-daemon` is empty, that `/hm/api/config` reports `requireSignIn: true`, that the `siteUrl` of the space's home document matches the hostname, that `GET /` without a session is bounced to `/hm/sign-in`, and that `/vault/` answers; the lightning and testnet checks are skipped |

**The organization's space.** Once the first deploy's health checks pass, the script creates the space itself, so the first person to sign in finds a site rather than an empty node. It calls `POST /hm/api/enterprise-bootstrap` on the public hostname with the `vault_admin_secret` (retrying for about half a minute while the web app comes up). The web app mints a key in the daemon's keystore from a mnemonic it holds only for that request, publishes the space's home document signed by it (the name from the wizard or `--site-name`, the site's address, a welcome paragraph), and registers the site to the new account the way `/hm/api/register` does. The response carries the space's account and the standard [`.hmkey.json`](./keys.md) export of its key, encrypted with the owner password when one was given, which the script saves as `owner-key/<accountUid>.hmkey.json` in the install directory, readable by the installing user only, and records as `owner_account_uid` in `config.json`. The deploy output ends with the account, the path of that file and how to take the root of the space: import the file in the vault at `https://<your-domain>/vault/settings` (Import identity in the sidebar; it asks for the password if the file has one), with the desktop app's key import, or with `seed-cli key import <file>`. The mnemonic is never written anywhere; the key file is the only copy outside the daemon, so after importing it keep it somewhere safe or delete it. `seed-deploy secret` prints the path again. If the attempt fails, the deploy still succeeds and says so; run `seed-deploy bootstrap-space` once the site answers.

**Changing the hostname.** Set the hostname before inviting anyone: WebAuthn passkeys are bound to the domain they were registered on, so a passkey created at the first address does not work at the next one (password sign-in keeps working; the person signs in with the password and adds a new passkey in the vault). For a customer domain, the customer creates an `A` record for the name (`seed` for `seed.customer.org`, or `@` for the root) whose value is the server's IP address, with any proxying turned off, because the proxy needs the name to resolve to the server to get a certificate from Let's Encrypt. Once it resolves, `seed-deploy set-hostname https://seed.customer.org` does the rest: `config.json`, the Caddyfile and the containers' env (`SEED_BASE_URL`, the vault's relying party, the agents' site address) follow the hostname, and after the containers are healthy the script calls `POST /hm/api/enterprise-site-url` with the `vault_admin_secret`, which has the web app republish the space's home document with `siteUrl` set to the new address, a metadata-only change signed by the daemon-held owner key, in the document's current generation. The same happens when a reconfiguration (`deploy --reconfigure`, or `deploy --profile enterprise --hostname … --yes`) changes the hostname. If that last step fails, the node is up and `set-hostname` with the same hostname retries only the republish; `doctor` warns while the home document and the hostname disagree. The previous hostname is kept in `redirect_hostnames` in `config.json`: Caddy still gets a certificate for it and redirects it to the new address, so a managed address such as `<name>.hyper.media` keeps working after the organization's own domain takes over.

**What is isolated and how.** The daemon's libp2p listener binds to loopback inside its container and has no published port, so no peer can reach it; `-p2p.isolated` refuses every connection and dials nobody, `-p2p.bootstrap-peers=none`, `-syncing.no-discovery` and `-syncing.no-pull` mean it looks for nothing, and the private testnet name keeps it off the public network even if a peer address leaked in. The image already sets `SEED_PUBLIC_ONLY=true`; `-lndhub.disabled` stops the wallet integration and `SENTRY_DSN` is empty, so no telemetry. The web app talks only to the daemon, the vault, and, when enabled, the notify and agents services on the box, at `https://<your-domain>/hm/api/notify` and `https://<your-domain>/hm/api/agents`, so the node needs one hostname and one certificate; `NOTIFY_SERVICE_HOST`, `SEED_AGENT_SERVER_URL` and `SEED_HOST_URL` are empty otherwise (empty, not unset: the vault and the web app treat an unset notify address as the hosted service). The vault uses the site's domain as its WebAuthn relying party and reaches the daemon over the internal network. What leaves the server is email, through your SMTP account or the hosting email relay, and the agents' calls to their model provider, when agents are on. Caddy caps request bodies at 512 MB; rate limiting needs a Caddy plugin that the stock `caddy:2` image lacks, so it is not configured.

**Public content from other spaces.** Because the daemon never talks to another node, a document from another space (an embed of a public document, the Agent Guide the agents service puts in its system prompt, a directory the agents read) is not on the box. The web app therefore answers those reads from a mainnet node's public HTTP API: when the daemon reports `Resource`, `ResourceMetadata` or `Account` not found, or a `Query` over one space comes back empty, *and the daemon has never seen that account*, the web app asks the same `GET /api/<Key>` of `upstream_api_url` (default `https://hyper.media`; set it to `""` in `config.json` to keep every read on the box) and passes the answer through. Images and files of such documents come the same way, from the node's `/ipfs/<cid>`. Nothing is stored locally, answers are cached for a minute, and a read inside the organization's own space, or of any account the daemon knows, is never sent out. What does leave the box is the id of the external document or image being read. The agents service reads through the site, so it gets the same content, and `hm://hyper.media/...` links resolve to the Seed knowledge base space (`SEED_AGENTS_DOCS_ACCOUNT`).

**Updates.** On the two preset image channels an enterprise node installs the same ten-minute `upgrade` + `deploy` cron as a site: on `latest` a release reaches it like everyone else, and on `dev` it follows `main` (Seed's own test nodes run this way). On any other channel (a branch's images under test) no cron is installed: `seed-deploy deploy` by hand fetches the compose file and new images, and `seed-deploy cron` installs the auto-update if you want it after all. `seed-deploy backup` includes the `vault`, `notify` and `agents` directories along with `web`, `daemon` and `proxy`; `owner-key/` is left out on purpose, the exported key is for importing, not for keeping on the box. A directory that holds [private](../protocol/privacy.md) content of the organization's space should be treated accordingly, together with `config.json`, which holds the secrets.

**Agents and code execution.** Sandboxed code execution in the agents service needs `/dev/kvm`, which standard virtual servers do not have. This holds for a site and an enterprise node alike. The compose file ships without it; set `"agents_kvm": true` in `config.json` on a host with KVM, and the deploy adds the device and the `kvm` group to the container, the way it adds `/dev/dri` to the daemon on hosts with a GPU.

**Not yet done.** As of October 2026 the profile is phase one of the Enterprise Edition design, isolation: privacy comes from the box being unreachable, and documents inside it are ordinary public documents. Not built yet, from that design: a members directory and the READER role, SSO in front of the vault, an audit log of sign-ins and capability grants, a second gate on `/ipfs/*` so a leaked CID link does not fetch the file, backups encrypted with an operator key before they leave the box, a `-p2p.disabled` daemon flag that replaces the five isolation flags with one, and `deploy --tag` for pinning a specific release. The host firewall and the egress allowlist for the mail relay and model provider are the operator's; the script does not configure them. Phase two, re-enabling private document creation and fixing the visibility gaps so the box can share a subset of spaces with another node, touches the daemon's indexer and is not started. The invite-only vault with its admin API, the daemon's `-p2p.bootstrap-peers=none` and the web app's `SEED_REQUIRE_SIGN_IN` are new in this release; `doctor` fails its isolation checks when the running images predate them.

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
- [Keys](./keys.md), the key that publishes to the site <!-- id:ia1UxKo- -->
- [Contributing](./contributing.md), for the `ops/` deploy tooling <!-- id:4hicMIvg -->

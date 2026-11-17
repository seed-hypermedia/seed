---
name: Enterprise node
summary: How to run the deploy script's enterprise profile, a single-organization Seed node that is invite-only and isolated from the public network, including sign-in, invitations, the organization's space and what is isolated.
---
The deploy script has a second profile for an organization that wants Seed for itself: one server, one [space](../protocol/spaces.md), accounts only for the people it invites, and no peer-to-peer connection to the public network (public content from other spaces is read over HTTPS, see below). This page covers what the profile runs, how people get in, how the organization's space is created, and what the node may talk to. Read [self-hosting](./self-hosting.md) first: everything there about DNS, the install directory, `seed-deploy` and backups still applies. <!-- id:SmsqKy8U -->

# Installing <!-- id:Gu7dKSSd -->

Start the script with `--profile enterprise` instead of the default site profile:

```sh <!-- id:MMYMCpKk -->
curl -fsSL https://deploy.seed.hyper.media | sh -s -- --profile enterprise
```

Without a terminal, for example over `ssh host 'curl … | sh -s -- …'`, pass the answers as flags and `--yes` instead of the wizard: `seed-deploy deploy --profile enterprise --hostname https://example.org --tag latest --email you@example.org [--agents] [--notify] --yes`, with the SMTP account in `SEED_SMTP_HOST`, `SEED_SMTP_USER`, `SEED_SMTP_PASSWORD` and `SEED_SMTP_SENDER` when `--notify` is on and there is no email relay (below). `--tag` takes any image tag, including the sanitized branch name a branch build of the Docker images produces. <!-- id:4j3G4NRg -->

# What it runs

The compose file is `ops/docker-compose.enterprise.yml`. All services share one internal network; only the proxy publishes ports. <!-- id:nVgqaBxr -->

<!-- id:LecTiL0u -->
| Container <!-- col:rhKWqWfk --> | Image <!-- col:zuvbCYOv --> | Ports on the host <!-- col:tgEmfnEB --> | Role <!-- col:yOlHfk0n --> <!-- id:Yqr-rNc0 --> |
| --- | --- | --- | --- |
| `seed-proxy` | `caddy:2` | 80, 443, 443/udp | TLS, then reverse proxy with the sign-in gate <!-- id:iIX_7yUo --> |
| `seed-web` | `seedhypermedia/web` | none | the web app with `SEED_REQUIRE_SIGN_IN=1`, signing and identity enabled, a session secret, and the vault's internal address for the membership check at sign-in <!-- id:vcVzeB0S --> |
| `seed-daemon` | `seedhypermedia/site` | none | the daemon with `-p2p.isolated` (no bootstrap, a deny-all connection gater, no peer exchange), `-lndhub.disabled`, no discovery, no pull, no relay, libp2p listening on loopback only, on a private network named `ent-<your-domain>` <!-- id:q8ChJINS --> |
| `seed-vault` | `seedhypermedia/vault` | none | the [identity vault](../software/vault.md), invite-only, served at `/vault` on the site's own origin <!-- id:edY-0Yxh --> |
| `seed-notify` | `seedhypermedia/notify` | none | optional, compose profile `notify`, served by the site itself under `/hm/api/notify`, open (signed requests and email tokens are its credentials) <!-- id:-epLLDvA --> |
| `seed-agents` | `seedhypermedia/agents` | none | optional, compose profile `agents`, served by the site itself under `/hm/api/apps` and `/hm/api/agents`, for members only <!-- id:ih7fSiBc --> |

The `metrics` profile with Prometheus and Grafana is the same as in the site profile. Every image uses the release channel's tag, and `web_image` and `site_image` in `config.json` override the web and daemon images as before. <!-- id:LVEbsBHl -->

# The wizard

The wizard asks for the public hostname, the name of the organization's space (the bare hostname by default; `--site-name` without a terminal), on a first run an optional password for the space's exported owner key (`--owner-password` or `SEED_OWNER_PASSWORD` without a terminal), the release channel (`latest`, or `dev` for `main` builds), the log level, whether to run agents (default no), whether to run notify (default no) and if so, unless an email relay is configured, the SMTP host, user, password and sender address, and a contact email. The vault and the notify service both send with STARTTLS on port 587 (`smtp.port` in `config.json` overrides it). There is no network, gateway or analytics question: the profile forces mainnet off, gateway off and statistics off. The wizard generates four secrets and stores them in `config.json`: `link_secret`, the registration secret used by `/hm/register`; `vault_admin_secret`, a 40-character bearer token for the vault's admin API; `session_secret`, the key the web app signs its session cookie with; and `service_secret`, which the app environment presents (header `X-Seed-Service-Secret`) in place of a session cookie, because it reads the site server-side, for example to notice mentions that fire its triggers. `seed-deploy config` prints them redacted, along with the email relay token. <!-- id:T1lArSoQ -->

# Email without an SMTP account

The Seed hosting service hands an enterprise instance an email relay: an HTTPS address and a bearer token. With them configured, the [vault](../software/vault.md) sends its verification codes and the [notify](../software/notify.md) service its notification emails as `POST <relay url>` with `Authorization: Bearer <token>` and a JSON body `{to, subject, text, html?, replyTo?}`; the relay answers `202` when it accepts the message and sets the From address itself, and anything else (`401`, `429`, another 4xx) fails the send the way an SMTP rejection does. The relay wins over SMTP, so with it the notify question needs no SMTP account. `seed-deploy --advanced` asks for the two values (the ordinary wizard does not, so a relay stays as it is across reconfigurations); without a terminal pass `--email-relay-url` and `--email-relay-token`, or `SEED_EMAIL_RELAY_URL` and `SEED_EMAIL_RELAY_TOKEN` in the environment. They are stored as `email_relay_url` and `email_relay_token` in `config.json` and reach the containers as `SEED_VAULT_EMAIL_RELAY_URL`/`_TOKEN` on `seed-vault` and `NOTIFY_EMAIL_RELAY_URL`/`_TOKEN` on `seed-notify`. <!-- id:UcJWnrmu -->

# Getting in

For every request to the site that is not on an open path, Caddy first asks the web app (`forward_auth` to `/hm/api/session`, with the original path in `X-Forwarded-Uri`) whether the request carries a member session: `204` lets it through, otherwise the web app's answer, a `302` to `/hm/sign-in?next=…` for a browser or a `401` for an API call, goes back to the client. The daemon's `/ipfs/*` reads, the `/.metrics` pages and the app environment (`/hm/api/apps` and `/hm/api/agents` and everything under them, API and WebSocket) sit behind the same gate; only `POST …/webhooks/*` under those two prefixes, which outside services call with the trigger's secret in the path, is open. The notify service is open and goes straight to `seed-notify`: `/hm/api/notify` and everything under it, plus the API paths older Seed apps call on the advertised notify origin (`/hm/api/notifications`, `/hm/api/notification-config`, `/hm/api/notification-inbox`, `/hm/api/notification-read-state`, `/hm/api/public-subscribe`, `/hm/api/email-notif-token`, `/hm/api/unsubscribe`); its requests are signed by the account or carry the email token, and the people who follow an email link need not be members. The open paths are the sign-in flow (`/hm/sign-in`, `/hm/auth/callback`, `/hm/api/auth`, `/hm/api/session`), the email notification settings page (`/hm/email-notifications`, reached from a link in an email), the endpoints the Seed app and the deploy script use (`/hm/api/config`, `/hm/api/version`, `/hm/api/register`, `/hm/register`, `/hm/create-site`, and `POST /hm/api/enterprise-bootstrap` and `POST /hm/api/enterprise-site-url`, which demand the vault admin secret), the vault under `/vault`, the calls the sign-in callback makes before a cookie exists (`POST /api/PublishBlobs`, `GET /api/Account`, `POST /ipfs/*` for the vault's profile uploads) and static assets. The list is generated from the web app's `isOpenPath` rules in `frontend/apps/web/app/require-sign-in.ts`, so the two never disagree. <!-- id:dfzFMVc0 -->

# Commands

These commands come on top of the ones in [self-hosting](./self-hosting.md#day-to-day). [Running an invite-only vault](./invite-only-vault.md) covers the vault's side of invitations.

<!-- id:1V-6GEFb -->
| Command <!-- col:fBwCAh7c --> | What it does <!-- col:02tbloGC --> <!-- id:LbTJ86ZQ --> |
| --- | --- |
| `seed-deploy invite <email> [--role reader\|writer] [--no-email]` | asks the vault's admin API (`POST /vault/api/admin/invitations` with the `vault_admin_secret`) for a single-use invitation link of the form `https://example.org/hm/sign-in?invite=<code>&email=<email>` (the site's sign-in page, which creates the account in the vault and signs the person in to the site in one flow, so they land on the site as a member); the vault emails it to the person through the hosting relay (`--no-email` to only print it) and the command prints the link too. Each invitation is bound to that one address (the vault shows it read-only and accepts no other), and the vault is invite-only, so this is how each person gets an account. `--role writer` makes the vault grant them a WRITER capability on the space, signed with the owner key, as soon as their account exists; the default `reader` gives read access only <!-- id:h22Ii8NQ --> |
| `seed-deploy bootstrap-space [--site-name …] [--owner-password …]` | creates the organization's space and registers the site to it, what the first deploy does on its own; for when that attempt failed. Idempotent: on a registered site it prints the existing account and changes nothing <!-- id:m-gL1TMf --> |
| `seed-deploy register <accountUid>` | registers a space that already lives on this daemon: reads the daemon's peer id from `/hm/api/config` and posts it with the account id and `link_secret` to `/hm/api/register`, the same call the Seed app makes. For a space created in the browser, `/hm/register?secret=…` from `seed-deploy secret` works as on a site <!-- id:_ncOyesd --> |
| `seed-deploy set-hostname https://new.example.org` | moves the node to a new hostname: rewrites `domain` in `config.json`, redeploys (Caddyfile, certificate, every container's env) and then republishes the space's home document with the new address; see below <!-- id:0CXh3dmU --> |
| `seed-deploy doctor` | in addition to the usual checks: that `docker port seed-daemon` is empty, that `/hm/api/config` reports `requireSignIn: true`, that the `siteUrl` of the space's home document matches the hostname, that `GET /` without a session is bounced to `/hm/sign-in`, and that `/vault/` answers; the lightning and testnet checks are skipped <!-- id:XVCsL0xH --> |

# The organization's space

Once the first deploy's health checks pass, the script creates the space itself, so the first person to sign in finds a site rather than an empty node. It calls `POST /hm/api/enterprise-bootstrap` on the public hostname with the `vault_admin_secret` (retrying for about half a minute while the web app comes up). The web app mints a key in the daemon's keystore from a mnemonic it holds only for that request, publishes the space's home document signed by it (the name from the wizard or `--site-name`, the site's address, a welcome paragraph), and registers the site to the new account the way `/hm/api/register` does. The response carries the space's account and the standard [`.hmkey.json`](../build/keys.md) export of its key, encrypted with the owner password when one was given, which the script saves as `owner-key/<accountUid>.hmkey.json` in the install directory, readable by the installing user only, and records as `owner_account_uid` in `config.json`. The deploy output ends with the account, the path of that file and how to take the root of the space: import the file in the vault at `https://<your-domain>/vault/settings` (Import identity in the sidebar; it asks for the password if the file has one), with the desktop app's key import, or with `seed-cli key import <file>`. The mnemonic is never written anywhere; the key file is the only copy outside the daemon, so after importing it keep it somewhere safe or delete it. `seed-deploy secret` prints the path again. If the attempt fails, the deploy still succeeds and says so; run `seed-deploy bootstrap-space` once the site answers. <!-- id:r-BPKkwp -->

# Changing the hostname

Set the hostname before inviting anyone: WebAuthn passkeys are bound to the domain they were registered on, so a passkey created at the first address does not work at the next one (password sign-in keeps working; the person signs in with the password and adds a new passkey in the vault). For a customer domain, the customer creates an `A` record for the name (`seed` for `seed.customer.org`, or `@` for the root) whose value is the server's IP address, with any proxying turned off, because the proxy needs the name to resolve to the server to get a certificate from Let's Encrypt. Once it resolves, `seed-deploy set-hostname https://seed.customer.org` does the rest: `config.json`, the Caddyfile and the containers' env (`SEED_BASE_URL`, the vault's relying party, the agents' site address) follow the hostname, and after the containers are healthy the script calls `POST /hm/api/enterprise-site-url` with the `vault_admin_secret`, which has the web app republish the space's home document with `siteUrl` set to the new address, a metadata-only change signed by the daemon-held owner key, in the document's current generation. The same happens when a reconfiguration (`deploy --reconfigure`, or `deploy --profile enterprise --hostname … --yes`) changes the hostname. If that last step fails, the node is up and `set-hostname` with the same hostname retries only the republish; `doctor` warns while the home document and the hostname disagree. The previous hostname is kept in `redirect_hostnames` in `config.json`: Caddy still gets a certificate for it and redirects it to the new address, so a managed address such as `<name>.hyper.media` keeps working after the organization's own domain takes over. <!-- id:jwAyBGru -->

The general steps for domains are in [custom domains](./custom-domains.md).

# What is isolated and how

The daemon's libp2p listener binds to loopback inside its container and has no published port, so no peer can reach it; `-p2p.isolated` refuses every connection and dials nobody, `-p2p.bootstrap-peers=none`, `-syncing.no-discovery` and `-syncing.no-pull` mean it looks for nothing, and the private testnet name keeps it off the public network even if a peer address leaked in. The image already sets `SEED_SERVER_MODE=true`; `-lndhub.disabled` stops the wallet integration and `SENTRY_DSN` is empty, so no telemetry. The web app talks only to the daemon, the vault, and, when enabled, the notify and agents services on the box, at `https://<your-domain>/hm/api/notify` and `https://<your-domain>/hm/api/apps`, so the node needs one hostname and one certificate; `NOTIFY_SERVICE_HOST`, `SEED_AGENT_SERVER_URL` and `SEED_HOST_URL` are empty otherwise (empty, not unset: the vault and the web app treat an unset notify address as the hosted service). The vault uses the site's domain as its WebAuthn relying party and reaches the daemon over the internal network. What leaves the server is email, through your SMTP account or the hosting email relay, and the agents' calls to their model provider, when agents are on. Caddy caps request bodies at 512 MB; rate limiting needs a Caddy plugin that the stock `caddy:2` image lacks, so it is not configured. <!-- id:psaC0t3q -->

The daemon flags are described in the [daemon](../software/daemon.md) page.

# Public content from other spaces

Because the daemon never talks to another node, a document from another space (an embed of a public document, the Agent Guide the app environment puts in its system prompt, a directory the agents read) is not on the box. The web app therefore answers those reads from a mainnet node's public HTTP API: when the daemon reports `Resource`, `ResourceMetadata` or `Account` not found, or a `Query` over one space comes back empty, _and the daemon has never seen that account_, the web app asks the same `GET /api/<Key>` of `upstream_api_url` (default `https://hyper.media`; set it to `""` in `config.json` to keep every read on the box) and passes the answer through. Images and files of such documents come the same way, from the node's `/ipfs/<cid>`. Nothing is stored locally, answers are cached for a minute, and a read inside the organization's own space, or of any account the daemon knows, is never sent out. What does leave the box is the id of the external document or image being read. The app environment reads through the site, so it gets the same content, and `hm://hyper.media/...` links resolve to the Seed knowledge base space (`SEED_APPS_DOCS_ACCOUNT`). <!-- id:cWj9GrHk -->

# Updates

On the two preset image channels an enterprise node installs the same ten-minute `upgrade` + `deploy` cron as a site: on `latest` a release reaches it like everyone else, and on `dev` it follows `main` (Seed's own test nodes run this way). On any other channel (a branch's images under test) no cron is installed: `seed-deploy deploy` by hand fetches the compose file and new images, and `seed-deploy cron` installs the auto-update if you want it after all. `seed-deploy backup` includes the `vault`, `notify` and `agents` directories along with `web`, `daemon` and `proxy`; `owner-key/` is left out on purpose, the exported key is for importing, not for keeping on the box. A directory that holds [private](../protocol/privacy.md) content of the organization's space should be treated accordingly, together with `config.json`, which holds the secrets. <!-- id:CkumJWKC -->

# Agents and code execution

With agents on, the node runs its own [app environment](./operations.md) for members only. Sandboxed code execution needs `/dev/kvm` on the host and `"agents_kvm": true` in `config.json`; see [self-hosting](./self-hosting.md#what-is-running).

# Limits

Privacy comes from the node being unreachable: documents inside it are ordinary public documents. The host firewall and the egress allowlist for the mail relay and model provider are the operator's; the script does not configure them. Backups are not encrypted. There is no single sign-on in front of the vault, and no audit log of sign-ins and capability grants. A file fetched by `/ipfs/*` is protected by the sign-in gate only. `doctor` fails its isolation checks when the running images are too old to support the isolation flags.

# See also

- [Self-hosting](./self-hosting.md), the site profile and the `seed-deploy` command
- [Custom domains](./custom-domains.md)
- [Running an invite-only vault](./invite-only-vault.md)
- [Vault](../software/vault.md), invite-only mode and the admin API
- [Notify](../software/notify.md), the notification service
- [Web app](../software/web.md) and [daemon](../software/daemon.md), configuration and flags
- [Operations](./operations.md), running the app environment the node may include
- [Privacy](../protocol/privacy.md), private documents in the protocol

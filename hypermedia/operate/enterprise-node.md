---
name: Enterprise node
summary: This page explains how to run the deploy script's enterprise profile, a Seed node for one organization that only invited people can use and that does not connect to the public network, including sign-in, invitations, the organization's space and what is cut off.
---
An enterprise node is Seed for one organization. It is one server with one [space](../protocol/spaces.md). Only the people the organization invites get an [account](../protocol/identity.md). The node makes no peer-to-peer connection to the public network; it reads public content from other spaces over HTTPS (see below). The deploy script sets it up with its second profile, `--profile enterprise`. <!-- id:SmsqKy8U -->

The first thing to check on a running node is `seed-deploy doctor`. It tests the containers, the sign-in check and the isolation.

This page covers what the profile runs, how people get in, how the organization's space is made, and what the node may talk to. Read [self-hosting](./self-hosting.md) first. Everything there about DNS, the install directory, `seed-deploy` and backups applies here too.

# Installing <!-- id:Gu7dKSSd -->

Start the script with `--profile enterprise`:

```sh <!-- id:MMYMCpKk -->
curl -fsSL https://deploy.seed.hyper.media | sh -s -- --profile enterprise
```

The script then asks its questions; see [The wizard](#the-wizard). When there is no terminal, for example over `ssh host 'curl … | sh -s -- …'`, pass the answers as flags and add `--yes`: <!-- id:4j3G4NRg -->

```sh
seed-deploy deploy --profile enterprise --hostname https://example.org --tag latest --email you@example.org [--agents] [--notify] --yes
```

- With `--notify` and no email relay (below), give the SMTP account in `SEED_SMTP_HOST`, `SEED_SMTP_USER`, `SEED_SMTP_PASSWORD` and `SEED_SMTP_SENDER`.
- `--tag` takes any image tag. That includes the cleaned-up branch name that a branch build of the Docker images produces.

# What it runs

The compose file is `ops/docker-compose.enterprise.yml`. All services share one internal network. Only the proxy publishes ports. <!-- id:nVgqaBxr -->

<!-- id:LecTiL0u -->
| Container <!-- col:rhKWqWfk --> | Image <!-- col:zuvbCYOv --> | Ports on the host <!-- col:tgEmfnEB --> | Role <!-- col:yOlHfk0n --> <!-- id:Yqr-rNc0 --> |
| --- | --- | --- | --- |
| `seed-proxy` | `caddy:2` | 80, 443, 443/udp | TLS, then reverse proxy with the sign-in gate <!-- id:iIX_7yUo --> |
| `seed-web` | `seedhypermedia/web` | none | the [web app](../software/web.md) with `SEED_REQUIRE_SIGN_IN=1`, signing and identity enabled, a session secret, and the vault's internal address for the membership check at sign-in <!-- id:vcVzeB0S --> |
| `seed-daemon` | `seedhypermedia/site` | none | the [daemon](../software/daemon.md) with `-p2p.isolated` (no bootstrap, a deny-all connection gater, no [peer exchange](../protocol/network.md)), `-lndhub.disabled`, no discovery, no pull, no relay, libp2p listening on loopback only, on a private network named `ent-<your-domain>` <!-- id:q8ChJINS --> |
| `seed-vault` | `seedhypermedia/vault` | none | the [identity vault](../software/vault.md), invite-only, served at `/vault` on the site's own origin <!-- id:edY-0Yxh --> |
| `seed-notify` | `seedhypermedia/notify` | none | optional, compose profile `notify`, served by the site itself under `/hm/api/notify`, open (signed requests and email tokens are its credentials) <!-- id:-epLLDvA --> |
| `seed-agents` | `seedhypermedia/agents` | none | optional, compose profile `agents`, served by the site itself under `/hm/api/apps` and `/hm/api/agents`, for members only <!-- id:ih7fSiBc --> |

The `metrics` profile with Prometheus and Grafana is the same as in the site profile. Every image uses the tag of the release channel. `web_image` and `site_image` in `config.json` replace the web and daemon images, as on a site. <!-- id:LVEbsBHl -->

# The wizard

The wizard asks these questions. The last column is the flag to use when there is no terminal. <!-- id:T1lArSoQ -->

| Question | What to answer | Without a terminal |
| --- | --- | --- |
| Public hostname | the full URL of the [site](../protocol/sites.md), `https://example.org` | `--hostname` |
| Name of the organization's space | the bare hostname by default | `--site-name` |
| Password for the space's exported owner key | optional; asked on a first run only | `--owner-password` or `SEED_OWNER_PASSWORD` |
| Release channel | `latest`, or `dev` for builds of `main` | `--tag` |
| Log level | Info | |
| Run [agents](../agent.md) | no by default | `--agents` |
| Run notify | no by default | `--notify` |
| SMTP host, user, password and sender address | asked only when notify is on and no email relay is configured | `SEED_SMTP_HOST`, `SEED_SMTP_USER`, `SEED_SMTP_PASSWORD`, `SEED_SMTP_SENDER` |
| Contact email | an address for security notices | `--email` |

The vault and the notify service both send mail with STARTTLS on port 587. `smtp.port` in `config.json` changes the port.

The wizard does not ask about the network, gateway mode or analytics. The profile turns mainnet off, gateway mode off and statistics off.

The wizard makes four secrets and stores them in `config.json`:

- `link_secret`: the registration secret that `/hm/register` uses.
- `vault_admin_secret`: a 40-character bearer token for the vault's admin API.
- `session_secret`: the key the web app signs its session cookie with.
- `service_secret`: what the [app environment](../software/app-environment.md) shows in place of a session cookie, in the header `X-Seed-Service-Secret`. The app environment reads the site from the server side, for example to notice the mentions that fire its [triggers](../trigger.md).

`seed-deploy config` prints the secrets with their values hidden, and the email relay token too.

# Email without an SMTP account

The Seed hosting service can give an enterprise node an email relay: an HTTPS address and a bearer token. With the relay configured, the [vault](../software/vault.md) sends its verification codes through it, and the [notify](../software/notify.md) service sends its notification emails through it. <!-- id:UcJWnrmu -->

Each email is one `POST <url>` with `Authorization: Bearer <token>` and a JSON body `{to, subject, text, html?, replyTo?}`. Any 2xx answer means the relay took it. Anything else fails the send. The hosting relay sets the From address itself; this describes the hosted service and can change.

The relay wins over SMTP. So with a relay, you can turn notify on without an SMTP account.

How to set it:

- `seed-deploy --advanced` asks for the two values. The ordinary wizard does not ask, so a relay stays as it is when you reconfigure.
- Without a terminal, pass `--email-relay-url` and `--email-relay-token`, or set `SEED_EMAIL_RELAY_URL` and `SEED_EMAIL_RELAY_TOKEN` in the environment.
- The values are stored as `email_relay_url` and `email_relay_token` in `config.json`.
- They reach the containers as `SEED_VAULT_EMAIL_RELAY_URL`/`_TOKEN` on `seed-vault` and `NOTIFY_EMAIL_RELAY_URL`/`_TOKEN` on `seed-notify`.

# Getting in

Caddy asks the web app whether each request comes from a signed-in member. If not, a browser is sent to `/hm/sign-in` and an API call gets `401`. <!-- id:dfzFMVc0 -->

In detail: for every request that is not on an open path, Caddy calls `/hm/api/session` on the web app (`forward_auth`, with the original path in `X-Forwarded-Uri`). An answer of `204` lets the request through. Any other answer goes back to the client: a `302` to `/hm/sign-in?next=…` for a browser, or a `401` for an API call.

These sit behind the gate like the rest of the site:

- the daemon's `/ipfs/*` reads;
- the `/.metrics` pages;
- the app environment: `/hm/api/apps` and `/hm/api/agents` and everything under them, API and WebSocket.

These paths are open:

| Open path | Why it is open |
| --- | --- |
| `/hm/sign-in`, `/hm/auth/callback`, `/hm/api/auth`, `/hm/api/session` | the sign-in flow itself |
| `/vault` | the vault, where people sign in |
| `POST /api/PublishBlobs`, `GET /api/Account`, `POST /ipfs/*` | calls the sign-in callback makes before a cookie exists; `POST /ipfs/*` is for the vault's profile uploads |
| `/hm/api/config`, `/hm/api/version`, `/hm/api/register`, `/hm/register`, `/hm/create-site` | the [Seed app](../software/desktop.md) and the deploy script use them |
| `POST /hm/api/enterprise-bootstrap`, `POST /hm/api/enterprise-site-url` | the deploy script uses them; they demand the vault admin secret |
| `POST …/webhooks/*` under `/hm/api/apps` and `/hm/api/agents` | outside services call them with the trigger's secret in the path |
| `/hm/api/notify` and everything under it | the notify service; it goes straight to `seed-notify`. Its requests are signed by the account or carry the email token |
| `/hm/api/notifications`, `/hm/api/notification-config`, `/hm/api/notification-inbox`, `/hm/api/notification-read-state`, `/hm/api/public-subscribe`, `/hm/api/email-notif-token`, `/hm/api/unsubscribe` | the paths older Seed apps call for notify |
| `/hm/email-notifications` | the email notification settings page, reached from a link in an email. A person who follows an email link need not be a member |
| static assets | the pages above need them |

The proxy's list is made from the web app's `isOpenPath` rules in `frontend/apps/web/app/require-sign-in.ts`, so the two always agree.

# Commands

These commands are added to the ones in [self-hosting](./self-hosting.md#day-to-day). [Running an invite-only vault](./invite-only-vault.md) covers the vault's side of invitations.

<!-- id:1V-6GEFb -->
| Command <!-- col:fBwCAh7c --> | What it does <!-- col:02tbloGC --> <!-- id:LbTJ86ZQ --> |
| --- | --- |
| `seed-deploy invite <email> [--role reader\|writer] [--no-email]` | Makes an invitation link for one person. It asks the vault's admin API (`POST /vault/api/admin/invitations` with the `vault_admin_secret`). The link has the form `https://example.org/hm/sign-in?invite=<code>&email=<email>` and works once. It opens the site's sign-in page, which creates the account in the vault and signs the person in to the site in one flow, so they arrive as a member. The vault emails the link to the person through the hosting relay (`--no-email` only prints it), and the command prints it too. Each invitation belongs to that one address: the vault shows it read-only and accepts no other. The vault is invite-only, so this is how each person gets an account. `--role writer` makes the vault give them a WRITER [capability](../protocol/permissions.md) on the space, signed with the owner key, as soon as their account exists. The default `reader` gives read access only <!-- id:h22Ii8NQ --> |
| `seed-deploy bootstrap-space [--site-name …] [--owner-password …]` | Creates the organization's space and registers the site to it. The first deploy does this by itself; use the command when that attempt failed. It is safe to run again: on a registered site it prints the existing account and changes nothing <!-- id:m-gL1TMf --> |
| `seed-deploy register <accountUid>` | Registers a space that already lives on this daemon. It reads the daemon's peer id from `/hm/api/config` and posts it with the [account ID](../protocol/identity.md) and `link_secret` to `/hm/api/register`, the same call the Seed app makes. For a space created in the browser, `/hm/register?secret=…` from `seed-deploy secret` works as on a site <!-- id:_ncOyesd --> |
| `seed-deploy set-hostname https://new.example.org` | Moves the node to a new hostname. It rewrites `domain` in `config.json`, redeploys (Caddyfile, certificate, every container's environment) and then republishes the space's home document with the new address; see below <!-- id:0CXh3dmU --> |
| `seed-deploy doctor` | Adds these to the usual checks: `docker port seed-daemon` is empty; `/hm/api/config` reports `requireSignIn: true`; the `siteUrl` of the space's home document matches the hostname; `GET /` without a session is sent to `/hm/sign-in`; `/vault/` answers. It skips the lightning and testnet checks <!-- id:XVCsL0xH --> |

# The organization's space

The script creates the space itself, once the health checks of the first deploy pass. So the first person who signs in finds a site, not an empty node. <!-- id:r-BPKkwp -->

1. The script calls `POST /hm/api/enterprise-bootstrap` on the public hostname, with the `vault_admin_secret`. It tries again for about half a minute while the web app starts.
2. The web app makes a key in the daemon's keystore, from a [mnemonic](../protocol/identity.md) it holds only for that request. It publishes the space's home [document](../protocol/documents.md), signed by that key. The document has the name from the wizard or `--site-name`, the site's address and a welcome paragraph. Then it registers the site to the new account, the way `/hm/api/register` does.
3. The answer carries the space's account and the standard [`.hmkey.json`](../build/keys.md) export of its key. The export is encrypted with the owner password when you gave one. The script saves it as `owner-key/<accountUid>.hmkey.json` in the install directory, readable only by the user who installed. It records the account as `owner_account_uid` in `config.json`.
4. The deploy output ends with the account, the path of the key file, and how to take control of the space. Import the file in one of three ways: in the vault at `https://<your-domain>/vault/settings` (Import identity in the sidebar; it asks for the password if the file has one), with the desktop app's key import, or with `seed-cli key import <file>`.

The mnemonic is never written anywhere. The key file is the only copy outside the daemon. After you import it, keep it somewhere safe or delete it. `seed-deploy secret` prints its path again.

If the attempt fails, the deploy still succeeds and says so. Run `seed-deploy bootstrap-space` once the site answers.

# Changing the hostname

**Before you start.** Set the hostname before you invite anyone. A passkey (WebAuthn) belongs to the domain it was made on, so a passkey made at the first address does not work at the next one. Password sign-in keeps working: the person signs in with the password and adds a new passkey in the vault. <!-- id:jwAyBGru -->

For a customer's domain, the customer makes an `A` record for the name (`seed` for `seed.customer.org`, or `@` for the root) whose value is the server's IP address. Any proxying by the DNS provider must be off. The proxy on the node needs the name to lead to the server, or it cannot get a certificate from Let's Encrypt.

**The command.** Once the name leads to the server, run:

```sh
seed-deploy set-hostname https://seed.customer.org
```

1. `config.json`, the Caddyfile and the containers' environment follow the new hostname: `SEED_BASE_URL`, the vault's relying party, and the agents' site address.
2. When the containers are healthy, the script calls `POST /hm/api/enterprise-site-url` with the `vault_admin_secret`.
3. The web app republishes the space's home document with `siteUrl` set to the new address. Only the metadata changes. The owner key in the daemon signs it, in the document's current generation.

The same happens when a reconfiguration changes the hostname (`deploy --reconfigure`, or `deploy --profile enterprise --hostname … --yes`).

**If the last step fails.** The node is up. Run `set-hostname` again with the same hostname; it tries only the republish. `doctor` warns as long as the home document and the hostname disagree.

**The old hostname.** It is kept in `redirect_hostnames` in `config.json`. Caddy still gets a certificate for it and redirects it to the new address. So a managed address such as `<name>.hyper.media` keeps working after the organization's own domain takes over.

The general steps for domains are in [custom domains](./custom-domains.md).

# What is isolated and how

The node is closed off in these ways: <!-- id:psaC0t3q -->

| What | How it is closed |
| --- | --- |
| Peers reaching the daemon | The daemon's libp2p listener is on loopback inside its container, and no port is published |
| The daemon reaching peers | `-p2p.isolated` refuses every connection and dials nobody. `-p2p.bootstrap-peers=none`, `-syncing.no-discovery` and `-syncing.no-pull` mean it looks for nothing |
| A peer address that leaks in | The private testnet name keeps the node off the public network |
| The wallet | `-lndhub.disabled` |
| Telemetry | `SENTRY_DSN` is empty |
| The web app's calls | It talks only to the daemon, the vault and, when they are on, the notify and agents services on the same server, at `https://<your-domain>/hm/api/notify` and `https://<your-domain>/hm/api/apps`. So the node needs one hostname and one certificate |
| The hosted services | `NOTIFY_SERVICE_HOST`, `SEED_AGENT_SERVER_URL` and `SEED_HOST_URL` are empty when those services are off. They are empty, not unset: the vault and the web app treat an unset notify address as the hosted service |
| The vault | It uses the site's domain as its WebAuthn relying party and reaches the daemon over the internal network |

The image already sets `SEED_SERVER_MODE=true`.

What leaves the server:

- email, through your SMTP account or the hosting email relay;
- the agents' calls to their model provider, when agents are on.

Caddy limits a request body to 512 MB. Rate limiting needs a Caddy plugin that the stock `caddy:2` image does not have, so it is not configured.

The [daemon network reference](./daemon-network.md#flags-that-matter-to-operators) describes these flags.

# Public content from other spaces

The daemon never talks to another node. So a document from another space is not on the server. Examples are an embed of a public document, the Agent Guide that the app environment puts in its system prompt, and a directory the agents read. <!-- id:cWj9GrHk -->

The web app answers those reads from the public HTTP API of a mainnet node:

1. The daemon reports `Resource`, `ResourceMetadata` or `Account` as not found, or a `Query` over one space comes back empty.
2. The web app checks that the daemon has never seen that account.
3. The web app sends the same `GET /api/<Key>` to `upstream_api_url` and passes the answer on. The default is `https://hyper.media`. Set it to `""` in `config.json` to keep every read on the server.

Images and files of such documents come the same way, from that node's `/ipfs/<cid>`.

What this means for privacy:

- Nothing is stored on the server, and answers are cached for a minute.
- A read inside the organization's own space, or of any account the daemon knows, is never sent out.
- What does leave the server is the id of the outside document or image that is read.

The app environment reads through the site, so it gets the same content. `hm://hyper.media/...` links lead to the Seed knowledge base space (`SEED_APPS_DOCS_ACCOUNT`).

# Updates

On the two usual image channels, an enterprise node installs the same cron job as a site: `upgrade` then `deploy`, every ten minutes. On `latest` it gets each release. On `dev` it follows `main`; Seed's own test nodes run this way. <!-- id:CkumJWKC -->

On any other channel, such as a branch's images under test, no cron job is installed. Run `seed-deploy deploy` by hand to get the compose file and new images. `seed-deploy cron` installs the automatic update if you want it after all.

`seed-deploy backup` includes the `vault`, `notify` and `agents` directories, along with `web`, `daemon` and `proxy`. It leaves out `owner-key/` on purpose: the exported key is for importing, not for keeping on the server.

Treat a backup with care. It can hold [private](../protocol/privacy.md) content of the organization's space, and `config.json` holds the secrets.

# Agents and code execution

With agents on, the node runs its own [app environment](../software/app-environment.md) for members only. [Operating an app environment](./operations.md) says how to look after it. Code execution in a sandbox needs `/dev/kvm` on the host and `"agents_kvm": true` in `config.json`; see [self-hosting](./self-hosting.md#what-is-running). Without it, agents are not offered `execute`.

# Limits

- Privacy comes from the node being out of reach. The documents inside it are ordinary public documents.
- The host firewall is yours to set up. So is the list of outside addresses the server may call, for the mail relay and the model provider. The script does not configure them.
- Backups are not encrypted.
- There is no single sign-on in front of the vault.
- There is no audit log of sign-ins and capability grants.
- A file fetched by `/ipfs/*` is protected by the sign-in gate only.
- `doctor` fails its isolation checks when the running images are too old to know the isolation flags.

# See also

- [Self-hosting](./self-hosting.md), the site profile and the `seed-deploy` command
- [Custom domains](./custom-domains.md)
- [Running an invite-only vault](./invite-only-vault.md)
- [Vault](../software/vault.md), invite-only mode and the admin API
- [Notify](../software/notify.md), the notification service
- [Web app](../software/web.md) and [daemon](../software/daemon.md), the two programs of a site
- [Daemon network reference](./daemon-network.md), the daemon's flags
- [Operations](./operations.md), running the app environment the node may include
- [Privacy](../protocol/privacy.md), private documents in the protocol

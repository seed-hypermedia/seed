# Seed Hypermedia on Easypanel

New to Easypanel? Follow the step-by-step [tutorial](TUTORIAL.md).

This template deploys one Seed site in an Easypanel project with a daemon, web
app, and Shepherd updater. Easypanel enables HTTPS for the site's domain by
default.

## Deploy

1. In Easypanel, create a project from schema/JSON and paste the contents of
   `ops/easypanel/seed.json`.
2. Replace every `seed.example.com` with your site's hostname. Set the web
   service's `SEED_LINK_SECRET` environment value to a unique secret from
   `openssl rand -hex 24`. Leave the `REPLACE_WITH_SECRET` check in the web
   command unchanged; it prevents deploying the placeholder secret.
3. Point the domain's DNS records at this server before deploying. HTTPS is
   enabled by default, so DNS must already resolve to Easypanel when the
   services are deployed.
4. Open the configured P2P port on the server firewall for both TCP and UDP.
   Choose a unique port for each Seed site.
5. After deployment, read `SEED_LINK_SECRET` from the web service's environment
   and register from Seed with
   `https://<domain>/hm/register?secret=<SEED_LINK_SECRET>`.

The template routes `/` to the web service and `/ipfs/` to the daemon on the
same domain. `SEED_ASSET_HOST` is set to the site's `https://<domain>` base URL,
so browser-facing file and image URLs use the public site domain.

## Updates and backups

Shepherd checks for updated images every 600 seconds (10 minutes) and updates
services whose names start with the Easypanel project name. The updater excludes
itself. Choose project names so one Seed project's name is not a prefix of
another Seed project's name; for example, avoid `seed` and `seed_prod` because
the name filter can match both.

Back up both persistent `data` volumes. The daemon volume stores its node data
and keys under `/data/keys`; the web volume stores `/data/config.json`,
including the registration secret written on first start. The web command leaves
an existing `config.json` unchanged on restarts.

## Images

The defaults are `seedhypermedia/site:latest` and `seedhypermedia/web:latest`.
These moving tags are intentional so Shepherd can follow new releases. Override
the daemon and web image fields to use a different registry, fork, or pinned
version. For this fork, use `ghcr.io/horacioh/seed-site:main` and
`ghcr.io/horacioh/seed-web:main`.

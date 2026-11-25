# Seed site on Fly.io

New to Fly.io? Follow the step-by-step [tutorial](TUTORIAL.md).

This template deploys one Seed site as two Fly apps: a public web app and a private daemon app. The web app is the only
HTTP entrypoint. It proxies `GET /ipfs/*` to its own daemon over Fly's private network; uploads use the Seed client and
do not require the daemon's HTTP listener to be public. The daemon exposes only its P2P TCP and UDP listeners.

Each app has one Fly Machine and one persistent volume in the same region. The web app uses HTTPS on its `fly.dev`
hostname by default. It builds from `seedhypermedia/web:latest` with a minimal Dockerfile that runs as root, so it can
write to Fly's root-owned `/data` volume. The daemon uses a dedicated IPv4 address for public P2P traffic.

## Prerequisites

- `flyctl` installed and authenticated with `fly auth login`
- Bash, `jq`, and OpenSSL available in `PATH`
- Access to the Fly organization set with `FLY_ORG` (defaults to `personal`)

## Deploy

From the Seed repository root:

```sh
SITE=my-seed-site REGION=iad ./ops/fly/deploy.sh
```

The default web URL is `https://my-seed-site-web.fly.dev`; the daemon P2P hostname is `my-seed-site-daemon.fly.dev`. The
script creates missing apps, one 1 GB volume per app, a dedicated daemon IPv4 address, and a `SEED_LINK_SECRET` only
when one is not already stored in Fly secrets. Re-running the script is the update path; it preserves the app volumes
and existing registration secret, redeploys the daemon image, and rebuilds the web image from its `latest` base without
build cache.

Both Machines start as `shared-cpu-1x` with 1 GB of memory. Each app is intentionally limited to one Machine;
autoscaling and redundant Machines are not configured.

## Custom domain

Pass a lowercase hostname without a scheme, port, or path:

```sh
SITE=my-seed-site DOMAIN=seed.example.com REGION=iad ./ops/fly/deploy.sh
```

The script adds a Fly certificate and prints the web app's IPv4 and IPv6 addresses. Create the corresponding `A` and
`AAAA` DNS records for the custom hostname, then allow the certificate to validate. `SEED_BASE_URL` and
`SEED_ASSET_HOST` use the custom HTTPS hostname when `DOMAIN` is supplied.

## Registration

When the web app's secret is first created, the script prints the registration link once:

```text
https://<public-site-hostname>/hm/register?secret=<SEED_LINK_SECRET>
```

Save the link in a password manager or another secure location. Fly encrypts the app secret and does not reveal its
value again; later deploys preserve it and do not print it.

## Updates and backups

Run the same `SITE=... [DOMAIN=...] [REGION=...] ./ops/fly/deploy.sh` command to deploy updated `latest` images and
configuration. Do not deploy the two apps independently with a partial environment.

Fly volumes are local to their region and attached to one Machine. Create or inspect snapshots with
`fly volumes snapshots`; restore from a snapshot by creating a new volume and attaching it to the app. Keep backups of
daemon data protected: `/data/keys` contains the daemon's private keys and must not be shared or exposed.

## Costs and limits

The dedicated IPv4 address has a monthly charge, in addition to the two `shared-cpu-1x` Machines and both persistent
volumes. Snapshot storage may add cost. Check Fly.io's current pricing for the selected region and storage size.

There is exactly one Machine per app and no autoscaling. The daemon's UDP listener must bind to Fly's
`fly-global-services` IPv4 address on the external port; the TCP listener binds to `0.0.0.0:56000`. The web app reaches
the daemon over `<site>-daemon.internal:56001`. The daemon HTTP listener is not exposed publicly.

# Deploy a Seed site on Fly.io

The deploy script creates a public web app and a private daemon app. The web app is the HTTP entrypoint and proxies
`GET /ipfs/*` to the daemon; the daemon exposes P2P over TCP and UDP.

## Before you start

- A Fly organization, `flyctl` installed and authenticated with `fly auth login`, and Bash, `jq`, and OpenSSL in `PATH`.
- The Seed desktop app for registration.
- The daemon uses P2P port `56000` for both TCP and UDP and gets a dedicated IPv4 address. Fly charges monthly for that
  dedicated IPv4 address.

## Step 1: Deploy the two apps

From the Seed repository root, choose a lowercase Fly app-name prefix and region, then run:

```sh
SITE=my-seed-site REGION=iad ./ops/fly/deploy.sh
```

`REGION` defaults to `iad`, and `FLY_ORG` defaults to `personal`. The script creates the daemon and web apps, one volume
per app, the daemon's dedicated IPv4 address, and deploys both apps. It creates a registration secret only when one is
not already stored.

By default, the script uses `seedhypermedia/site:latest` for the daemon and `seedhypermedia/web:latest` as the web
image's Dockerfile base. To use the fork, change the `image` value in `ops/fly/daemon/fly.toml` to
`ghcr.io/horacioh/seed-site:main` and the `FROM` line in `ops/fly/web/Dockerfile` to `ghcr.io/horacioh/seed-web:main`.

On the first deployment, the script prints the registration link once:

```text
Save this registration link securely; it is printed only when the secret is first created:
https://my-seed-site-web.fly.dev/hm/register?secret=<generated-secret>
Site URL: https://my-seed-site-web.fly.dev
The registration link was printed once above; save it securely.
```

## Step 2: Add an optional custom domain

Pass a lowercase hostname without a scheme, port, or path:

```sh
SITE=my-seed-site DOMAIN=seed.example.com REGION=iad ./ops/fly/deploy.sh
```

The script adds a Fly certificate and prints the web app's IPv4 and IPv6 addresses. Create the corresponding A and AAAA
DNS records for the hostname, then allow the certificate to validate. The script uses the custom HTTPS hostname for
`SEED_BASE_URL` and `SEED_ASSET_HOST`.

## Register the site from Seed desktop

Use the registration link printed by the first deployment from the Seed desktop app:

```text
https://<public-site-hostname>/hm/register?secret=<SEED_LINK_SECRET>
```

Save the link securely. Fly encrypts the app secret and does not reveal it again; later deploys preserve the secret and
do not print the link again. Until the site is registered, it shows a “coming soon” page.

## Check that it works

Run:

```sh
curl -fsS "https://<public-site-hostname>/hm/api/config"
```

The response should be JSON.

## Updates

Run the same `SITE=... [DOMAIN=...] [REGION=...] ./ops/fly/deploy.sh` command to deploy updated images and
configuration. It redeploys both apps; do not deploy them independently with a partial environment. The template uses
one Machine per app and does not configure autoscaling.

## Backups

Fly volumes are local to their region. Create or inspect snapshots with `fly volumes snapshots`; restore from a snapshot
by creating a new volume and attaching it to the app. Keep the daemon's `/data/keys` private.

## Troubleshooting

- Use a lowercase `DOMAIN` without a scheme, port, or path. After adding a custom domain, create the A and AAAA records
  for the web app addresses printed by the script.
- The daemon's UDP listener binds to Fly's `fly-global-services` IPv4 address; the TCP listener binds to
  `0.0.0.0:56000`.
- The dedicated IPv4 address has a monthly charge. Each app is intentionally limited to one Machine.

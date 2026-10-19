# Deploy a Seed site on Dokploy

The Compose stack runs the Seed daemon, web app, initializer, and scoped Watchtower updater. Dokploy routes web traffic
to the web service and `/ipfs/` requests to the daemon; HTTPS is enabled by default.

## Before you start

- A Dokploy server and a domain whose DNS points to that server before the first deploy.
- A P2P host port, `56000` by default, open for both TCP and UDP. Use a unique port for each Seed site on the server.
- Python 3 to generate the import payload, and the Seed desktop app for registration.

## Step 1: Create the Compose service

From the Seed repository root, run this command to generate the base64 template payload:

```sh
python3 -c 'import base64,json,pathlib; p=pathlib.Path("ops/dokploy/seed"); print(base64.b64encode(json.dumps({"compose":(p/"docker-compose.yml").read_text(),"config":(p/"template.toml").read_text()},indent=2,ensure_ascii=False).encode()).decode())'
```

In Dokploy, create a **Compose** service, open **Advanced → Import**, and paste the command's output.

## Step 2: Set the domain, port, and images

Replace the generated `*.traefik.me` hostname with your domain everywhere it appears: both domain entries,
`SEED_DOMAIN`, and `SEED_BASE_URL`. For example, use `site.example.com` for `SEED_DOMAIN` and `https://site.example.com`
for `SEED_BASE_URL`.

The default P2P host port is `56000`; make sure it is open for TCP and UDP. For the fork's images, set:

```text
SEED_WEB_IMAGE=ghcr.io/horacioh/seed-web:main
SEED_SITE_IMAGE=ghcr.io/horacioh/seed-site:main
```

`SEED_ASSET_HOST` defaults to `${SEED_BASE_URL}`. Set it only if file and image URLs should use a different public base
URL. The default `SEED_UPDATE_INTERVAL` is `600` seconds.

## Step 3: Deploy

Deploy the Compose service. The template creates the registration secret and stores it in the web volume on first start.

## Register the site from Seed desktop

Copy `SEED_LINK_SECRET` from the service's environment variables and use this link in the Seed desktop app:

```text
https://<domain>/hm/register?secret=<SEED_LINK_SECRET>
```

Until registration is complete, the site shows a “coming soon” page.

## Check that it works

Run:

```sh
curl -fsS "https://<domain>/hm/api/config"
```

The response should be JSON.

## Updates

The stack's scoped Watchtower updater checks for images every `SEED_UPDATE_INTERVAL` seconds (`600` by default) and
updates the labeled daemon and web services. The default `latest` tags follow upstream stable releases; the fork's
`ghcr.io/horacioh/seed-*:main` tags follow pushes to `custom-images`. Pin an exact image version tag to stop following a
moving tag.

## Backups

Back up both named volumes: `seed-daemon-data` stores the database, blobs, and node keys; `seed-web-data` stores
`config.json`.

## Troubleshooting

- Before deploying, replace every generated `*.traefik.me` hostname, including both domain entries, `SEED_DOMAIN`, and
  `SEED_BASE_URL`.
- The P2P host port must be open for both TCP and UDP and unique to this site on the server.

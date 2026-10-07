# Deploy a Seed site on Easypanel

The template deploys a daemon, web app, and Shepherd updater in one Easypanel project. Easypanel routes the site over
HTTPS and sends `/ipfs/` requests to the daemon.

## Before you start

- An Easypanel server and a domain whose DNS already points to it before deployment.
- A P2P port, `56000` by default, open for both TCP and UDP. Use a unique port for each Seed site.
- OpenSSL to generate the registration secret, and the Seed desktop app to register the site.

## Step 1: Create the project from the template

Create an Easypanel project from schema/JSON and paste the contents of `ops/easypanel/seed.json`.

## Step 2: Set the domain, port, secret, and images

Use a lowercase hostname such as `site.example.com`, with no scheme, port, or path. Replace every `seed.example.com` in
the imported template with that hostname. The schema's `domain` field uses this hostname; the default P2P port is
`56000`.

Set `SEED_LINK_SECRET` on the web service to a unique value generated with:

```sh
openssl rand -hex 24
```

Do not change the `REPLACE_WITH_SECRET` check in the web command. It stops the service if the placeholder secret was not
replaced.

For the fork's images, set the daemon image to `ghcr.io/horacioh/seed-site:main` and the web image to
`ghcr.io/horacioh/seed-web:main`.

Point DNS at the server before deploying, and open the P2P port for both TCP and UDP.

## Step 3: Deploy

Deploy the project. Easypanel enables HTTPS for the domain by default.

## Register the site from Seed desktop

Read `SEED_LINK_SECRET` from the web service's environment and use this link in the Seed desktop app:

```text
https://<domain>/hm/register?secret=<SEED_LINK_SECRET>
```

The secret is written to `/data/config.json` on first start and preserved on restarts. Until registration is complete,
the site shows a “coming soon” page.

## Check that it works

Run:

```sh
curl -fsS "https://<domain>/hm/api/config"
```

The response should be JSON.

## Updates

Shepherd checks for image updates every `600` seconds and updates services whose names start with the Easypanel project
name; it excludes itself. The default `latest` images follow releases. Pin an exact image tag to stop following a moving
tag.

## Backups

Back up both persistent data volumes. The daemon volume contains node data and keys under `/data/keys`; the web volume
contains `/data/config.json`.

## Troubleshooting

- The web command intentionally exits if `SEED_LINK_SECRET` is empty or still `REPLACE_WITH_SECRET`; keep that guard
  unchanged and set a unique value.
- DNS must already point to the Easypanel server before deploying, because HTTPS is enabled by default.
- Choose a project name that is not a prefix of another Seed project's name; Shepherd filters services by project-name
  prefix.

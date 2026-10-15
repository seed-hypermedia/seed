# Deploy a Seed site on CapRover

The one-click app deploys a Seed daemon and web app with Caddy routing for `/ipfs/`, persistent volumes, and Shepherd
image updates.

## Before you start

- A CapRover server and a site hostname whose DNS points to it. If you use a custom domain, it must match the Site
  domain value.
- A P2P host port, `56000` by default, open for both TCP and UDP. Use a unique port for each Seed site.
- The Seed desktop app, which you will use to register the site.

## Step 1: Install the one-click app

In CapRover, open **Apps → One-Click Apps → `>> TEMPLATE <<`**, paste `ops/caprover/seed.yml`, and continue.

## Step 2: Set the site values

Choose a site domain and P2P host port. The default domain is `<app-name>.<CapRover-root-domain>`; use a unique port,
`56000` by default. If you use a custom domain, set it to the same hostname as the app's custom domain.

For the fork's images, set the **Seed web image** and **Seed daemon image** values to:

```text
Seed web image: ghcr.io/horacioh/seed-web:main
Seed daemon image: ghcr.io/horacioh/seed-site:main
```

Leave the generated **Registration link secret** value in place unless you have a reason to replace it.

## Step 3: Enable HTTPS and deploy

Enable **HTTPS** and **Force HTTPS** for the app, then deploy it. Open the configured P2P port for both TCP and UDP.

## Register the site from Seed desktop

Use the **Registration link secret** value in this URL from the Seed desktop app:

```text
https://<site-domain>/hm/register?secret=<registration-link-secret>
```

The secret is written to the web data volume on first start. Until registration is complete, the site shows a “coming
soon” page.

## Check that it works

Run:

```sh
curl -fsS "https://<site-domain>/hm/api/config"
```

The response should be JSON.

## Updates

Shepherd checks the daemon and web images every `10m` by default. It updates only services whose names start with this
app's name. The default `latest` tags follow published images; the fork's `ghcr.io/horacioh/seed-*:main` tags follow
pushes to `custom-images`.

## Backups

Back up both persistent volumes. The daemon volume contains the node keys in `/data/keys`; the web volume contains
`config.json`.

## Troubleshooting

- Choose an app name that is not a prefix of another Seed site's app name; Shepherd filters services by name prefix.
- If you use a custom domain, make the Site domain value exactly match the app's custom domain.
- Each site needs a unique P2P port open for both TCP and UDP.

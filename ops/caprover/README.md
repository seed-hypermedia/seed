# Seed site on CapRover

New to CapRover? Follow the step-by-step [tutorial](TUTORIAL.md).

This one-click app deploys one Seed site with a daemon, web app, Caddy routing for `/ipfs` requests, persistent data,
and Shepherd updates.

## Deploy

1. In CapRover, open **Apps → One-Click Apps → `>> TEMPLATE <<`**, paste `ops/caprover/seed.yml`, and continue.
2. Choose a site domain and a P2P port unique to this site.
3. Enable **HTTPS** and **Force HTTPS** for the app. If using a custom domain, add it to the app and make it exactly
   match the **Site domain** variable.
4. Open the P2P port on the host firewall for both TCP and UDP.
5. Register from Seed desktop with `https://<site-domain>/hm/register?secret=<registration-link-secret>`.

## Variables

| Variable                 | Default                             | Purpose                                                                              |
| ------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------ |
| Site domain              | `<app-name>.<CapRover-root-domain>` | Public URL and daemon announce hostname. Must match the app's custom domain, if set. |
| Asset URLs               | Site domain                         | File and image URLs use the public site domain.                                      |
| P2P host port            | `56000`                             | Published libp2p TCP and QUIC/UDP port; use a unique port per site.                  |
| Registration link secret | Generated 32-character hex value    | Secret included in the Seed desktop registration URL.                                |
| Seed web image           | `seedhypermedia/web:latest`         | Set to `ghcr.io/horacioh/seed-web:main` to use this fork's web image.                |
| Seed daemon image        | `seedhypermedia/site:latest`        | Set to `ghcr.io/horacioh/seed-site:main` to use this fork's daemon image.            |
| Update interval          | `10m`                               | How often Shepherd checks the daemon and web images.                                 |

## Updates and backups

Shepherd updates only this site's daemon and web services. Choose an app name that is not a prefix of another Seed
site's app name, because Shepherd filters services by name prefix. The default `latest` tags follow the published
images; set a different image tag to control which release you run.

Back up both persistent volumes. The daemon data volume contains the node keys in `/data/keys`; the web data volume
contains `config.json`, including the registration secret written on first start.

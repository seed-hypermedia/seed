# Deploy a Seed site on Railway

The Railway template runs Seed Daemon and Seed Web as two services with persistent volumes. The web service is the
public HTTP entrypoint; the daemon has TCP P2P only, with no public UDP or QUIC.

## Before you start

- A Railway workspace, workspace API token, workspace ID, Railway CLI, `curl`, and `jq`.
- A Seed desktop app for registration. Railway provides the generated web domain; if you plan to use a custom domain,
  have that hostname ready.
- Railway assigns the daemon's external TCP proxy port. This template does not provide public UDP or QUIC.

## Step 1: Generate and deploy the workspace template

From the Seed repository root, run the generator with your workspace values:

```sh
WORKSPACE_ID=<workspace-id> \
RAILWAY_API_TOKEN=<workspace-api-token> \
REGION=us-west2 \
./ops/railway/create-template-project.sh seed-railway-template
```

The script creates the project and its two services, volumes, generated web domain, and daemon TCP proxy. It requests
initial deployments and prints an unpublished template URL. Open that URL and deploy the template to the workspace. The
template remains private to the workspace until it is published.

The generator currently sets `seedhypermedia/site:latest` and `seedhypermedia/web:latest`. To generate the template with
the fork's images, change the two `update_service` image arguments in `ops/railway/create-template-project.sh` to:

```sh
update_service "$daemon_service_id" ghcr.io/horacioh/seed-site:main "$daemon_start_command"
update_service "$web_service_id" ghcr.io/horacioh/seed-web:main "$web_start_command"
```

There is no image-override variable documented for this generator.

## Step 2: Set an optional custom domain

The template generates an HTTPS Railway domain for Seed Web and targets port `3000`. If you add a custom domain, check
the value used by the service. If the generated `*.up.railway.app` hostname is still used, set both of these Seed Web
variables to your custom URL:

```text
SEED_BASE_URL=https://site.example.com
SEED_ASSET_HOST=https://site.example.com
```

## Register the site from Seed desktop

On the first Seed Web start, the service generates a secret unless you supplied `SEED_LINK_SECRET`, writes it to
`/data/config.json`, and prints the registration link once in the Seed Web deployment logs. Use that link from the Seed
desktop app and save it securely.

```text
Seed registration link: https://<public-domain>/hm/register?secret=<secret>
```

## Check that it works

Run:

```sh
curl -fsS "https://<public-domain>/hm/api/config"
```

The response should be JSON. Until registration is complete, the site is not live; some deployments show a “coming soon”
page. For this Railway template, the README specifically notes that `/` returns 404 before registration.

## Updates

Railway does not automatically update the Seed images when a `:latest` tag changes. Redeploy each service to pull its
updated image.

## Backups

Use Railway volume backups for recovery. Keep `/data/keys` on the daemon volume private; it contains the daemon's
private keys. The template uses one replica per service because Railway volumes attach to a single service instance.

## Troubleshooting

- Railway does not provide public UDP, so this deployment is TCP-only and does not support QUIC.
- The README reports that Seed Web may stay in `DEPLOYING` even after its process starts and listens on port `3000`; the
  template does not configure a Railway healthcheck.
- `/` returns 404 until registration. The registration link is printed once in the Seed Web logs; later restarts and
  redeploys preserve the secret and do not print it again.
- The project creation script refuses to modify a project with the same name. To resume an interrupted run, pass its
  exact `PROJECT_ID`.
